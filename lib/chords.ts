// Hears the chords in a recording (like Moises / Chordify): which chord is playing, beat by beat.
// Chroma (how strong each of the 12 notes is) is matched to major/minor chord shapes, then smoothed
// so the result changes chord only when the music does.

import { KEYS, prefersFlats, transposeChord } from "./chordpro";

export type HeardChord = { t: number; end: number; name: string };
export type ChordResult = { chords: HeardChord[]; key: string };

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Chord shapes: 12 major + 12 minor (root, third, fifth). */
const SHAPES: { name: string; v: number[] }[] = [];
for (let r = 0; r < 12; r++) {
  for (const [suffix, third] of [["", 4], ["m", 3]] as const) {
    const v = new Array(12).fill(0);
    v[r] = 1;
    v[(r + third) % 12] = 0.8;
    v[(r + 7) % 12] = 0.8;
    SHAPES.push({ name: NOTES_SHARP[r] + suffix, v });
  }
}

// Krumhansl key profiles, for naming the key (and spelling sharps/flats).
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db || 1);
}

/**
 * @param data mono samples
 * @param tempo optional beat grid; chords are judged per beat when known (else every ~0.5 s)
 */
export function detectChords(data: Float32Array, sampleRate: number, tempo?: { bpm: number; offset: number } | null): ChordResult | null {
  // Downsample ~4× (simple averaging is enough for chord notes, which sit below 2 kHz).
  const k = Math.max(1, Math.round(sampleRate / 11025));
  const sr = sampleRate / k;
  const n = Math.floor(data.length / k);
  if (n < sr * 5) return null;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += data[i * k + j];
    x[i] = s / k;
  }

  // Note strengths every hop.
  const N = 4096, hop = 1024;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const binPc: number[] = [];
  const binW: number[] = [];
  for (let b = 0; b < N / 2; b++) {
    const f = (b * sr) / N;
    if (f < 65 || f > 2100) {
      binPc.push(-1);
      binW.push(0);
      continue;
    }
    const midi = 69 + 12 * Math.log2(f / 440);
    const near = Math.round(midi);
    binPc.push(((near % 12) + 12) % 12);
    binW.push(Math.max(0, 1 - Math.abs(midi - near) * 2)); // only bins close to a real note
  }
  const frames: { t: number; c: number[]; e: number }[] = [];
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let s = 0; s + N <= n; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * win[i];
      im[i] = 0;
      e += x[s + i] * x[s + i];
    }
    fft(re, im);
    const c = new Array(12).fill(0);
    for (let b = 1; b < N / 2; b++) {
      if (binPc[b] < 0 || !binW[b]) continue;
      c[binPc[b]] += Math.sqrt(Math.hypot(re[b], im[b])) * binW[b];
    }
    frames.push({ t: (s + N / 2) / sr, c, e: Math.sqrt(e / N) });
  }
  if (frames.length < 10) return null;
  const loud = frames.map((f) => f.e).sort((a, b) => a - b)[Math.floor(frames.length * 0.5)] || 0;

  // Group into beats (or half-second steps).
  const dur = n / sr;
  const step = tempo?.bpm ? 60 / tempo.bpm : 0.5;
  let t0 = tempo?.bpm ? tempo.offset % step : 0;
  const cells: { t: number; end: number; c: number[]; quiet: boolean }[] = [];
  let fi = 0;
  for (; t0 < dur; t0 += step) {
    const c = new Array(12).fill(0);
    let cnt = 0, e = 0;
    while (fi < frames.length && frames[fi].t < t0) fi++;
    for (let j = fi; j < frames.length && frames[j].t < t0 + step; j++) {
      for (let p = 0; p < 12; p++) c[p] += frames[j].c[p];
      e += frames[j].e;
      cnt++;
    }
    cells.push({ t: t0, end: t0 + step, c, quiet: !cnt || e / cnt < loud * 0.25 });
  }

  // Score every chord on every beat (cosine similarity).
  const S = SHAPES.length;
  const score = cells.map((cell) => {
    const norm = Math.hypot(...cell.c) || 1;
    return SHAPES.map((sh) => {
      let d = 0;
      for (let p = 0; p < 12; p++) d += sh.v[p] * cell.c[p];
      return d / (norm * Math.hypot(...sh.v));
    });
  });

  // Smooth: prefer staying on a chord (Viterbi with a cost for changing).
  const change = 0.12;
  let prev = score[0].slice();
  const back: number[][] = [];
  for (let i = 1; i < cells.length; i++) {
    let bestPrev = 0;
    for (let j = 1; j < S; j++) if (prev[j] > prev[bestPrev]) bestPrev = j;
    const cur = new Array(S);
    const bk = new Array(S);
    for (let j = 0; j < S; j++) {
      const stay = prev[j], move = prev[bestPrev] - change;
      if (stay >= move) {
        cur[j] = stay + score[i][j];
        bk[j] = j;
      } else {
        cur[j] = move + score[i][j];
        bk[j] = bestPrev;
      }
    }
    back.push(bk);
    prev = cur;
  }
  let last = 0;
  for (let j = 1; j < S; j++) if (prev[j] > prev[last]) last = j;
  const path = new Array(cells.length);
  path[cells.length - 1] = last;
  for (let i = cells.length - 2; i >= 0; i--) path[i] = back[i][path[i + 1]];

  // Key from the whole song's notes.
  const total = new Array(12).fill(0);
  cells.forEach((c) => !c.quiet && c.c.forEach((v, p) => (total[p] += v)));
  let key = "C", bestK = -2;
  for (let r = 0; r < 12; r++) {
    const rot = (prof: number[]) => prof.map((_, i) => prof[(i - r + 12) % 12]);
    const cM = corr(total, rot(MAJ)), cm = corr(total, rot(MIN));
    if (cM > bestK) {
      bestK = cM;
      key = KEYS[r];
    }
    if (cm > bestK) {
      bestK = cm;
      key = KEYS[r] + "m";
    }
  }
  const flats = prefersFlats(key) || /^(F|Bb|Eb|Ab|Db|Gb)$/.test(key);
  const spell = (name: string) => transposeChord(name, 0, flats);

  // Merge into chord spans; quiet stretches have no chord.
  const chords: HeardChord[] = [];
  cells.forEach((cell, i) => {
    const name = cell.quiet ? "" : spell(SHAPES[path[i]].name);
    const lastC = chords[chords.length - 1];
    if (lastC && lastC.name === name) lastC.end = cell.end;
    else chords.push({ t: cell.t, end: cell.end, name });
  });
  return { chords: chords.filter((c) => c.name), key };
}

/** The chord progression inside a time range: "G D Em C" (repeats collapsed, very short blips skipped). */
export function progression(chords: HeardChord[], from: number, to: number, minLen = 0.45): string[] {
  const out: string[] = [];
  for (const c of chords) {
    if (c.end <= from || c.t >= to) continue;
    const len = Math.min(c.end, to) - Math.max(c.t, from);
    if (len < minLen) continue;
    if (out[out.length - 1] !== c.name) out.push(c.name);
  }
  return loopOf(out);
}

/** "G D Em C G D Em C G D" → "G D Em C": the repeating pattern, written once. */
export function loopOf(seq: string[]): string[] {
  for (let p = 2; p <= Math.floor(seq.length / 2); p++) {
    // the whole sequence repeats every p chords (a partial last round is fine), allowing one odd chord in long runs
    let miss = 0;
    for (let i = p; i < seq.length; i++) if (seq[i] !== seq[i % p]) miss++;
    if (miss <= (seq.length >= 12 ? 1 : 0)) return seq.slice(0, p);
  }
  return seq;
}
