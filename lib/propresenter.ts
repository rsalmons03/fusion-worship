// Reads song lyrics and section names out of a ProPresenter 7 (.pro) file.
// The file is binary (protobuf); slide text is stored as RTF, and section groups
// ("Verse 1", "Chorus"…) list the IDs of their slides.

const UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g;
const GROUP =
  /(?<=[\x00-\x20"])((?:pre-?)?chorus(?: ?\d+)?|verse(?: ?\d+)?|bridge(?: ?\d+)?|tag(?: ?\d+)?|intro|outro|ending|interlude|instrumental|vamp|turnaround|refrain|coda)(?=[^A-Za-z])/gi;

function latin1(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

const CP1252: Record<number, string> = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x85: "…" };

function rtfEnd(s: string, i: number) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "{") d++;
    else if (c === "}" && --d === 0) return j + 1;
  }
  return s.length;
}

export function rtfToLines(rtf: string): string[] {
  let t = rtf.replace(/\{\\(fonttbl|colortbl|\*\\expandedcolortbl)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "");
  t = t.replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => {
    const n = parseInt(h, 16);
    return CP1252[n] ?? String.fromCharCode(n);
  });
  t = t.replace(/\\u(-?\d+) ?\??/g, (_, n: string) => String.fromCharCode(((Number(n) % 65536) + 65536) % 65536));
  t = t.replace(/\\\n/g, "\n").replace(/\\par(?![a-z])/g, "\n").replace(/\\line(?![a-z])/g, "\n");
  t = t.replace(/\\[a-zA-Z]+-?\d* ?/g, "").replace(/[{}]/g, "");
  return t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Converts a ProPresenter 7 file into a lyrics chart with section labels. Returns null if nothing was found. */
export function proToChart(bytes: Uint8Array): { title: string | null; chart: string } | null {
  const s = latin1(bytes);
  const firstRtf = s.indexOf("{\\rtf1");
  if (firstRtf < 0) return null;
  const head = s.slice(0, firstRtf);

  // Section groups, each with the slide IDs that follow its name.
  const matches = [...head.matchAll(GROUP)];
  const groups = matches.map((m, k) => {
    const end = k + 1 < matches.length ? matches[k + 1].index! : head.length;
    return { name: m[1], ids: head.slice(m.index! + m[0].length, end).match(UUID) ?? [] };
  });
  const known = new Set(groups.flatMap((g) => g.ids));

  // Slides: the first known ID before each RTF block is the slide's ID.
  const slides = new Map<string, string[]>();
  let prev = 0;
  for (let i = s.indexOf("{\\rtf1"); i >= 0; i = s.indexOf("{\\rtf1", prev)) {
    const id = (s.slice(prev, i).match(UUID) ?? []).find((u) => known.has(u));
    const end = rtfEnd(s, i);
    // Later matches win: the first block's search also sees the group list, so its first guess can be wrong.
    if (id) slides.set(id, rtfToLines(s.slice(i, end)));
    prev = end;
  }

  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const g of groups) {
    const lines = g.ids.flatMap((id) => slides.get(id) ?? []);
    const label = g.name.replace(/^prechorus/i, "Pre-Chorus").replace(/\b\w/, (c) => c.toUpperCase());
    const body = lines.join("\n");
    out.push(label);
    // A repeated section with the same words is listed by name only (keeps the song's order).
    if (body && seen.get(label.toLowerCase()) !== body) {
      out.push(body);
      seen.set(label.toLowerCase(), body);
    }
    out.push("");
  }
  const chart = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!chart) return null;
  // The presentation name is the first text field after the presentation's own ID.
  const tm = /\$[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\x1a([\s\S])/.exec(head.slice(0, 300));
  const title = tm ? head.substr(tm.index + tm[0].length, tm[1].charCodeAt(0)).replace(/[\u2018\u2019]/g, "'").trim() || null : null;
  return { title, chart };
}

// ── ProPresenter 5/6 (.pro6 / .pro5): XML with each slide's text as base64 (plain text or RTF) ──
function b64(s: string) {
  try {
    const bin = atob(s.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}
const xmlAttr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") ?? "";

/** Lyrics and sections from a ProPresenter 5/6 song file. */
export function pro6ToChart(xml: string): { title: string | null; chart: string } | null {
  if (!/<RVPresentationDocument/i.test(xml)) return null;
  const docTag = xml.match(/<RVPresentationDocument[^>]*>/i)?.[0] ?? "";
  const title = xmlAttr(docTag, "CCLISongTitle") || null;
  const parts = xml.split(/<RVSlideGrouping\b/i).slice(1);
  const out: string[] = [];
  for (const part of parts) {
    const name = xmlAttr(part.slice(0, part.indexOf(">")), "name").trim();
    const slides = part.split(/<RVDisplaySlide\b/i).slice(1);
    const lines: string[] = [];
    for (const sl of slides) {
      let text = "";
      const plain = sl.match(/rvXMLIvarName="PlainText"[^>]*>([^<]*)</i)?.[1];
      if (plain) text = b64(plain);
      if (!text.trim()) {
        const rtf = sl.match(/rvXMLIvarName="RTFData"[^>]*>([^<]*)</i)?.[1] ?? sl.match(/\bRTFData="([^"]*)"/i)?.[1];
        if (rtf) text = rtfToLines(b64(rtf)).join("\n");
      }
      for (const l of text.replace(/\r\n?|\u2028|\u2029/g, "\n").split("\n")) if (l.trim()) lines.push(l.trim());
      if (slides.length > 1) lines.push("");
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (!lines.length) continue;
    out.push(`${name || "Verse"}\n${lines.filter((l, i) => l || (lines[i - 1] ?? "") !== "").join("\n")}`);
  }
  return out.length ? { title, chart: out.join("\n\n") } : null;
}
