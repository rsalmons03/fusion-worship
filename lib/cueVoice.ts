// Recorded guide-voice clips ("Verse 1", "Chorus", "3, 2, 1"…) in /public/cues/<voice>/<slug>.mp3.
// Played through Web Audio so they keep working on iPhone after the first tap.

export const CUE_VOICES = [
  { id: "male", name: "Male voice" },
  { id: "female", name: "Female voice" },
  { id: "device", name: "Phone's voice" },
] as const;
export type CueVoiceId = (typeof CUE_VOICES)[number]["id"];

const HAVE = new Set([
  "intro", "verse", "pre-chorus", "chorus", "post-chorus", "bridge", "tag", "interlude", "instrumental", "outro", "ending",
  "turnaround", "vamp", "refrain", "coda", "breakdown", "build", "hook", "solo", "cues-on", "last-time", "all-in",
  ...[1, 2, 3, 4, 5, 6].map((i) => `verse-${i}`),
  ...[1, 2, 3, 4].flatMap((i) => [`chorus-${i}`, `pre-chorus-${i}`, `bridge-${i}`, `tag-${i}`, `interlude-${i}`, `instrumental-${i}`]),
  ..."12345678".split(""),
]);

/** "Pre Chorus 2 (x2):" → "pre-chorus-2"; falls back to the section word without its number. */
export function cueSlug(label: string): string | null {
  let s = label.toLowerCase().replace(/\(.*?\)/g, "").replace(/[:.]/g, " ").trim();
  s = s.replace(/\bpre\s*-?\s*chorus/, "pre-chorus").replace(/\bpost\s*-?\s*chorus/, "post-chorus");
  s = s.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (HAVE.has(s)) return s;
  const base = s.replace(/-?\d+$/, "");
  return HAVE.has(base) ? base : null;
}

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function context() {
  if (typeof window === "undefined") return null;
  if (!ctx || ctx.state === "closed") {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

/** Call from a tap: lets the voice play later without another tap (iPhone). */
export function unlockCues() {
  const c = context();
  if (!c) return;
  c.resume().catch(() => {});
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start(0);
}

function load(voice: string, slug: string) {
  const key = `${voice}/${slug}`;
  if (!buffers.has(key)) {
    const c = context();
    buffers.set(
      key,
      c
        ? fetch(`/cues/${key}.mp3`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
            .then((ab) => new Promise<AudioBuffer>((res, rej) => c.decodeAudioData(ab, res, rej)))
            .catch(() => null)
        : Promise.resolve(null)
    );
  }
  return buffers.get(key)!;
}

/** Fetch clips ahead of time so cues are on the beat. */
export function preloadCues(voice: CueVoiceId, labels: string[]) {
  if (voice === "device") return;
  for (const l of labels) {
    const s = cueSlug(l);
    if (s) load(voice, s);
  }
}

function speakDevice(text: string, rate = 1.15) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  // Prefer the nicer voices phones ship with.
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  u.voice = vs.find((v) => /premium|enhanced|natural|neural/i.test(v.name)) ?? vs.find((v) => /samantha|google us english|aaron|nicky/i.test(v.name)) ?? null;
  speechSynthesis.speak(u);
}

/** Say a cue now (or at `when` seconds on the cue clock). Falls back to the phone's voice when there's no clip. */
export async function sayCue(voice: CueVoiceId, label: string, opts: { when?: number; volume?: number } = {}) {
  const slug = voice === "device" ? null : cueSlug(label);
  const c = slug ? context() : null;
  const buf = slug && c ? await load(voice, slug) : null;
  if (!c || !buf) return speakDevice(label);
  const s = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = opts.volume ?? 1;
  s.buffer = buf;
  s.connect(g).connect(c.destination);
  s.start(opts.when ?? 0);
}

/** The cue clock (seconds), for scheduling counts exactly on the beat. */
export function cueClock() {
  return context()?.currentTime ?? 0;
}

/** A metronome click on the cue clock. */
export function cueClick(at: number, accent: boolean) {
  const c = context();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1500 : 1000;
  g.gain.setValueAtTime(0.45, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + 0.07);
}
