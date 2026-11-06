import { parseChordPro, sectionsOf } from "./chordpro";

export type Slide = {
  key: string;
  itemId: string;
  kind: "title" | "lyrics" | "info";
  /** Lines shown on screen. */
  lines: string[];
  /** Section name, e.g. "Chorus" (lyrics slides only). */
  section?: string;
  abbr?: string;
  /** Section number in the chart (matches the player's section times). */
  sectionN?: number;
};

export type SlideItem = {
  id: string;
  kind: string;
  title: string;
  description?: string | null;
  song_id?: string | null;
  songs?: { chordpro: string; author?: string | null } | null;
};

/** Lyrics of each section, in order. A repeated section with no lines of its own reuses the first one's words. */
export function lyricSections(src: string): { label: string; abbr: string; lines: string[]; n: number }[] {
  const abbrs = sectionsOf(src);
  const out: { label: string; abbr: string; lines: string[]; n: number }[] = [];
  let cur: { label: string; abbr: string; lines: string[]; n: number } | null = null;
  let n = 0;
  for (const l of parseChordPro(src)) {
    if (l.type === "section") {
      cur = { label: l.label, abbr: abbrs[n]?.abbr ?? "", lines: [], n: n++ };
      out.push(cur);
    } else if (l.type === "lyrics") {
      const text = l.segments.map((s) => s.text).join("").replace(/\s+/g, " ").trim();
      if (!text) continue; // chord-only line
      if (!cur) {
        cur = { label: "", abbr: "", lines: [], n: -1 };
        out.push(cur);
      }
      cur.lines.push(text);
    }
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const s of out) {
    if (s.lines.length) continue;
    const first = out.find((o) => o !== s && o.lines.length && norm(o.label) === norm(s.label));
    if (first) s.lines = first.lines;
  }
  return out.filter((s) => s.lines.length);
}

/** Splits a plan into projector slides: a title slide per song, then its lyrics a few lines at a time. */
export function buildSlides(items: SlideItem[], linesPerSlide = 2): Slide[] {
  const slides: Slide[] = [];
  for (const it of items) {
    if (it.kind === "header") continue;
    const chart = it.songs?.chordpro ?? "";
    if (it.kind === "song" && chart.trim()) {
      slides.push({ key: `${it.id}:t`, itemId: it.id, kind: "title", lines: [it.title, it.songs?.author ?? ""].filter(Boolean) });
      lyricSections(chart).forEach((sec, si) => {
        for (let i = 0; i < sec.lines.length; i += linesPerSlide) {
          slides.push({ key: `${it.id}:${si}:${i}`, itemId: it.id, kind: "lyrics", lines: sec.lines.slice(i, i + linesPerSlide), section: sec.label, abbr: sec.abbr, sectionN: sec.n });
        }
      });
    } else {
      slides.push({ key: `${it.id}:i`, itemId: it.id, kind: "info", lines: [it.title] });
    }
  }
  return slides;
}

export type ScreenState = {
  slide: number;
  /** Hide the words but keep the background. */
  clear: boolean;
  /** Show the church logo instead of words. */
  logo: boolean;
  /** Everything black. */
  black: boolean;
  bg: string;
  lines: number;
  /** Slides change by themselves as the track plays (set player). */
  follow: boolean;
};

export const DEFAULT_SCREEN: ScreenState = { slide: 0, clear: false, logo: true, black: false, bg: "bokeh:ember", lines: 2, follow: false };

export const PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: "ember", name: "Ember", colors: ["#df6437", "#7a1f0e", "#f2a65a"] },
  { id: "ocean", name: "Ocean", colors: ["#1e7fd6", "#062a4f", "#5fd3f3"] },
  { id: "aurora", name: "Aurora", colors: ["#2bd17e", "#3a0f6b", "#00b4d8"] },
  { id: "dusk", name: "Dusk", colors: ["#9d4edd", "#4a0e3a", "#ff6f91"] },
  { id: "gold", name: "Gold", colors: ["#f0b429", "#2e1f00", "#ffe08a"] },
  { id: "night", name: "Night", colors: ["#4f6db8", "#0b1226", "#9fb7ff"] },
  { id: "rose", name: "Rose", colors: ["#ff5d8f", "#3b0a1e", "#ffc2d1"] },
  { id: "mono", name: "White", colors: ["#d9d9d9", "#141414", "#ffffff"] },
];

export const BG_STYLES: { id: string; name: string }[] = [
  { id: "glass", name: "Stained glass" },
  { id: "bokeh", name: "Bokeh" },
  { id: "rays", name: "Light rays" },
  { id: "waves", name: "Waves" },
  { id: "sparks", name: "Sparks" },
  { id: "stars", name: "Stars" },
  { id: "flow", name: "Soft flow" },
  { id: "black", name: "Black" },
];

/** Backgrounds are saved as "style:palette" (e.g. "bokeh:ocean") or "media:<file path>". Old single names still work. */
export function parseBg(bg: string): { style: string; palette: string; path?: string } {
  if (bg.startsWith("media:")) return { style: "media", palette: "ember", path: bg.slice(6) };
  if (bg === "black") return { style: "black", palette: "ember" };
  const [a, b] = bg.split(":");
  if (b) return { style: a, palette: b };
  return { style: "flow", palette: PALETTES.some((p) => p.id === a) ? a : "ember" };
}

export const screenChannel = (planId: string) => `screen-${planId}`;

/** Which slide matches a playback position in a song: the right section, then how far through it. */
export function slideForPosition(slides: Slide[], itemId: string, pos: { n: number | null; progress: number }): number {
  const mine = slides.map((s, i) => ({ s, i })).filter((x) => x.s.itemId === itemId);
  if (!mine.length) return -1;
  if (pos.n === null) return mine[0].i; // before the first section: title slide
  const sec = mine.filter((x) => x.s.sectionN === pos.n);
  if (!sec.length) {
    // A section with no words (intro, instrumental…): the song's title slide before the first lyrics, otherwise leave the screen as it is.
    const firstLyric = mine.find((x) => x.s.kind === "lyrics");
    return !firstLyric || (firstLyric.s.sectionN ?? 0) > pos.n ? mine[0].i : -1;
  }
  return sec[Math.min(sec.length - 1, Math.floor(pos.progress * sec.length))].i;
}
