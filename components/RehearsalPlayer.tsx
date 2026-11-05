"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sectionsOf, type SectionInfo } from "@/lib/chordpro";
import { isAudio } from "@/lib/media";

type Track = { id: string; name: string; url: string; markers: Record<string, number>; isStem: boolean };
type Channel = { vol: number; mute: boolean; solo: boolean };

const KIND_STYLE: Record<string, string> = {
  verse: "border-ink text-ink",
  chorus: "border-accent text-accent",
  prechorus: "border-amber-600 text-amber-700",
  bridge: "border-stone-500 text-stone-600",
  tag: "border-accent text-accent",
  inst: "border-stone-400 text-stone-500",
  other: "border-line text-muted",
};
const KIND_STYLE_DARK: Record<string, string> = {
  verse: "border-white/80 text-white",
  chorus: "border-orange-400 text-orange-300",
  prechorus: "border-amber-400 text-amber-300",
  bridge: "border-stone-300 text-stone-200",
  tag: "border-orange-400 text-orange-300",
  inst: "border-stone-500 text-stone-300",
  other: "border-stone-600 text-stone-400",
};

// Usual order of parts in a multitrack, so the mixer reads left to right like a desk.
const STEM_ORDER = ["click", "guide", "cue", "drum", "perc", "loop", "bass", "key", "piano", "organ", "synth", "pad", "acoustic", "ag", "electric", "eg", "gtr", "guitar", "string", "vocal", "vox", "bgv"];
function stemRank(name: string) {
  const n = name.toLowerCase();
  const i = STEM_ORDER.findIndex((k) => n.includes(k));
  return i < 0 ? 99 : i;
}

function fmt(t: number) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type AudioCtor = typeof AudioContext;
function newAudioContext() {
  const Ctx: AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
  return new Ctx();
}

/**
 * Section roadmap + bottom player bar for a song's uploaded audio.
 * - One track, or a set of stems played together through a mixer (mute / solo / volume).
 * - Leaders mark where each section starts; then tapping a section jumps there,
 *   and voice cues can announce each section just before it starts.
 */
