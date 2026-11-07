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
  "down-chorus", "big-chorus", "last-chorus", "final-chorus", "half-chorus", "spontaneous", "exhort", "reprise", "rap", "swell",
  "a-cappella", "break", "drums-only", "build-2", "build-3", "breakdown-2", "post-chorus-2", "vamp-2", "turnaround-2", "hold", "key-change",
]);

/** "Pre Chorus 2 (x2):" → "pre-chorus-2"; falls back to the section word without its number. */
export function cueSlug(label: string): string | null {
  let s = label.toLowerCase().replace(/\(.*?\)/g, "").replace(/[:.]/g, " ").trim();
  s = s.replace(/\bpre\s*-?\s*chorus/, "pre-chorus").replace(/\bpost\s*-?\s*chorus/, "post-chorus").replace(/\s*(x\s*\d+|\d+\s*x)\s*$/, "").replace(/\bexhortation\b/, "exhort").replace(/\bacappella\b/, "a cappella");
  s = s.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (HAVE.has(s)) return s;
  const base = s.replace(/-?\d+$/, "");
  return HAVE.has(base) ? base : null;
}

let ctx: AudioContext | null = null;

/**
 * iPhones mute web sound when the ring/silent switch is on, unless the page says it's a player (like a music app).
 * Safari 16.4+ supports navigator.audioSession.
 */
export function playThroughSilentSwitch() {
  try {
    const n = navigator as unknown as { audioSession?: { type: string } };
    if (n.audioSession && n.audioSession.type !== "playback") n.audioSession.type = "playback";
  } catch {}
}
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Decodes audio without a live audio engine (iPhones glitch when extra engines run). */
export function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const W = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
  const c = OAC ? new OAC(1, 1, 44100) : context();
  if (!c) return Promise.reject(new Error("no audio"));
  return new Promise((res, rej) => c.decodeAudioData(data, res, rej));
}

/** The page's single live audio engine: music, stems, key change, guide voice and metronome all share it. */
export function sharedAudio() {
  return context();
}

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
  playThroughSilentSwitch();
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
    buffers.set(
      key,
      typeof window !== "undefined"
        ? fetch(`/cues/${key}.mp3`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
            .then(decodeAudio)
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
export async function sayCue(
  voice: CueVoiceId,
  label: string,
  opts: { when?: number; volume?: number } = {}
): Promise<{ stop: () => void; duration: number }> {
  const slug = voice === "device" ? null : cueSlug(label);
  const c = slug ? context() : null;
  const buf = slug && c ? await load(voice, slug) : null;
  if (!c || !buf) {
    // Phone voice can't be scheduled exactly: wait, then speak.
    const delay = opts.when && c ? Math.max(0, (opts.when - c.currentTime) * 1000) : 0;
    const id = window.setTimeout(() => speakDevice(label), delay);
    return { stop: () => window.clearTimeout(id), duration: 0.7 };
  }
  const s = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = opts.volume ?? 1;
  s.buffer = buf;
  s.connect(g).connect(c.destination);
  s.start(opts.when ?? 0);
  return {
    stop: () => {
      try {
        s.stop();
      } catch {}
    },
    duration: buf.duration,
  };
}

/** Length of a cue clip in seconds (0 if not loaded yet). */
export async function cueLength(voice: CueVoiceId, label: string) {
  const slug = voice === "device" ? null : cueSlug(label);
  if (!slug) return 0.7;
  const b = await load(voice, slug);
  return b?.duration ?? 0.7;
}

/** The cue clock (seconds), for scheduling counts exactly on the beat. */
export function cueClock() {
  return context()?.currentTime ?? 0;
}

/**
 * A click like a guide track's: a short woodblock "tock" (the downbeat a little higher),
 * scheduled on the cue clock. Returns a way to cancel it.
 */
export function cueClick(at: number, accent: boolean, volume = 0.6): { stop: () => void } {
  const c = context();
  if (!c) return { stop: () => {} };
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(c.destination);
  const f = accent ? 1250 : 850;
  const nodes: AudioScheduledSourceNode[] = [];
  // body: two short sine partials with a fast decay
  for (const [mult, amp] of [[1, 0.9], [2.7, 0.35]] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0008, at + 0.045);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.06);
    nodes.push(o);
  }
  // attack: a tiny filtered noise tick
  const len = Math.floor(c.sampleRate * 0.006);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = c.createBufferSource();
  n.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const ng = c.createGain();
  ng.gain.value = 0.35;
  n.connect(hp).connect(ng).connect(out);
  n.start(at);
  nodes.push(n);
  return {
    stop: () =>
      nodes.forEach((x) => {
        try {
          x.stop();
        } catch {}
      }),
  };
}
