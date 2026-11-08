// Sermon slides: read a sermon PDF, pull out the title, headings, bullet points and scriptures,
// and keep them as slides for the big screen (shown with the church logo).
// Saved as JSON in storage (charts/sermons/<planId>.json), so no database change is needed.
import { createClient } from "@/lib/supabase/client";

export type SermonSlide = {
  id: string;
  /** title = sermon title, heading = a main point's heading, point = a bullet, scripture = a Bible verse */
  style: "title" | "heading" | "point" | "scripture";
  text: string;
  /** Small line above the text (the heading a bullet belongs to, or the scripture reference). */
  label?: string;
};
/** How sermon slides look: "series" = a sermon-series graphic (colour + texture + frame), "motion" = the lyrics' moving background. */
export type SermonTheme = { style: "series" | "motion"; bg: string; accent: string; image?: string };
export const SERIES_PRESETS: { name: string; bg: string; accent: string }[] = [
  { name: "Purple & Gold", bg: "#5b2bd6", accent: "#f2b233" },
  { name: "Navy & Orange", bg: "#14295c", accent: "#f08a3c" },
  { name: "Black & Gold", bg: "#141414", accent: "#e5b53a" },
  { name: "Fusion Orange", bg: "#c94f24", accent: "#ffe2a8" },
  { name: "Teal & Coral", bg: "#0f6e73", accent: "#ff8a6b" },
  { name: "Maroon & Cream", bg: "#6d1530", accent: "#f6e3b4" },
];
export const DEFAULT_THEME: SermonTheme = { style: "series", bg: SERIES_PRESETS[0].bg, accent: SERIES_PRESETS[0].accent };
export type Sermon = { title: string; speaker?: string; slides: SermonSlide[]; file?: string; updated?: string; theme?: SermonTheme };

const newId = () => Math.random().toString(36).slice(2, 10);
const path = (planId: string) => `sermons/${planId}.json`;

const BULLET = /^\s*(?:[•●▪■◦○◆◇►▶➤➢✓✔\-–—*]|\(?\d{1,2}[.)]|\(?[a-hA-H][.)]|[IVX]{1,4}[.)])\s+/;
const BOOKS =
  "Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2|I|II) ?Samuel|(?:1|2|I|II) ?Kings|(?:1|2|I|II) ?Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of (?:Songs|Solomon)|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2|I|II) ?Corinthians|Galatians|Ephesians|Philippians|Colossians|(?:1|2|I|II) ?Thessalonians|(?:1|2|I|II) ?Timothy|Titus|Philemon|Hebrews|James|(?:1|2|I|II) ?Peter|(?:1|2|3|I|II|III) ?John|Jude|Revelation|Gen|Ex|Lev|Deut|Josh|Ps|Prov|Eccl|Isa|Jer|Ezek|Dan|Matt|Mk|Lk|Jn|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Heb|Jas|Pet|Rev";
const REF = new RegExp(`\\b(?:${BOOKS})\\.? \\d{1,3}(?::\\d{1,3}(?:[-–]\\d{1,3})?(?:, ?\\d{1,3})*)?\\b`, "i");

type Line = { text: string; size: number; x: number; bold: boolean };

/** Reads the text lines of a PDF (with font size and indent), in reading order. */
export async function pdfLines(file: File): Promise<Line[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; str: string; size: number; bold: boolean }[]>();
    for (const it of tc.items as { str: string; transform: number[]; height: number; fontName: string }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      const size = Math.abs(it.transform[3]) || it.height || 10;
      const font = (tc.styles as Record<string, { fontFamily?: string }>)[it.fontName]?.fontFamily ?? it.fontName;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: it.transform[4], str: it.str, size, bold: /bold|black|heavy|semibold/i.test(font + it.fontName) });
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, parts]) => {
        parts.sort((a, b) => a.x - b.x);
        const text = parts.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim();
        if (text) out.push({ text, size: Math.max(...parts.map((x) => x.size)), x: parts[0].x, bold: parts.some((x) => x.bold) });
      });
  }
  return out;
}

// Section headings that organise a manuscript but aren't slides (their paragraphs are read, not shown).
const META = /^(opening|closing|introduction|intro|conclusion|outline|notes|illustration|story|application|altar call|invitation|announcements?|(opening |closing )?prayer|(five |three |four |\w+ )?(main )?(sermon )?points?)\b/i;
// Lines the congregation says together: shown as their own slide.
const CALL = /^(say to (the church|your neighbor|someone)|tell (the person|your neighbor|somebody|someone)[^:]*|declare|repeat after me|say it with me|church,? say)\s*:\s*/i;
// "Scripture: John 3:16", "Main Scripture: …", "Text: …", "Key verse: …"
const SCRIPTURE_LEAD = /^(main |key |focus |sermon )?(scripture|text|verse|reading|passage)s?\s*:\s*/i;

