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
export type Sermon = { title: string; speaker?: string; slides: SermonSlide[]; file?: string; updated?: string };

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

/** Turns the PDF's lines into slides: title, headings, one slide per bullet, scriptures on their own. */
export function slidesFromLines(lines: Line[]): Sermon {
  const clean = lines.filter((l) => !/^\d+$/.test(l.text) && !/^page \d+/i.test(l.text)); // page numbers
  if (!clean.length) return { title: "Sermon", slides: [] };
  const sizes = clean.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];
  const isHeading = (l: Line) => (l.size >= body * 1.15 || (l.bold && l.text.length < 70 && !BULLET.test(l.text))) && l.text.length < 90;

  const slides: SermonSlide[] = [];
  let title = "";
  let titleSlide: SermonSlide | null = null;
  let heading = "";
  let cur: SermonSlide | null = null;
  const push = (s: SermonSlide) => {
    slides.push(s);
    cur = s;
  };
  clean.forEach((l, i) => {
    const t = l.text;
    if (!title && (i === 0 || l.size >= body * 1.3)) {
      title = t.replace(BULLET, "");
      titleSlide = { id: newId(), style: "title", text: title };
      push(titleSlide);
      cur = null;
      return;
    }
    // Short lines right under the title (speaker, date, series) go on the title slide.
    if (titleSlide && slides.length === 1 && !BULLET.test(t) && !isHeading(l) && t.length < 70 && !REF.test(t)) {
      const ts = titleSlide as SermonSlide;
      ts.label = ts.label ? `${ts.label} · ${t}` : t;
      return;
    }
    const ref = t.match(REF)?.[0];
    if (isHeading(l)) {
      heading = t.replace(BULLET, "");
      push({ id: newId(), style: "heading", text: heading });
      cur = null;
      return;
    }
    const content = t.replace(BULLET, "").trim();
    // "John 3:16 For God so loved…" (bullet or not): a scripture slide, reference above the verse.
    if (ref && content.startsWith(ref)) {
      const verse = content.slice(ref.length).replace(/^[\s:–—-]+/, "").trim();
      push({ id: newId(), style: "scripture", text: verse, label: ref });
      return;
    }
    if (BULLET.test(t)) {
      push({ id: newId(), style: "point", text: content, label: heading || undefined });
      return;
    }
    if (ref && t.length - ref.length < 6) {
      // a reference on its own line: the verse text usually follows
      push({ id: newId(), style: "scripture", text: "", label: ref });
      return;
    }
    // A wrapped line continues the previous bullet / verse; otherwise it's its own point.
    const prev = cur as SermonSlide | null;
    if (prev && (prev.style === "point" || prev.style === "scripture") && prev.text.length < 260) prev.text = `${prev.text} ${t}`.trim();
    else push({ id: newId(), style: "point", text: t, label: heading || undefined });
  });
  return { title: title || "Sermon", slides: slides.filter((s) => s.text || s.label) };
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