export default function RehearsalPlayer({
  songId,
  chart,
  canEdit,
  dark = false,
  bottomOffset = 0,
  onPrevSong,
  onNextSong,
  autoPlay = false,
  bpm,
  title,
  hideRoadmap = false,
}: {
  songId: string;
  chart: string;
  canEdit: boolean;
  dark?: boolean;
  /** Space to leave below the player (e.g. for the stage view's Prev/Next bar), in px. */
  bottomOffset?: number;
  /** Set player: go to the previous / next song. `playing` says whether to start it automatically. */
  onPrevSong?: () => void;
  onNextSong?: (playing: boolean) => void;
  autoPlay?: boolean;
  /** Song tempo for the metronome and voice-cue timing. */
  bpm?: number | null;
  /** Shown in the player bar (set player). */
  title?: string;
  hideRoadmap?: boolean;
}) {
  const sections = useMemo(() => sectionsOf(chart), [chart]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [source, setSource] = useState<string>(""); // "mix" or a track id
  const [markersOk, setMarkersOk] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const stems = useMemo(() => tracks.filter((t) => t.isStem).sort((a, b) => stemRank(a.name) - stemRank(b.name)), [tracks]);
  const singles = useMemo(() => tracks.filter((t) => !t.isStem || stems.length < 2), [tracks, stems.length]);
  const useStems = source === "mix" && stems.length >= 2;
  const track = useStems ? stems[0] : tracks.find((t) => t.id === source) ?? singles[0];

  const audioRef = useRef<HTMLAudioElement>(null);
  const stemEls = useRef<Map<string, HTMLAudioElement>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState<"off" | "song" | "section">("off");
  const [rate, setRate] = useState(1);
  const [marking, setMarking] = useState(false);
  const [open, setOpen] = useState(true);
  const [showMixer, setShowMixer] = useState(false);
  const [cues, setCues] = useState(false);

  // ── Load audio files for this song ──
  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    (async () => {
      const { data } = await supabase.from("song_files").select("*").eq("song_id", songId).order("name");
      const rows = (data ?? []) as { id: string; name: string; path: string; markers?: Record<string, number>; is_stem?: boolean }[];
      if (rows.length && !("markers" in rows[0])) setMarkersOk(false);
      const out: Track[] = [];
      for (const f of rows.filter((r) => isAudio(r.path))) {
        const { data: s } = await supabase.storage.from("charts").createSignedUrl(f.path, 60 * 60 * 6);
        if (s) out.push({ id: f.id, name: f.name, url: s.signedUrl, markers: f.markers ?? {}, isStem: !!f.is_stem });
      }
      if (!alive) return;
      setTracks(out);
      setSource(out.filter((t) => t.isStem).length >= 2 ? "mix" : out[0]?.id ?? "");
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [songId]);

  // Markers live on the main track (the first stem in mixer mode).
  const setMarkers = useCallback(
    (id: string, markers: Record<string, number>) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, markers } : t))),
    []
  );

  // ── Waveform for the main track ──
  const trackUrl = track?.url;
  useEffect(() => {
    setPeaks(null);
    setTime(0);
    setPlaying(false);
    if (!trackUrl) return;
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(trackUrl)).arrayBuffer();
        const ctx = newAudioContext();
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const bins = 240;
        const step = Math.floor(data.length / bins) || 1;
        const p: number[] = [];
        for (let i = 0; i < bins; i++) {
          let max = 0;
          for (let j = i * step; j < Math.min((i + 1) * step, data.length); j += 32) max = Math.max(max, Math.abs(data[j]));
          p.push(max);
        }
        const top = Math.max(...p) || 1;
        if (alive) setPeaks(p.map((x) => x / top));
        ctx.close();
      } catch {
        if (alive) setPeaks([]); // waveform is optional; playback still works
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackUrl]);

  // ── Markers ──
  const marks = useMemo(
    () =>
      Object.entries(track?.markers ?? {})
        .map(([n, t]) => ({ n: Number(n), t }))
        .filter((m) => sections[m.n])
        .sort((a, b) => a.t - b.t),
    [track, sections]
  );
  const current = useMemo(() => {
    let c: number | null = null;
    for (const m of marks) if (m.t <= time + 0.05) c = m.n;
    return c;
  }, [marks, time]);

  const sectionRange = useCallback(
    (n: number) => {
      const i = marks.findIndex((m) => m.n === n);
      if (i < 0) return null;
      return { start: marks[i].t, end: marks[i + 1]?.t ?? duration };
    },
    [marks, duration]
  );

  // ── Draw waveform ──
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const p = peaks && peaks.length ? peaks : new Array(120).fill(0.15);
    const bw = w / p.length;
    const played = duration ? time / duration : 0;
    const rest = dark ? "rgba(255,255,255,0.28)" : "rgba(17,17,17,0.22)";
    p.forEach((v, i) => {
      const bh = Math.max(2, v * (h - 4));
      g.fillStyle = i / p.length < played ? "#df6437" : rest;
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 1), bh);
    });
    if (duration) {
      g.fillStyle = dark ? "#fff" : "#111";
      for (const m of marks) g.fillRect((m.t / duration) * w, 0, 1, h);
    }
  }, [peaks, time, duration, dark, marks, open]);

  // ── Mixer (stems) ──
  const mixKey = `fw.mix.${songId}`;
  const [mix, setMix] = useState<Record<string, Partial<Channel>>>({});
  useEffect(() => {
    try {
      setMix(JSON.parse(localStorage.getItem(mixKey) ?? "{}"));
    } catch {}
  }, [mixKey]);
  const updateMix = (id: string, patch: Partial<Channel>) =>
    setMix((m) => {
      const next = { ...m, [id]: { vol: 1, mute: false, solo: false, ...m[id], ...patch } };
      try {
        localStorage.setItem(mixKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  const resetMix = () => {
    setMix({});
    try {
      localStorage.removeItem(mixKey);
    } catch {}
  };

  // Web Audio graph so each stem has its own volume (phones ignore <audio>.volume).
  const graph = useRef<{ ctx: AudioContext; gains: Map<string, GainNode> } | null>(null);
  const [graphReady, setGraphReady] = useState(0);
  const ensureGraph = useCallback(() => {
    if (!useStems) return;
    if (!graph.current) {
      try {
        const ctx = newAudioContext();
        const gains = new Map<string, GainNode>();
        stemEls.current.forEach((el, id) => {
          const g = ctx.createGain();
          ctx.createMediaElementSource(el).connect(g).connect(ctx.destination);
          gains.set(id, g);
        });
        graph.current = { ctx, gains };
        setGraphReady((n) => n + 1);
      } catch {
        graph.current = null;
      }
    }
    graph.current?.ctx.resume().catch(() => {});
  }, [useStems]);

  // New set of stems (not just new markers): tear down the old graph.
  const stemKey = stems.map((s) => s.id + s.url).join();
  useEffect(() => {
    return () => {
      graph.current?.ctx.close().catch(() => {});
      graph.current = null;
    };
  }, [useStems, stemKey]);

  const anySolo = stems.some((s) => mix[s.id]?.solo);
  const level = useCallback(
    (id: string) => {
      const c = { vol: 1, mute: false, solo: false, ...mix[id] };
      return anySolo ? (c.solo ? c.vol : 0) : c.mute ? 0 : c.vol;
    },
    [mix, anySolo]
  );
  useEffect(() => {
    if (!useStems) return;
    stemEls.current.forEach((el, id) => {
      const g = graph.current?.gains.get(id);
      if (g) {
        g.gain.value = level(id);
        el.muted = false;
      } else el.muted = level(id) === 0; // before the graph exists (or if it couldn't be built)
    });
  }, [level, useStems, playing, graphReady]);

  const followers = () => [...stemEls.current.values()].filter((el) => el !== audioRef.current);
  const syncFollowers = (force = false) => {
    const m = audioRef.current;
    if (!m) return;
    for (const el of followers()) {
      if (force || Math.abs(el.currentTime - m.currentTime) > 0.08) el.currentTime = m.currentTime;
    }
  };

  // ── Section loop ──
  useEffect(() => {
    const a = audioRef.current;
    if (!a || loop !== "section" || current === null) return;
    const r = sectionRange(current);
    if (r && time >= r.end - 0.05) a.currentTime = r.start;
  }, [time, loop, current, sectionRange]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    stemEls.current.forEach((el) => (el.playbackRate = rate));
  }, [rate, track, useStems]);

  useEffect(() => {
    if (autoPlay && track) audioRef.current?.play().catch(() => {});
  }, [autoPlay, track]);

  // ── Voice cues: say the section name one bar before it starts ──
  const spoken = useRef<Set<number>>(new Set());
  const lastTime = useRef(0);
  useEffect(() => {
    if (time < lastTime.current - 0.5) {
      // jumped backwards: allow cues after this point to be spoken again
      for (const m of marks) if (m.t > time) spoken.current.delete(m.n);
    }
    lastTime.current = time;
    if (!cues || !playing || typeof speechSynthesis === "undefined") return;
    const lead = (bpm ? (4 * 60) / bpm : 2) / rate;
    for (const m of marks) {
      if (time >= m.t - lead && time < m.t - 0.15 && !spoken.current.has(m.n)) {
        spoken.current.add(m.n);
        const u = new SpeechSynthesisUtterance(sections[m.n]?.label ?? "");
        u.rate = 1.15;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    }
  }, [time, cues, playing, marks, bpm, rate, sections]);

  function toggleCues() {
    const on = !cues;
    setCues(on);
    if (on && typeof speechSynthesis !== "undefined") {
      // Phones only allow speech after a tap, so say something now.
      speechSynthesis.speak(new SpeechSynthesisUtterance("Cues on"));
    }
  }

  // ── Metronome: a short click on every beat at the song's tempo ──
  const [click, setClick] = useState(false);
  useEffect(() => {
    if (!click || !bpm) return;
    const ctx = newAudioContext();
    const spb = 60 / bpm;
    let next = ctx.currentTime + 0.1;
    let beat = 0;
    const tick = () => {
      while (next < ctx.currentTime + 0.2) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = beat % 4 === 0 ? 1500 : 1000;
        g.gain.setValueAtTime(0.4, next);
        g.gain.exponentialRampToValueAtTime(0.001, next + 0.05);
        o.connect(g).connect(ctx.destination);
        o.start(next);
        o.stop(next + 0.06);
        next += spb;
        beat++;
      }
    };
    const id = window.setInterval(tick, 50);
    tick();
    return () => {
      window.clearInterval(id);
      ctx.close();
    };
  }, [click, bpm]);

  // ── Transport ──
  function play() {
    ensureGraph();
    audioRef.current?.play().catch(() => {});
  }
  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) play();
    else a.pause();
  }
  function skip(sec: number) {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, Math.min((a.duration || 0) - 0.1, a.currentTime + sec));
  }

  function scrollTo(n: number) {
    document.getElementById(`sec-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function tapSection(s: SectionInfo) {
    const a = audioRef.current;
    if (marking && a && track) {
      const markers = { ...track.markers, [s.n]: Math.round(a.currentTime * 10) / 10 };
      setMarkers(track.id, markers);
      const { error } = await createClient().from("song_files").update({ markers }).eq("id", track.id);
      if (error) alert(error.message);
      return;
    }
    scrollTo(s.n);
    const r = sectionRange(s.n);
    if (a && r) {
      a.currentTime = r.start;
      if (a.paused) play();
    }
  }

  async function clearMarkers() {
    if (!track || !confirm("Clear all section markers for this track?")) return;
    setMarkers(track.id, {});
    await createClient().from("song_files").update({ markers: {} }).eq("id", track.id);
  }

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * duration;
  }

  // Follow along: when a new marked section starts playing, scroll the chart to it.
  const lastScrolled = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || marking || current === null || current === lastScrolled.current) return;
    lastScrolled.current = current;
    scrollTo(current);
  }, [current, playing, marking]);

  // Leave room at the bottom of the page so the player bar doesn't cover the end of the chart.
  const hasBar = !!(track || onNextSong || onPrevSong);
  useEffect(() => {
    if (!hasBar) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `${(open ? 230 : 130) + (showMixer && useStems ? 220 : 0) + bottomOffset}px`;
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, [hasBar, open, bottomOffset, showMixer, useStems]);

  const styles = dark ? KIND_STYLE_DARK : KIND_STYLE;
  const bar = dark ? "bg-stone-900 border-stone-700 text-white" : "bg-white border-line text-ink";
  const chip = (on: boolean) => `rounded-sm px-2 py-1 font-bold uppercase ${on ? "bg-accent text-white" : "opacity-70 hover:opacity-100"}`;

  // Master element events (in mixer mode the other stems follow it).
  const masterEvents = {
    onPlay: () => {
      setPlaying(true);
      if (useStems) {
        syncFollowers(true);
        followers().forEach((el) => el.play().catch(() => {}));
      }
    },
    onPause: () => {
      setPlaying(false);
      followers().forEach((el) => el.pause());
    },
    onSeeked: () => syncFollowers(true),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      setTime(e.currentTarget.currentTime);
      if (useStems && !e.currentTarget.paused) syncFollowers();
    },
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLAudioElement>) => setDuration(e.currentTarget.duration),
    onEnded: () => {
      setPlaying(false);
      followers().forEach((el) => el.pause());
      if (loop === "off") onNextSong?.(true);
    },
  };

  return (
    <>
      {loaded && !tracks.length && !onNextSong && (
        <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-sm px-3 py-2 text-sm print:hidden ${dark ? "bg-white/10" : "bg-accent-soft"}`}>
          <span className="flex-1">🎵 No audio for this song yet.{canEdit && " Upload an MP3 (or stems) to play it here."}</span>
          {canEdit && (
            <button className="btn" onClick={() => document.getElementById("song-files")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              Upload audio
            </button>
          )}
        </div>
      )}
      {sections.length > 0 && !hideRoadmap && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 print:hidden">
          {sections.map((s) => {
            const marked = track?.markers?.[s.n] !== undefined;
            const isCur = current === s.n;
            return (
              <button
                key={s.n}
                onClick={() => tapSection(s)}
                title={s.label}
                className={`grid h-11 min-w-[2.75rem] shrink-0 place-items-center rounded-full border-2 px-2 font-display text-sm font-bold ${styles[s.kind]} ${
                  isCur ? (dark ? "bg-white/15" : "bg-accent-soft") : ""
                } ${marking ? (marked ? "ring-2 ring-ok" : "border-dashed") : ""}`}
              >
                {s.abbr}
              </button>
            );
          })}
        </div>
      )}

      {hasBar && (
        <div style={{ bottom: bottomOffset }} className={`fixed inset-x-0 z-30 border-t shadow-[0_-4px_16px_rgba(0,0,0,0.08)] print:hidden ${bar}`}>
          <button className="mx-auto block w-16 py-1.5" onClick={() => setOpen(!open)} aria-label={open ? "Collapse player" : "Expand player"}>
            <span className="block h-1 rounded-full bg-current opacity-30" />
          </button>
          <div className="mx-auto max-w-3xl px-4 pb-4">
            {title && <div className="mb-1 truncate font-display text-sm font-bold">{title}</div>}
            {!track && <p className="mb-2 text-xs opacity-70">No audio uploaded for this song.</p>}

            {/* Mixer */}
            {useStems && showMixer && (
              <div className="mb-3 flex gap-1 overflow-x-auto rounded-md bg-black/5 p-2 dark:bg-white/5">
                {stems.map((s) => {
                  const c = { vol: 1, mute: false, solo: false, ...mix[s.id] };
                  const audible = level(s.id) > 0;
                  return (
                    <div key={s.id} className={`flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-sm py-1 ${audible ? "" : "opacity-50"}`}>
                      <button onClick={() => updateMix(s.id, { mute: !c.mute })} className={`w-12 rounded-sm py-0.5 text-xs font-bold ${c.mute ? "bg-bad text-white" : "border border-current/20"}`}>M</button>
                      <button onClick={() => updateMix(s.id, { solo: !c.solo })} className={`w-12 rounded-sm py-0.5 text-xs font-bold ${c.solo ? "bg-amber-500 text-white" : "border border-current/20"}`}>S</button>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={c.vol}
                        onChange={(e) => updateMix(s.id, { vol: Number(e.target.value) })}
                        aria-label={`${s.name} volume`}
                        style={{ writingMode: "vertical-lr", direction: "rtl" }}
                        className="h-24 w-6 accent-[#df6437]"
                      />
                      <span className="w-full truncate text-center text-[10px] font-bold uppercase tracking-wide" title={s.name}>{s.name}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {open && track && <canvas ref={canvasRef} onClick={seek} className="mb-2 h-14 w-full cursor-pointer" aria-label="Waveform: tap to seek" />}

            {/* Audio elements */}
            {track && !useStems && (
              <audio ref={audioRef} src={track.url} preload="metadata" loop={loop === "song"} {...masterEvents} />
            )}
            {useStems && (
              <div key={stemKey}>
                {stems.map((s, i) => (
                  <audio
                    key={s.id}
                    ref={(el) => {
                      if (el) stemEls.current.set(s.id, el);
                      else stemEls.current.delete(s.id);
                      if (i === 0) (audioRef as React.MutableRefObject<HTMLAudioElement | null>).current = el;
                    }}
                    src={s.url}
                    crossOrigin="anonymous"
                    preload="auto"
                    loop={loop === "song"}
                    {...(i === 0 ? masterEvents : {})}
                  />
                ))}
              </div>
            )}

            <div className="mb-1 flex justify-between font-mono text-[11px] tabular-nums opacity-60">
              <span>{fmt(time)}</span>
              <span>{fmt(duration)}</span>
            </div>
            <div className="flex items-center justify-center gap-5">
              {onPrevSong ? (
                <button className="text-2xl opacity-80 hover:opacity-100" aria-label="Previous song" onClick={onPrevSong}>⏮</button>
              ) : (
                <button className="text-2xl opacity-80 hover:opacity-100" aria-label="Back to start" onClick={() => audioRef.current && (audioRef.current.currentTime = 0)}>⏮</button>
              )}
              <button className="text-sm font-bold opacity-80 hover:opacity-100 disabled:opacity-30" aria-label="Back 15 seconds" disabled={!track} onClick={() => skip(-15)}>↺15</button>
              <button
                disabled={!track}
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-2xl text-white disabled:opacity-40"
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button className="text-sm font-bold opacity-80 hover:opacity-100 disabled:opacity-30" aria-label="Forward 15 seconds" disabled={!track} onClick={() => skip(15)}>15↻</button>
              {onNextSong ? (
                <button className="text-2xl opacity-80 hover:opacity-100" aria-label="Next song" onClick={() => onNextSong(playing)}>⏭</button>
              ) : (
                <span className="w-6" />
              )}
            </div>

            {open && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {useStems && (
                  <button onClick={() => setShowMixer(!showMixer)} className={chip(showMixer)}>
                    🎚 Mixer
                  </button>
                )}
                <button
                  onClick={() => setLoop(loop === "off" ? "song" : loop === "song" && marks.length ? "section" : "off")}
                  className={chip(loop !== "off")}
                  title="Loop off / whole song / current section"
                >
                  {loop === "off" ? "Loop" : loop === "song" ? "Loop song" : "Loop section"}
                </button>
                <select aria-label="Speed" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded-sm border border-current/20 bg-transparent px-1 py-0.5">
                  {[0.5, 0.75, 0.9, 1].map((r) => <option key={r} value={r} className="text-ink">{r === 1 ? "1× speed" : `${r}×`}</option>)}
                </select>
                {bpm ? (
                  <button onClick={() => setClick(!click)} className={chip(click)} title="Metronome">
                    ♩ {bpm}
                  </button>
                ) : null}
                {marks.length > 0 && (
                  <button onClick={toggleCues} className={chip(cues)} title="Say each section's name just before it starts">
                    🗣 Cues
                  </button>
                )}
                {tracks.length > 1 && (
                  <select
                    aria-label="Track"
                    value={useStems ? "mix" : track?.id}
                    onChange={(e) => setSource(e.target.value)}
                    className="max-w-[10rem] rounded-sm border border-current/20 bg-transparent px-1 py-0.5"
                  >
                    {stems.length >= 2 && <option value="mix" className="text-ink">All stems ({stems.length})</option>}
                    {singles.map((t) => <option key={t.id} value={t.id} className="text-ink">{t.name}</option>)}
                  </select>
                )}
                {tracks.length === 1 && track && <span className="max-w-[8rem] truncate opacity-60">{track.name}</span>}
                {canEdit && markersOk && track && sections.length > 0 && (
                  <>
                    <button onClick={() => setMarking(!marking)} className={`ml-auto rounded-sm px-2 py-1 font-bold uppercase ${marking ? "bg-ok text-white" : "opacity-70 hover:opacity-100"}`}>
                      {marking ? "Done marking" : "Mark sections"}
                    </button>
                    {marks.length > 0 && !marking && <button className="opacity-60 hover:opacity-100" onClick={clearMarkers}>Clear marks</button>}
                  </>
                )}
                {useStems && showMixer && (
                  <button className="opacity-60 hover:opacity-100" onClick={resetMix}>Reset mix</button>
                )}
              </div>
            )}
            {marking && (
              <p className="mt-2 text-xs opacity-80">
                Play the track and tap each section above the moment it starts. Tap again to re-mark. Marked sections get a green ring.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