const titleCase = (t: string) => (t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.toLowerCase().replace(/(^|[\s(“"'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(A|An|And|As|At|But|By|For|In|Of|On|Or|The|To|With|Than|Nor|So|Yet)\b/g, (w, _1, i) => (i === 0 ? w : w.toLowerCase())) : t);

/**
 * Turns the PDF's lines into slides. Works for outlines and full manuscripts:
 * title (+ subtitle), the main scripture with its verse, each point's heading, its scripture,
 * one slide per bullet, and "Say to the church:" lines. Speech paragraphs, prayers and page footers are skipped.
 */
export function slidesFromLines(lines: Line[]): Sermon {
  if (!lines.length) return { title: "Sermon", slides: [] };
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];
  const clean = lines.filter(
    (l) => !/^\d+$/.test(l.text) && !/^page \d+/i.test(l.text) && !/[•|·-]\s*page \d+\s*$/i.test(l.text) && !(l.size < body * 0.85 && /page|\d+\s*$/i.test(l.text))
  );
  const isHeading = (l: Line) => (l.size >= body * 1.15 || (l.bold && l.text.length < 70 && !BULLET.test(l.text))) && l.text.length < 90;

  const slides: SermonSlide[] = [];
  let title = "";
  let titleSlide: SermonSlide | null = null;
  let heading = "";
  let pointNo = 0;
  let cur: SermonSlide | null = null; // the slide a wrapped line continues
  const push = (sl: SermonSlide) => {
    slides.push(sl);
    cur = sl;
  };
  const ended = (t: string) => /[.!?”"’)]\s*$/.test(t);

  clean.forEach((l, i) => {
    const t = l.text;
    // Title: the first (or a much bigger) line.
    if (!title && (i === 0 || l.size >= body * 1.3)) {
      title = titleCase(t.replace(BULLET, ""));
      titleSlide = { id: newId(), style: "title", text: title };
      push(titleSlide);
      cur = null;
      return;
    }
    const content = t.replace(BULLET, "").trim();
    const ref = content.match(REF)?.[0];

    // Scripture: "Scripture: Mark 4:35–41", "John 3:16 For God so loved…", or a reference on its own line.
    const lead = content.match(SCRIPTURE_LEAD);
    if (lead || (ref && content.startsWith(ref))) {
      const rest = content.slice(lead ? lead[0].length : 0);
      const r = rest.match(REF)?.[0] ?? ref ?? rest;
      let label = r;
      let verse = rest.slice(rest.indexOf(r) + r.length).trim();
      const version = verse.match(/^\((KJV|NIV|NLT|ESV|NKJV|NASB|CSB|AMP|MSG|NRSV)\)\s*/i);
      if (version) {
        label = `${r} (${version[1].toUpperCase()})`;
        verse = verse.slice(version[0].length);
      }
      push({ id: newId(), style: "scripture", text: verse.replace(/^[\s:–—-]+/, "").trim(), label });
      return;
    }

    // Headings.
    if (isHeading(l)) {
      cur = null;
      if (META.test(content) && !/^\d/.test(t)) {
        heading = ""; // organisational heading (Opening Speech, Closing Prayer…): not a slide
        return;
      }
      pointNo = /^\(?\d{1,2}[.)]/.test(t) ? parseInt(t.replace(/^\(/, ""), 10) : pointNo + 1;
      heading = titleCase(content);
      push({ id: newId(), style: "heading", text: heading, label: `Point ${pointNo}` });
      return;
    }

    // "Say to the church: …" → its own slide.
    const call = content.match(CALL);
    if (call) {
      const said = content.slice(call[0].length).trim();
      // keep just the quoted words when the line goes on after the quote
      const quoted = said.match(/^[“"]([^”"]+)[”"]/);
      push({ id: newId(), style: "point", text: (quoted ? quoted[1] : said.replace(/^[“"]|[”"]$/g, "")).trim(), label: "Say it together" });
      if (quoted) cur = null;
      return;
    }

    // Bullets.
    if (BULLET.test(t)) {
      push({ id: newId(), style: "point", text: content, label: heading || undefined });
      return;
    }

    // Short lines right under the title (subtitle, speaker, date) go on the title slide.
    if (titleSlide && slides.length === 1 && t.length < 120) {
      const ts = titleSlide as SermonSlide;
      ts.label = ts.label ? `${ts.label} · ${t}` : t;
      return;
    }

    // A wrapped line: continue the verse / bullet / call it belongs to.
    const prev = cur as SermonSlide | null;
    if (prev && prev.style !== "title" && prev.style !== "heading" && (!prev.text || !ended(prev.text)) && prev.text.length < 300) {
      prev.text = `${prev.text} ${t}`.replace(/^[“"]/, prev.text ? "“" : "").trim();
      if (prev.style === "point" && prev.label === "Say it together") prev.text = prev.text.replace(/[”"]$/g, "");
      return;
    }
    // Anything else is speech paragraph text: read by the speaker, not shown.
    cur = null;
  });
  // Scripture slides: show the verse without its outer quote marks (the slide adds them).
  slides.forEach((sl) => sl.style === "scripture" && (sl.text = sl.text.replace(/^[“"]\s*/, "").replace(/\s*[”"]$/, "")));
  return { title: title || "Sermon", slides: slides.filter((sl) => sl.text || sl.label) };
}

export async function loadSermon(planId: string): Promise<Sermon | null> {
  const { data } = await createClient().storage.from("charts").download(path(planId));
  if (!data) return null;
  try {
    return JSON.parse(await data.text()) as Sermon;
  } catch {
    return null;
  }
}

export async function saveSermon(planId: string, s: Sermon) {
  const body = new Blob([JSON.stringify({ ...s, updated: new Date().toISOString() })], { type: "application/json" });
  const { error } = await createClient().storage.from("charts").upload(path(planId), body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(error.message);
}

export async function deleteSermon(planId: string) {
  await createClient().storage.from("charts").remove([path(planId)]);
}

export const newSermonSlide = (style: SermonSlide["style"] = "point", text = ""): SermonSlide => ({ id: newId(), style, text });
