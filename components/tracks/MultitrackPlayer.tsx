"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAudio, sharedAudio, unlockCues, type CueVoiceId } from "@/lib/cueVoice";
import { hearBeat, renderGuide, type Generated } from "@/lib/guideTrack";
import { createPitchShifter } from "@/lib/pitchShift";

// ── Fusion Tracks: multitrack player ──
// Every part is decoded into memory and started at the same instant on the audio clock, so the parts
// stay locked together (no streaming, no drift). Each channel: fader, pan, mute, solo, level meter.
// Pan doubles as routing for a split cable: Click/Guide hard left (in-ears), band hard right (mains).

export type Stem = { id: string; name: string; url: string };

// Phones/tablets have far less memory than a Mac: there, each part is kept as mono at 24 kHz
// (about a sixth of the memory; fine for practice in headphones). Macs/PCs keep full quality.
const LIGHT =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator as Navigator & { deviceMemory?: number }).deviceMemory! <= 4 || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
async function lighten(b: AudioBuffer): Promise<AudioBuffer> {
  const rate = 24000;
  const W = window as unknown as { OfflineAudioContext: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
  if (!OAC) return b;
  const off = new OAC(1, Math.ceil(b.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = b;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}
type Ch = { vol: number; pan: number; mute: boolean; solo: boolean };

const ORDER = ["click", "guide", "cue", "drum", "perc", "loop", "bass", "lead", "vocal", "vox", "bgv", "back", "key", "piano", "organ", "synth", "pad", "acoustic", "electric", "guitar", "string", "other"];
const rank = (n: string) => {
  if (/back(ing|ground)?[\s_-]*vo|bgv|harmon/i.test(n)) return ORDER.indexOf("bgv");
  const i = ORDER.findIndex((w) => n.toLowerCase().includes(w));
  return i < 0 ? ORDER.length : i;
};
const isLeftPart = (n: string) => /click|guide|cue/i.test(n);
/** Clean channel labels: drop the song title shared by every file name, "mixed", "_2"… and use mixer shorthand. */
const words = (n: string) =>
  n
    .replace(/\s*\(split.*\)$/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[\s_\-]+/)
    .filter(Boolean);
function labels(names: string[]): string[] {
  const ws = names.map(words);
  let common = 0;
  if (ws.length > 1) {
    while (ws.every((w) => w.length > common + 1 && w[common].toLowerCase() === ws[0][common].toLowerCase())) common++;
  }
  const SHORT: [RegExp, string][] = [
    [/^background vocals?|^backing vocals?|^bgvs?/i, "BGV"],
    [/^lead vocals?|^vocals?|^vox/i, "LEAD VOX"],
    [/^electric guitar|^elec(tric)? gtr|^eg/i, "ELEC GTR"],
    [/^acoustic guitar|^ac(oustic)? gtr|^ag/i, "AC GTR"],
    [/^synth(esizer)?/i, "SYNTH"],
  ];
  return ws.map((w) => {
    let t = w
      .slice(common)
      .filter((x) => !/^(mixed|stem|stems|track|final|master|live)$/i.test(x))
      .join(" ")
      .replace(/([a-z])(\d+)$/i, "$1 $2");
    const num = t.match(/\s(\d+)$/)?.[1];
    const base = num ? t.slice(0, -num.length - 1) : t;
    const hit = SHORT.find(([re]) => re.test(base));
    t = hit ? hit[1] + (num && num !== "1" ? ` ${num}` : "") : base + (num && num !== "1" && num !== "2" ? ` ${num}` : "");
    return (t || "PART").toUpperCase().slice(0, 16);
  });
}
const fmt = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
const defaults = (stems: Stem[]): Record<string, Ch> => Object.fromEntries(stems.map((s) => [s.id, { vol: 0.8, pan: 0, mute: false, solo: false }]));

export default function MultitrackPlayer({
  songKey,
  title,
  artist,
  bpm,
  meter,
  stems: stemsIn,
  storageKey,
  onTime,
  sections = [],
  voice = "male",
}: {
  songKey: string;
  title: string;
  artist?: string | null;
  bpm?: number | null;
  meter?: string | null;
  stems: Stem[];
  /** Where this song's mix is remembered (per device). */
  storageKey: string;
  /** Playback position, for lyrics / chords following along. */
  onTime?: (t: number, playing: boolean) => void;
  /** Section starts (song time) for the guide's calls. */
  sections?: { label: string; t: number }[];
  /** Guide voice: the team's recorded voice, or a built-in one. */
  voice?: CueVoiceId;
}) {
  const real = [...stemsIn].sort((a, b) => rank(a.name) - rank(b.name));
  // Songs without their own Click / Guide parts get generated ones (as real channels).
  const hasClick = real.some((s) => /click/i.test(s.name));
  const hasGuide = real.some((s) => /guide|cue/i.test(s.name));
  const virtual: Stem[] = [...(hasClick ? [] : [{ id: "_click", name: "Click", url: "" }]), ...(hasGuide ? [] : [{ id: "_guide", name: "Guide", url: "" }])];
  const stems = [...virtual, ...real];
  const names = [...virtual.map((v) => v.name.toUpperCase()), ...labels(real.map((s) => s.name))];
  const [buffers, setBuffers] = useState<Map<string, AudioBuffer>>(new Map());
  const [loading, setLoading] = useState({ done: 0, total: stemsIn.length, error: "" });
  const [mix, setMix] = useState<Record<string, Ch>>(() => defaults(stems));
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [countingIn, setCountingIn] = useState(false);
  const [split, setSplit] = useState(false);
  const duration = Math.max(0, ...[...buffers.values()].map((b) => b.duration));

  // ── Load every part into memory (with progress) ──
  const stemKey = stems.map((s) => s.id).join();
  useEffect(() => {
    let alive = true;
    setBuffers(new Map());
    setLoading({ done: 0, total: real.length, error: "" });
    (async () => {
      const out = new Map<string, AudioBuffer>();
      let done = 0;
      await Promise.all(
        real.map(async (s) => {
          try {
            const r = await fetch(s.url);
            if (!r.ok) throw new Error(`${s.name}: ${r.status}`);
            const full = await decodeAudio(await r.arrayBuffer());
            out.set(s.id, LIGHT ? await lighten(full) : full);
          } catch (e) {
            if (alive) setLoading((l) => ({ ...l, error: (e as Error).message }));
          }
          done++;
          if (alive) setLoading((l) => ({ ...l, done }));
        })
      );
      if (alive) setBuffers(out);
    })();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      setMix({ ...defaults(stems), ...(saved?.mix ?? {}) });
      if (typeof saved?.split === "boolean") setSplit(saved.split);
    } catch {
      setMix(defaults(stems));
    }
    return () => {
      alive = false;
    };
  }, [stemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ mix, split }));
    } catch {}
  }, [mix, split, storageKey]);

  // ── Generated Click + Guide (with count-in), built once the parts are loaded ──
  const [countIn, setCountInState] = useState<0 | 1 | 2>(2);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("fw.tracks.countin") ?? "2");
      if (v === 0 || v === 1 || v === 2) setCountInState(v);
    } catch {}
  }, []);
  const setCountIn = (v: 0 | 1 | 2) => {
    setCountInState(v);
    try {
      localStorage.setItem("fw.tracks.countin", String(v));
    } catch {}
  };
  const [beat, setBeat] = useState<{ bpm: number; beats: number[]; firstBeat: number; heard: boolean } | null>(null);
  const [gen, setGen] = useState<Generated | null>(null);
  const [genFailed, setGenFailed] = useState(false);
  const genRef = useRef<Generated | null>(null);
  genRef.current = gen;
  useEffect(() => {
    setBeat(null);
    setGen(null);
    setGenFailed(false);
    if (!virtual.length || buffers.size < real.length || !buffers.size) return;
    // tempo + first downbeat, heard in the parts (drums first)
    const t = window.setTimeout(() => {
      try {
        const b = hearBeat(real.filter((s) => buffers.get(s.id)).map((s) => ({ name: s.name, buffer: buffers.get(s.id)! })), bpm);
        if (b) setBeat(b);
        else setGenFailed(true); // no tempo found: play without a click
      } catch {
        setGenFailed(true);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [buffers, bpm]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionKey = sections.map((x) => `${x.label}@${x.t.toFixed(2)}`).join();
  useEffect(() => {
    if (!beat || !duration) return;
    let alive = true;
    const rate = LIGHT ? 24000 : 44100;
    renderGuide({ duration, beats: beat.beats, beatsPerBar: Math.max(2, Math.min(12, parseInt(meter ?? "", 10) || 4)), countBars: countIn, sections, voice, rate })
      .then((g) => alive && setGen(g))
      .catch(() => alive && setGenFailed(true));
    return () => {
      alive = false;
    };
  }, [beat, countIn, voice, sectionKey, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audio graph: part → fader → pan → meter → mute/solo → master (→ key change) → speakers ──
  type Node = { fader: GainNode; pan: StereoPannerNode; meter: AnalyserNode; gate: GainNode; src?: AudioBufferSourceNode };
  const graph = useRef<{ ctx: AudioContext; master: GainNode; out: DynamicsCompressorNode; shifter: AudioWorkletNode | null; nodes: Map<string, Node> } | null>(null);
  const build = useCallback(() => {
    if (graph.current) return graph.current;
    const ctx = sharedAudio();
    if (!ctx) return null;
    const master = ctx.createGain();
    master.gain.value = 0.8; // headroom: parts add up
    // Safety limiter so the soundboard never gets a clipped signal.
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -3;
    out.knee.value = 0;
    out.ratio.value = 20;
    out.attack.value = 0.002;
    out.release.value = 0.12;
    master.connect(out).connect(ctx.destination);
    const nodes = new Map<string, Node>();
    for (const s of stems) {
      const fader = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const meter = ctx.createAnalyser();
      meter.fftSize = 512;
      const gate = ctx.createGain();
      fader.connect(pan).connect(meter).connect(gate).connect(master);
      nodes.set(s.id, { fader, pan, meter, gate });
    }
    graph.current = { ctx, master, out, shifter: null, nodes };
    return graph.current;
  }, [stemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      graph.current?.nodes.forEach((n) => {
        try {
          n.src?.stop();
        } catch {}
        n.gate.disconnect();
      });
      graph.current?.master.disconnect();
      graph.current?.out.disconnect();
      graph.current = null;
    },
    [stemKey]
  );

  // Apply the mix (fader, pan, mute/solo). In split mode, pan routes: in-ear parts left, band right.
  const anySolo = Object.values(mix).some((c) => c.solo);
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    for (const s of stems) {
      const n = g.nodes.get(s.id);
      const c = mix[s.id];
      if (!n || !c) continue;
      n.fader.gain.setTargetAtTime(c.vol, g.ctx.currentTime, 0.015);
      n.pan.pan.setTargetAtTime(split ? (isLeftPart(s.name) ? -1 : 1) : c.pan, g.ctx.currentTime, 0.015);
      const audible = anySolo ? c.solo : !c.mute;
      n.gate.gain.setTargetAtTime(audible ? 1 : 0, g.ctx.currentTime, 0.01);
    }
  });

  // Key change on the master.
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    let off = false;
    (async () => {
      if (pitch && !g.shifter) g.shifter = await createPitchShifter(g.ctx);
      if (off) return;
      g.master.disconnect();
      if (pitch && g.shifter) {
        g.shifter.parameters.get("semitones")?.setValueAtTime(pitch, g.ctx.currentTime);
        g.master.connect(g.shifter);
        g.shifter.disconnect();
        g.shifter.connect(g.out);
      } else g.master.connect(g.out);
    })();
    return () => {
      off = true;
    };
  }, [pitch, playing]);

  // ── Transport: all parts start together at one instant on the audio clock ──
  const clock = useRef<{ startCtx: number; startPos: number } | null>(null);
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  const [loop, setLoopState] = useState<{ start: number; end: number } | null>(null);
  const position = useCallback(() => {
    const g = graph.current;
    const c = clock.current;
    if (!g || !c) return pos;
    let t = c.startPos + (g.ctx.currentTime - c.startCtx);
    const l = loopRef.current;
    if (l && t > l.end) t = l.start + ((t - l.start) % (l.end - l.start));
    return t;
  }, [pos]);
  const stopSources = () => graph.current?.nodes.forEach((n) => {
    try {
      n.src?.stop();
    } catch {}
    n.src = undefined;
  });
  function startAt(offset: number) {
    const g = build();
    if (!g || !buffers.size) return;
    unlockCues();
    g.ctx.resume().catch(() => {});
    stopSources();
    const when = g.ctx.currentTime + 0.06;
    const ge = genRef.current;
    const P = ge?.preroll ?? 0;
    // From the top with a count-in: the generated Click/Guide start at their count-in, the parts start after it.
    const counting = !!ge && countIn > 0 && offset < 0.05;
    const songStart = when + (counting ? P : 0);
    for (const s of stems) {
      const isGen = s.id === "_click" || s.id === "_guide";
      const b = isGen ? (s.id === "_click" ? ge?.click : ge?.guide) : buffers.get(s.id);
      const n = g.nodes.get(s.id);
      if (!b || !n) continue;
      const src = g.ctx.createBufferSource();
      src.buffer = b;
      const shift = isGen ? P : 0; // generated audio has the count-in before the song
      const l = loopRef.current;
      if (l) {
        src.loop = true;
        src.loopStart = l.start + shift;
        src.loopEnd = l.end + shift;
      }
      src.connect(n.fader);
      if (isGen) src.start(when, counting ? 0 : Math.min(offset + shift, b.duration - 0.01));
      else src.start(songStart, Math.min(offset, b.duration - 0.01));
      n.src = src;
    }
    clock.current = { startCtx: songStart, startPos: offset };
    setPlaying(true);
  }
  function pause() {
    const t = position();
    stopSources();
    clock.current = null;
    setPlaying(false);
    setPos(t);
  }
  function seek(t: number) {
    const to = Math.max(0, Math.min(duration - 0.05, t));
    if (playing) startAt(to);
    else setPos(to);
  }
  /** Vamp: loop a range seamlessly (all parts loop on the same sample). */
  function setLoop(l: { start: number; end: number } | null) {
    loopRef.current = l;
    setLoopState(l);
    const g = graph.current;
    if (!g || !playing) return;
    const t = position();
    const P = genRef.current?.preroll ?? 0;
    for (const [id, n] of g.nodes) {
      if (!n.src) continue;
      const shift = id === "_click" || id === "_guide" ? P : 0;
      n.src.loop = !!l;
      if (l) {
        n.src.loopStart = l.start + shift;
        n.src.loopEnd = l.end + shift;
      }
    }
    // keep the position clock right when a loop is released
    if (!l) clock.current = { startCtx: g.ctx.currentTime, startPos: t };
  }

  // Position + level meters, every frame while playing.
  const meters = useRef<Map<string, HTMLDivElement>>(new Map());
  const cb = useRef(onTime);
  cb.current = onTime;
  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(512);
    const frame = () => {
      const g = graph.current;
      if (playing && g) {
        const t = position();
        if (t >= duration && !loopRef.current) {
          pause();
          setPos(0);
          return;
        }
        setPos(Math.max(0, t));
        setCountingIn(t < 0);
        cb.current?.(Math.max(0, t), true);
        for (const s of stems) {
          const n = g.nodes.get(s.id);
          const el = meters.current.get(s.id);
          if (!n || !el) continue;
          n.meter.getFloatTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          const audible = anySolo ? mix[s.id]?.solo : !mix[s.id]?.mute;
          el.style.height = `${audible ? Math.min(100, Math.sqrt(peak) * 100) : 0}%`;
        }
      } else meters.current.forEach((el) => (el.style.height = "0%"));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop when leaving the song.
  useEffect(() => () => stopSources(), [songKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = buffers.size > 0 && loading.done >= loading.total && (!virtual.length || !!gen || genFailed);
  const setCh = (id: string, p: Partial<Ch>) => setMix((m) => ({ ...m, [id]: { ...m[id], ...p } }));

  return (
    <div className="flex h-full flex-col bg-[#15151c] text-white">
      {/* song header */}
      <div className="relative overflow-hidden px-4 pb-3 pt-4" style={{ background: "linear-gradient(160deg,#2b2340,#15151c 70%)" }}>
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-white/10 text-3xl">🎚</div>
          <div className="min-w-0">
            <div className="truncate font-display text-2xl font-extrabold uppercase">{title}</div>
            {artist && <div className="truncate text-sm text-white/60">{artist}</div>}
            <div className="mt-1 text-xs text-white/50" data-bpm={beat?.bpm} data-first-beat={beat?.firstBeat} data-preroll={gen?.preroll}>
              {[songKey && `Key: ${songKey}`, (bpm || beat?.bpm) && `BPM: ${bpm || beat?.bpm}${!bpm && beat ? " (heard)" : ""}`, `Time sig: ${meter || "4/4"}`].filter(Boolean).join(", ")}
            </div>
          </div>
        </div>
      </div>

      {/* mixer */}
      <div className="flex items-center justify-center gap-2 bg-[#3a3a4a] py-2 text-xs font-bold tracking-wide">
        <span>▮▮▮ MIXER</span>
        <button onClick={() => setSplit(!split)} className={`ml-3 rounded px-2 py-0.5 ${split ? "bg-[#9b7bff] text-white" : "bg-white/10 text-white/70"}`} title="Split output: click + guide left (in-ears), band right (mains)">
          {split ? "SPLIT L/R ON" : "SPLIT L/R"}
        </button>
      </div>
      {!ready ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-white/70">
          {loading.total ? (loading.done < loading.total ? `Loading parts… ${loading.done} of ${loading.total}` : "Building click and guide…") : "No parts for this song yet."}
          {loading.error && <div className="mt-2 text-red-300">{loading.error}</div>}
        </div>
      ) : (
        <div className="flex flex-1 overflow-x-auto bg-[#6b6b74]">
          {stems.map((s, si) => {
            const c = mix[s.id] ?? { vol: 0.8, pan: 0, mute: false, solo: false };
            const panShown = split ? (isLeftPart(s.name) ? -1 : 1) : c.pan;
            return (
              <div key={s.id} className="flex w-[74px] shrink-0 flex-col items-center gap-2 border-r border-black/30 bg-[#7a7a84] px-1 py-2">
                <button onClick={() => setCh(s.id, { mute: !c.mute })} className={`h-7 w-11 rounded-md text-xs font-bold ${c.mute ? "bg-[#9b7bff] text-white" : "bg-[#8d8d97] text-white/80"}`}>M</button>
                <button onClick={() => setCh(s.id, { solo: !c.solo })} className={`h-7 w-11 rounded-md text-xs font-bold ${c.solo ? "bg-[#f2c94c] text-black" : "bg-[#8d8d97] text-white/80"}`}>S</button>
                {/* pan knob */}
                <label className="relative grid h-12 w-12 place-items-center" title={`Pan ${panShown < 0 ? "L" : panShown > 0 ? "R" : "C"}`}>
                  <div className="h-11 w-11 rounded-full bg-white shadow-inner" />
                  <div className="absolute left-1/2 top-[3px] h-4 w-[3px] -translate-x-1/2 origin-[50%_19px] rounded bg-[#9b7bff]" style={{ transform: `translateX(-50%) rotate(${panShown * 135}deg)` }} />
                  <input type="range" min={-1} max={1} step={0.05} value={c.pan} disabled={split} onChange={(e) => setCh(s.id, { pan: +e.target.value })} onDoubleClick={() => setCh(s.id, { pan: 0 })} className="absolute inset-0 cursor-ew-resize opacity-0" aria-label={`${s.name} pan`} />
                </label>
                {/* fader + meter */}
                <div className="relative flex h-44 w-full justify-center">
                  <div className="absolute bottom-0 right-2 top-0 w-[5px] overflow-hidden rounded bg-black/40">
                    <div ref={(el) => { if (el) meters.current.set(s.id, el); }} className="absolute bottom-0 w-full rounded bg-gradient-to-t from-[#8f7cff] to-[#c9bcff]" style={{ height: "0%" }} />
                  </div>
                  <div className="absolute bottom-0 top-0 w-[6px] rounded bg-black/60" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={c.vol}
                    onChange={(e) => setCh(s.id, { vol: +e.target.value })}
                    className="fw-fader absolute h-44 w-10 cursor-ns-resize"
                    style={{ writingMode: "vertical-lr", direction: "rtl" } as React.CSSProperties}
                    aria-label={`${s.name} volume`}
                  />
                </div>
                <div className="mt-auto w-full text-center text-[10px] font-bold leading-tight tracking-wide" title={s.name}>{names[si]}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* transport */}
      <div className="bg-[#15151c] px-4 pt-3">
        <div className="flex items-center gap-3 text-xs tabular-nums text-white/70">
          <span>{fmt(pos)}</span>
          <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(pos, duration || 1)} onChange={(e) => seek(+e.target.value)} className="flex-1 accent-[#9b7bff]" aria-label="Position" />
          <span>{fmt(duration)}</span>
        </div>
        {loop && (
          <div className="mt-1 text-center text-xs text-[#f2c94c]">
            Vamping {fmt(loop.start)}–{fmt(loop.end)} · <button className="underline" onClick={() => setLoop(null)}>release</button>
          </div>
        )}
      </div>
      <div className="flex items-stretch gap-2 bg-[#15151c] p-3">
        <button className="w-14 rounded-lg bg-white/10 text-2xl disabled:opacity-40" disabled={!ready} onClick={() => (playing ? pause() : startAt(pos))} aria-label={playing ? "Pause" : "Play"}>
          {playing ? (countingIn ? "•" : "❚❚") : "▶"}
        </button>
        <span className="flex items-center rounded-full bg-white/10 text-sm font-semibold">
          <button className="px-3 py-2" onClick={() => setPitch(Math.max(-6, pitch - 1))} aria-label="Key down">−</button>
          Key: {songKey ? transposeName(songKey, pitch) : pitch ? (pitch > 0 ? `+${pitch}` : pitch) : "—"}
          <button className="px-3 py-2" onClick={() => setPitch(Math.min(6, pitch + 1))} aria-label="Key up">+</button>
        </span>
        <button className="rounded-full bg-white/10 px-4 text-sm font-semibold" onClick={() => { setMix(defaults(stems)); setSplit(false); setPitch(0); }}>
          Defaults
        </button>
        {virtual.length > 0 && (
          <select
            value={countIn}
            onChange={(e) => setCountIn(Number(e.target.value) as 0 | 1 | 2)}
            className="rounded-full bg-white/10 px-3 text-sm font-semibold"
            aria-label="Count-in"
            title="Count-in before the song (when playing from the top)"
          >
            <option value={2} className="text-black">Count-in: 2 bars</option>
            <option value={1} className="text-black">Count-in: 1 bar</option>
            <option value={0} className="text-black">No count-in</option>
          </select>
        )}
        <button
          className={`rounded-full px-4 text-sm font-semibold ${loop ? "bg-[#f2c94c] text-black" : "bg-white/10"}`}
          disabled={!ready}
          onClick={() => {
            if (loop) return setLoop(null);
            const t = position();
            const b = bpm || beat?.bpm;
            const bar = b ? (60 / b) * (parseInt(meter ?? "", 10) || 4) : 4;
            const len = bar * 4; // vamp the next 4 bars from here
            setLoop({ start: t, end: Math.min(duration, t + len) });
          }}
          title="Loop 4 bars from here (vamp)"
        >
          🔁 Vamp
        </button>
      </div>
    </div>
  );
}

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function transposeName(k: string, semis: number) {
  const m = k.match(/^([A-G][#b]?)(m?)/);
  if (!m) return k;
  const i = Math.max(SHARP.indexOf(m[1]), FLAT.indexOf(m[1]));
  if (i < 0) return k;
  const j = (((i + semis) % 12) + 12) % 12;
  return (m[1].includes("b") || ["F"].includes(m[1]) ? FLAT : SHARP)[j] + m[2];
}
