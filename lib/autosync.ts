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

/**
 * For a song with no lyrics yet: builds a chart (lyrics + section names) and section times
 * straight from what the AI heard. Sections are worked out from the song's shape:
 * the block that repeats most is the Chorus, a block that always comes just before it is the
 * Pre-Chorus, new blocks after the second chorus are the Bridge, the rest are Verses.
 */
export function chartFromTranscript(segsIn: TimedLine[], duration: number) {
  // Clean lines (drop empty and the AI's stock filler).
  const segs = segsIn
    .map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text && words(s.text).length && !/^(thank you|thanks for watching|music|♪+)\.?$/i.test(s.text));
  if (!segs.length) return null;

  // Lines into blocks: a pause starts a new block; long blocks are split.
  type Block = { lines: string[]; start: number; end: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const s of segs) {
    const gap = cur ? s.start - cur.end : Infinity;
    if (!cur || gap > 1.6 || cur.lines.length >= 8) {
      cur = { lines: [], start: s.start, end: s.end };
      blocks.push(cur);
    }
    cur.lines.push(s.text.replace(/^[a-z]/, (c) => c.toUpperCase()));
    cur.end = s.end;
  }

  // Group blocks that are the same words (repeats).
  const bag = (b: Block) => new Set(words(b.lines.join(" ")));
  const sim = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    a.forEach((w) => b.has(w) && n++);
    // same words, and roughly the same length (a short tag isn't the whole chorus)
    if (Math.min(a.size, b.size) < Math.max(a.size, b.size) * 0.5) return 0;
    return n / Math.max(1, Math.min(a.size, b.size));
  };
  const group: number[] = [];
  const reps: Set<string>[] = [];
  blocks.forEach((b, i) => {
    const w = bag(b);
    const g = reps.findIndex((r) => sim(r, w) >= 0.6);
    if (g >= 0) group[i] = g;
    else {
      reps.push(w);
      group[i] = reps.length - 1;
    }
  });
  const count = (g: number) => group.filter((x) => x === g).length;
  const groups = [...new Set(group)];

  // Chorus: repeats the most (ties: the longer one).
  const len = (g: number) => blocks[group.indexOf(g)].lines.length;
  const chorus = groups.filter((g) => count(g) >= 2).sort((a, b) => count(b) - count(a) || len(b) - len(a))[0] ?? -1;
  const chorusAt = group.map((g, i) => (g === chorus ? i : -1)).filter((i) => i >= 0);
  // Pre-chorus: repeats, and every time it's followed by the chorus.
  const pre = new Set(groups.filter((g) => g !== chorus && count(g) >= 2 && group.every((x, i) => x !== g || group[i + 1] === chorus)));
  const secondChorus = chorusAt[1] ?? Infinity;

  const names = new Map<number, string>();
  let verseN = 0;
  const label = (i: number) => {
    const g = group[i];
    if (g === chorus) return "Chorus";
    if (pre.has(g)) return "Pre-Chorus";
    if (!names.has(g)) {
      const first = group.indexOf(g);
      const isLastShort = i === blocks.length - 1 && blocks[i].lines.length <= 2 && count(g) === 1 && chorusAt.length >= 2;
      if (isLastShort) names.set(g, "Tag");
      else if (first > secondChorus) names.set(g, groups.some((x) => names.get(x) === "Bridge") ? "Bridge 2" : "Bridge");
      else names.set(g, `Verse ${++verseN}`);
    }
    return names.get(g)!;
  };

  const out: string[] = [];
  const markers: Record<string, number> = {};
  const written = new Set<number>();
  let n = 0;
  const add = (name: string, t: number, lines: string[] | null) => {
    out.push(lines ? `${name}\n${lines.join("\n")}` : name);
    markers[n++] = Math.max(0, Math.round(t * 10) / 10);
  };
  if (blocks[0].start > 4) add("Intro", 0, null);
  blocks.forEach((b, i) => {
    if (i > 0 && b.start - blocks[i - 1].end > 12) add("Instrumental", blocks[i - 1].end + 0.5, null);
    const g = group[i];
    // A repeat of the chorus / pre-chorus is written as just its name (the app reuses the words).
    const showWords = !written.has(g) || (g !== chorus && !pre.has(g) && !label(i).startsWith("Bridge"));
    add(label(i), b.start - 0.2, showWords ? b.lines : null);
    written.add(g);
  });
  if (duration - blocks[blocks.length - 1].end > 12) add("Outro", blocks[blocks.length - 1].end + 0.5, null);

  return { chart: out.join("\n\n"), markers, sections: n };
}
