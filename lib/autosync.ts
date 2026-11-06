// Matches a transcription (timed lines from the AI) to a chart's sections to find where each starts.
import { sectionsOf } from "./chordpro";
import { lyricSections } from "./slides";

export type TimedLine = { start: number; end: number; text: string };

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Rough "same word": exact, or same start for longer words (sing/singing, praise/praising). */
const like = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));

/**
 * Returns { markers: section number → start second, found, total }.
 * Sections with words are found in order (so a repeated chorus is matched to its next occurrence);
 * intros/instrumentals and anything not heard are placed between their neighbours.
 */
export function alignSections(chart: string, segs: TimedLine[], duration: number) {
  const sections = sectionsOf(chart);
  const linesOf = new Map<number, string[]>();
  for (const ls of lyricSections(chart)) if (ls.n >= 0) linesOf.set(ls.n, ls.lines);

  // One stream of heard words, each with an estimated time (spread evenly through its line).
  const stream: { w: string; t: number }[] = [];
  for (const s of segs) {
    const ws = words(s.text);
    ws.forEach((w, i) => stream.push({ w, t: s.start + ((s.end - s.start) * i) / Math.max(1, ws.length) }));
  }

  const start: (number | null)[] = sections.map(() => null);
  const end: (number | null)[] = sections.map(() => null);
  let cursor = 0;
  for (const sec of sections) {
    const lines = linesOf.get(sec.n);
    if (!lines?.length) continue;
    const target = words(lines.slice(0, 2).join(" ")).slice(0, 8);
    if (target.length < 2) continue;
    const total = words(lines.join(" ")).length;
    // Look ahead a limited way so a missing section doesn't jump us to the end of the song.
    const limit = Math.min(stream.length, cursor + Math.max(80, total * 4));
    let best = -1, bestScore = 0;
    for (let i = cursor; i < limit; i++) {
      if (!like(stream[i].w, target[0]) && !like(stream[i].w, target[1] ?? "")) continue;
      // in-order matches of the target words within a short window
      let j = i, hit = 0;
      for (const tw of target) {
        for (let k = j; k < Math.min(stream.length, j + 3); k++) {
          if (like(stream[k].w, tw)) {
            hit++;
            j = k + 1;
            break;
          }
        }
      }
      const score = hit / target.length;
      if (score > bestScore + 0.05) {
        best = i;
        bestScore = score;
      }
      if (score >= 0.75) break; // earliest good match wins
    }
    if (best >= 0 && bestScore >= 0.5) {
      start[sec.n] = Math.max(0, stream[best].t - 0.25);
      const last = Math.min(stream.length - 1, best + Math.max(1, Math.round(total * 0.9)));
      end[sec.n] = stream[last].t;
      cursor = best + Math.max(1, Math.round(total * 0.6));
    }
  }

  const found = start.filter((x) => x !== null).length;
  const withWords = sections.filter((s) => linesOf.get(s.n)?.length).length;

  // Fill the rest: before the first found section → spread from 0; between → after the previous one ends.
  const out: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (start[i] !== null) {
      out[i] = start[i]!;
      continue;
    }
    let p = i - 1;
    while (p >= 0 && start[p] === null) p--;
    let n = i + 1;
    while (n < sections.length && start[n] === null) n++;
    const lo = p >= 0 ? Math.max(out[p] ?? 0, end[p] ?? start[p]!) : 0;
    const hi = n < sections.length ? start[n]! : duration;
    const gaps = n - p; // evenly between the known neighbours
    out[i] = p < 0 && i === 0 ? 0 : lo + ((hi - lo) * (i - p - (p >= 0 && end[p] !== null ? 1 : 0))) / Math.max(1, gaps - (p >= 0 && end[p] !== null ? 1 : 0));
  }
  // Keep times in order.
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;

  const markers: Record<string, number> = {};
  sections.forEach((s, i) => (markers[s.n] = Math.round(Math.min(out[i], Math.max(0, duration - 1)) * 10) / 10));
  return { markers, found, total: withWords };
}
