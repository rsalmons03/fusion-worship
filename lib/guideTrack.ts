// Builds CLICK and GUIDE channels for a song that doesn't come with them, as real audio the same
// length as the song (plus a count-in before it), so the multitrack engine plays them perfectly in step.
import { cueBuffer, type CueVoiceId } from "./cueVoice";
import { detectTempo, trackBeats } from "./tempo";

export type GuideSpec = {
  duration: number; // song length (s)
  /** Every beat of the song (s), from the first downbeat on, following the band's real timing. */
  beats: number[];
  beatsPerBar: number;
  countBars: 0 | 1 | 2; // count-in length
  sections: { label: string; t: number }[]; // section starts (song time)
  voice: CueVoiceId;
  rate: number;
};
export type Generated = { click: AudioBuffer; guide: AudioBuffer; preroll: number };

/** One woodblock-style tick (downbeat a little higher), as samples. */
function tickSamples(rate: number, accent: boolean) {
  const n = Math.floor(rate * 0.06);
  const out = new Float32Array(n);
  const f = accent ? 1250 : 850;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.001) * Math.exp(-t / 0.0065);
    out[i] = 0.9 * env * (0.9 * Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.7 * t));
  }
  return out;
}

/** Mono samples of a clip at the target rate (simple linear resample). */
function monoAt(b: AudioBuffer, rate: number) {
  const src = b.getChannelData(0);
  const ratio = b.sampleRate / rate;
  const n = Math.floor(src.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const fr = x - j;
    out[i] = (src[j] ?? 0) * (1 - fr) + (src[j + 1] ?? 0) * fr;
  }
  return out;
}

function mixIn(dst: Float32Array, clip: Float32Array, at: number, rate: number) {
  const o = Math.round(at * rate);
  for (let i = 0; i < clip.length; i++) {
    const k = o + i;
    if (k >= 0 && k < dst.length) dst[k] += clip[i];
  }
}

function toBuffer(data: Float32Array, rate: number): AudioBuffer {
  const b = new AudioBuffer({ length: data.length, sampleRate: rate, numberOfChannels: 1 });
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return b;
}

export async function renderGuide(spec: GuideSpec): Promise<Generated> {
  const { duration, beats, beatsPerBar: B, countBars, sections, voice, rate } = spec;
  if (!beats.length) throw new Error("no beats");
  const firstBeat = beats[0];
  // count-in tempo = the band's tempo at the start
  const early = beats.slice(1, 9).map((t, i) => t - beats[i]).sort((a, b) => a - b);
  const spb = early.length ? early[Math.floor(early.length / 2)] : 0.75;
  const N = countBars * B;
  // Time before the song starts so the count-in fits; the count ends exactly one beat before the first downbeat.
  const preroll = Math.max(0, N * spb - firstBeat);
  const len = Math.ceil((preroll + duration + 0.5) * rate);

  // CLICK: count-in beats, then on every beat the band plays (following tempo changes).
  const click = new Float32Array(len);
  const hi = tickSamples(rate, true), lo = tickSamples(rate, false);
  for (let i = 0; i < N; i++) mixIn(click, i % B === 0 ? hi : lo, preroll + firstBeat - (N - i) * spb, rate);
  beats.forEach((t, k) => t < duration && mixIn(click, k % B === 0 ? hi : lo, preroll + t, rate));

  // GUIDE: "1 · 2 · | 1 2 3 4" over the count-in, then each section called on the downbeat a bar before it.
  const guide = new Float32Array(len);
  const calls: { label: string; at: number }[] = [];
  for (let i = 0; i < N; i++) {
    const beat = i % B;
    const word = countBars === 2 && i < B ? (beat === 0 ? "1" : B % 2 === 0 && beat === B / 2 ? "2" : "") : String(beat + 1);
    if (word) calls.push({ label: word, at: preroll + firstBeat - (N - i) * spb });
  }
  for (const s of sections) {
    if (s.t < firstBeat + 0.5) continue; // the first section is covered by the count-in
    // the beat nearest the section start, then one bar back
    let k = 0;
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - s.t) < Math.abs(beats[k] - s.t)) k = i;
    const at = k - B >= 0 ? beats[k - B] : beats[k] - B * spb;
    calls.push({ label: s.label, at: preroll + at });
  }
  const clips = new Map<string, Float32Array | null>();
  await Promise.all(
    [...new Set(calls.map((c) => c.label))].map(async (l) => {
      const b = await cueBuffer(voice, l);
      clips.set(l, b ? monoAt(b, rate) : null);
    })
  );
  for (const c of calls) {
    const clip = clips.get(c.label);
    if (clip && c.at >= 0) mixIn(guide, clip, c.at, rate);
  }
  return { click: toBuffer(click, rate), guide: toBuffer(guide, rate), preroll };
}

/**
 * Every beat of the song, heard in its parts (drums first), following the band's real timing.
 * Beats start at the first one where the music is playing (taken as the first downbeat).
 */
export function hearBeat(buffers: { name: string; buffer: AudioBuffer }[], bpmHint?: number | null) {
  const pick = buffers.find((b) => /drum|perc/i.test(b.name)) ?? buffers[0];
  const data = pick.buffer.getChannelData(0);
  const sr = pick.buffer.sampleRate;
  // rough tempo first (or the song's BPM), then follow every beat
  const rough = bpmHint || detectTempo(data, sr)?.bpm || null;
  const tr = trackBeats(data, sr, rough);
  if (!tr || tr.beats.length < 8) return null;
  // When the music starts: first moment any part gets loud.
  let tSound = Infinity;
  for (const { buffer } of buffers) {
    const d = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
    const thr = peak * 0.12;
    for (let i = 0; i < d.length; i += 32)
      if (Math.abs(d[i]) > thr) {
        tSound = Math.min(tSound, i / buffer.sampleRate);
        break;
      }
  }
  if (!isFinite(tSound)) tSound = 0;
  const beats = tr.beats.filter((t) => t >= tSound - 0.08);
  return { bpm: Math.round(tr.bpm), beats, firstBeat: beats[0] ?? 0, heard: !bpmHint };
}
