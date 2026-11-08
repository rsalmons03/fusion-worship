// Finds a song's tempo (BPM) and where its beats fall, from the decoded audio.
// Used when a song has no BPM entered, so the guide can count "2, 3, 4" on the beat.

export type Tempo = { bpm: number; offset: number };

export function detectTempo(data: Float32Array, sampleRate: number): Tempo | null {
  const hop = 512;
  // Analyse up to 90 s from the middle of the song (intros are often free-time).
  const total = Math.floor(data.length / hop);
  const want = Math.floor((90 * sampleRate) / hop);
  const startFrame = total > want ? Math.floor((total - want) / 3) : 0;
  const frames = Math.min(total - startFrame, want);
  if (frames < 400) return null;

  // Onset strength: rises in loudness, frame to frame.
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const base = (startFrame + f) * hop;
    for (let i = 1; i < hop; i += 2) {
      const d = data[base + i] - data[base + i - 1]; // emphasise attacks (drums, strums)
      e += d * d;
    }
    e = Math.sqrt(e);
    env[f] = Math.max(0, e - prev);
    prev = e;
  }
  let mean = 0;
  for (const v of env) mean += v;
  mean /= frames;
  for (let f = 0; f < frames; f++) env[f] = Math.max(0, env[f] - mean);

  // Autocorrelation over 60–180 BPM, gently preferring common worship tempos.
  const fps = sampleRate / hop;
  let best = 0, bestLag = 0;
  const minLag = Math.floor((60 / 180) * fps), maxLag = Math.ceil((60 / 60) * fps);
  const score: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += env[f] * env[f - lag];
    const bpm = (60 * fps) / lag;
    const w = bpm >= 66 && bpm <= 160 ? 1 : 0.75;
    score[lag] = s * w;
    if (score[lag] > best) {
      best = score[lag];
      bestLag = lag;
    }
  }
  if (!bestLag) return null;
  // Half-time check: a slow reading whose double also fits well is probably the faster tempo.
  const half = Math.round(bestLag / 2);
  const halfScore = Math.max(score[half - 1] ?? 0, score[half] ?? 0, score[half + 1] ?? 0);
  if ((60 * fps) / bestLag < 88 && half >= minLag && halfScore > best * 0.45) {
    bestLag = half;
    best = score[half];
  }
  // Refine between frames (parabolic peak).
  const a = score[bestLag - 1] ?? best, b = best, c = score[bestLag + 1] ?? best;
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const period = bestLag + Math.max(-0.5, Math.min(0.5, shift));
  const bpm = Math.round((60 * fps) / period);
  const beatFrames = (60 * fps) / bpm; // use the rounded tempo so the grid doesn't drift

  // Beat phase: circular average of onsets around the beat period.
  let sx = 0, sy = 0;
  for (let f = 0; f < frames; f++) {
    const ang = (2 * Math.PI * f) / beatFrames;
    sx += env[f] * Math.cos(ang);
    sy += env[f] * Math.sin(ang);
  }
  let ph = (Math.atan2(sy, sx) / (2 * Math.PI)) * beatFrames;
  if (ph < 0) ph += beatFrames;
  const bestPh = ph;
  const spb = 60 / bpm;
  let offset = ((startFrame + bestPh) * hop) / sampleRate;
  offset = offset % spb;
  return { bpm, offset };
}

/** Moves a time to the nearest beat. */
export function snapToBeat(t: number, tempo: Tempo | null, bpm: number | null | undefined) {
  if (!tempo || !bpm) return t;
  const spb = 60 / bpm;
  const k = Math.round((t - tempo.offset) / spb);
  return tempo.offset + k * spb;
}

/**
 * Beat tracking (dynamic programming, after Ellis 2007): finds every beat in a recording, following small
 * tempo changes, so a generated click lines up with a live band. Returns the beat times (s) and the tempo.
 */
export function trackBeats(data: Float32Array, sampleRate: number, bpmHint?: number | null): { bpm: number; beats: number[] } | null {
  const hop = 256;
  const fps = sampleRate / hop;
  const n = Math.floor(data.length / hop);
  if (n < fps * 8) return null;
  // onset strength
  const env = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let e = 0;
    const base = f * hop;
    for (let i = 1; i < hop; i++) {
      const d = data[base + i] - data[base + i - 1];
      e += d * d;
    }
    e = Math.sqrt(e);
    env[f] = Math.max(0, e - prev);
    prev = e;
  }
  let mean = 0, sd = 0;
  for (const v of env) mean += v;
  mean /= n;
  for (const v of env) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  for (let f = 0; f < n; f++) env[f] = (env[f] - mean) / sd;

  // tempo: autocorrelation at fine (quarter-BPM) resolution, preferring 60–160 BPM
  let period: number;
  if (bpmHint) period = (60 * fps) / bpmHint;
  else {
    let best = -Infinity, bestBpm = 0;
    for (let bpm = 55; bpm <= 180; bpm += 0.25) {
      const lag = (60 * fps) / bpm;
      const l = Math.round(lag), l2 = Math.round(2 * lag);
      let s = 0;
      for (let f = l2; f < n; f++) s += env[f] * env[f - l] + 0.5 * env[f] * env[f - l2];
      s *= bpm >= 60 && bpm <= 160 ? 1 : 0.8;
      if (s > best) {
        best = s;
        bestBpm = bpm;
      }
    }
    // a slow reading whose double fits nearly as well is probably the faster tempo
    period = (60 * fps) / bestBpm;
  }

  // dynamic programming: best chain of beats roughly one period apart, landing on strong onsets
  const tight = 100;
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestV = 0, bestP = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const r = Math.log((t - p) / period);
      const v = score[p] - tight * r * r;
      if (bestP < 0 || v > bestV) {
        bestV = v;
        bestP = p;
      }
    }
    score[t] = env[t] + (bestP >= 0 ? bestV : 0);
    back[t] = bestP;
  }
  // start from the best-scoring frame in the last period and walk back
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();
  // refine each beat to the onset peak nearby (sub-frame)
  const beats = frames.map((f) => {
    let m = f;
    for (let k = f - 2; k <= f + 2; k++) if (k > 0 && k < n - 1 && env[k] > env[m]) m = k;
    const a = env[m - 1] ?? 0, b = env[m], c = env[m + 1] ?? 0;
    const d = a - 2 * b + c;
    const off = d ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
    return ((m + off) * hop) / sampleRate;
  });
  const span = beats.length > 1 ? beats[beats.length - 1] - beats[0] : 0;
  const bpm = span ? (60 * (beats.length - 1)) / span : (60 * fps) / period;
  return { bpm: Math.round(bpm * 100) / 100, beats };
}
