"use client";
import { alignSections, chartFromTranscript } from "@/lib/autosync";
import { detectTempo, snapToBeat, type Tempo } from "@/lib/tempo";
import { detectChords, progression, type ChordResult } from "@/lib/chords";
import { transposeChord, withSectionChords } from "@/lib/chordpro";
import { createPitchShifter } from "@/lib/pitchShift";
import { CUE_VOICES, type CueVoiceId, teamVoiceUrls, cueClick, cueClock, cueLength, decodeAudio, sharedAudio, playThroughSilentSwitch, preloadCues, sayCue, unlockCues } from "@/lib/cueVoice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseChordPro, sectionsOf, type SectionInfo } from "@/lib/chordpro";
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
  meter,
  title,
  hideRoadmap = false,
  onPosition,
  onPitch,
  onChartCreated,
  onChords,
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
  /** Time signature like "4/4", "3/4", "6/8" (beats counted per bar). */
  meter?: string | null;
  /** Shown in the player bar (set player). */
  title?: string;
  hideRoadmap?: boolean;
  /** Reports where playback is: the section number (null before the first) and how far through it (0–1). */
  onPosition?: (pos: { n: number | null; progress: number; playing: boolean }) => void;
  /** The audio's key change in semitones, so the chart can transpose along. */
  onPitch?: (semitones: number) => void;
  /** The AI wrote this song's lyrics/sections (Auto-sync on a song with none). */
  onChartCreated?: (chart: string) => void;
  /** Chords heard in each section (section number → progression), already in the played key. */
  onChords?: (bySection: Record<number, string[]> | null) => void;
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
  // Tempo and beat grid heard in the recording (used when the song has no BPM entered).
  const [tempo, setTempo] = useState<Tempo | null>(null);
  // Chords heard in the recording (best guess, like Moises / Chordify).
  const [heardChords, setHeardChords] = useState<ChordResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState<"off" | "song" | "section">("off");
  const [rate, setRate] = useState(1);
  const [marking, setMarking] = useState(false);
  const [open, setOpen] = useState(true);
  const [showMixer, setShowMixer] = useState(false);
  const [showTimes, setShowTimes] = useState(false);
  // Guide cues on by default (remembered per device).
  const [cues, setCuesState] = useState(true);
  const setCues = (on: boolean) => {
    setCuesState(on);
    try {
      localStorage.setItem("fw.cues", on ? "1" : "0");
    } catch {}
  };
  useEffect(() => {
    try {
      if (localStorage.getItem("fw.cues") === "0") setCuesState(false);
    } catch {}
  }, []);
  // Optional count BEFORE pressing play starts the music (off by default: the guide counts in on the music itself).
  const [countIn, setCountIn] = useState<"2bar" | "1bar" | "off">("2bar");
  const [counting, setCounting] = useState<string | null>(null);
  const countAbort = useRef<(() => void) | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem("fw.countin3");
      if (v === "2bar" || v === "1bar" || v === "off") setCountIn(v);
    } catch {}
  }, []);
  // Guide voice for cues and the count-in. Remembered on this device.
  const [voice, setVoice] = useState<CueVoiceId>("male");
  useEffect(() => {
    try {
      const v = localStorage.getItem("fw.voice");
      if (v === "team" || v === "male" || v === "female" || v === "device") setVoice(v);
      // No choice made yet: use the team's own recorded voice if they've recorded one.
      else teamVoiceUrls().then((m) => m.size > 0 && setVoice("team"));
    } catch {}
  }, []);
  const chooseVoice = (v: CueVoiceId) => {
    setVoice(v);
    try {
      localStorage.setItem("fw.voice", v);
    } catch {}
    unlockCues();
    sayCue(v, "Verse 1");
  };
  useEffect(() => playThroughSilentSwitch(), []);
  useEffect(() => {
    preloadCues(voice, [...sections.map((x) => x.label), "1", "2", "3", "4", "Cues on"]);
  }, [voice, sections]);
  const chooseCountIn = (v: "2bar" | "1bar" | "off") => {
    setCountIn(v);
    try {
      localStorage.setItem("fw.countin3", v);
    } catch {}
  };

  const [filesReload, setFilesReload] = useState(0);
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
  }, [songId, filesReload]);

  // Markers live on the main track (the first stem in mixer mode).
  const setMarkers = useCallback(
    (id: string, markers: Record<string, number>) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, markers } : t))),
    []
  );

  // ── Waveform for the main track ──
  const trackUrl = track?.url;
  useEffect(() => {
    setPeaks(null);
    setTempo(null);
    setHeardChords(null);
    setTime(0);
    setPlaying(false);
    if (!trackUrl) return;
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(trackUrl)).arrayBuffer();
        const audio = await decodeAudio(buf);
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
        // Find the tempo and beat grid when the phone is idle.
        const run = () => {
          if (!alive) return;
          try {
            const t = detectTempo(data, audio.sampleRate);
            if (alive && t) setTempo(t);
            // Then the chords, beat by beat.
            setTimeout(() => {
              if (!alive) return;
              try {
                const c = detectChords(data, audio.sampleRate, t);
                if (alive && c) setHeardChords(c);
              } catch {}
            }, 30);
          } catch {}
        };
        const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
        if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
        else setTimeout(run, 1500);
      } catch {
        if (alive) setPeaks([]); // waveform is optional; playback still works
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackUrl]);

  // ── Markers ──
  // Rough section start times spread by lyric lines; used until real times are saved.
  const guess = useMemo(() => {
    const markers: Record<string, number> = {};
    if (!duration || !sections.length) return markers;
    const lines: number[] = [];
    let cur = -1;
    for (const l of parseChordPro(chart)) {
      if (l.type === "section") lines[++cur] = 0;
      else if (l.type === "lyrics" && cur >= 0) lines[cur]++;
    }
    const firstLen = new Map<string, number>();
    const w = sections.map((sec, i) => {
      const key = sec.label.toLowerCase();
      if (lines[i] > 0 && !firstLen.has(key)) firstLen.set(key, lines[i]);
      return Math.max(1, lines[i] || firstLen.get(key) || 2);
    });
    const total = w.reduce((a, b) => a + b, 0);
    let t = 0;
    sections.forEach((sec, i) => {
      markers[sec.n] = Math.round(t * 10) / 10;
      t += (w[i] / total) * duration;
    });
    return markers;
  }, [chart, sections, duration]);
  const saved = Object.keys(track?.markers ?? {}).length > 0;
  const estimated = !saved && Object.keys(guess).length > 0;
  const marks = useMemo(
    () =>
      Object.entries(saved ? track?.markers ?? {} : guess)
        .map(([n, t]) => ({ n: Number(n), t }))
        .filter((m) => sections[m.n])
        .sort((a, b) => a.t - b.t),
    [track, sections, saved, guess]
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
  // Everything goes into `master`, then (when the key is changed) through the pitch shifter.
  const graph = useRef<{ ctx: AudioContext; gains: Map<string, GainNode>; master: GainNode; shifter: AudioWorkletNode | null; sources: AudioNode[] } | null>(null);
  const [graphReady, setGraphReady] = useState(0);
  // Key change in semitones (−6…+6), like Moises. Only the audio; the chart follows via onPitch.
  const [pitch, setPitch] = useState(0);
  const ensureGraph = useCallback(
    () => {
      if (!graph.current) {
        try {
          const ctx = sharedAudio();
          if (!ctx) return;
          const master = ctx.createGain();
          master.connect(ctx.destination);
          const gains = new Map<string, GainNode>();
          const sources: AudioNode[] = [];
          const els: [string, HTMLAudioElement][] = useStems ? [...stemEls.current.entries()] : audioRef.current ? [["main", audioRef.current]] : [];
          els.forEach(([id, el]) => {
            const g = ctx.createGain();
            const src = ctx.createMediaElementSource(el);
            src.connect(g).connect(master);
            sources.push(src, g);
            gains.set(id, g);
          });
          graph.current = { ctx, gains, master, shifter: null, sources };
          setGraphReady((n) => n + 1);
        } catch {
          graph.current = null;
        }
      }
      graph.current?.ctx.resume().catch(() => {});
    },
    [useStems]
  );
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    let cancelled = false;
    (async () => {
      if (pitch && !g.shifter) {
        g.shifter = await createPitchShifter(g.ctx);
        if (!g.shifter && !cancelled) {
          alert("This browser can't change the key. Try the latest Safari or Chrome.");
          setPitch(0);
          return;
        }
      }
      if (cancelled || graph.current !== g) return;
      g.master.disconnect();
      if (pitch && g.shifter) {
        g.shifter.parameters.get("semitones")?.setValueAtTime(pitch, g.ctx.currentTime);
        g.master.connect(g.shifter);
        g.shifter.disconnect();
        g.shifter.connect(g.ctx.destination);
      } else g.master.connect(g.ctx.destination);
    })();
    return () => {
      cancelled = true;
    };
  }, [pitch, graphReady]);
  const pitchCb = useRef(onPitch);
  pitchCb.current = onPitch;
  useEffect(() => pitchCb.current?.(pitch), [pitch]);
  // ── Split into stems (Replicate), right from the player ──
  const [splitting, setSplitting] = useState<string | null>(null);
  async function splitHere() {
    const src = tracks.find((t) => !t.isStem) ?? track;
    if (!src || splitting) return;
    if (!confirm(`Split "${src.name}" into Vocals, Drums, Bass, Guitar, Keys and Other?\n\nUses the AI splitting service (a few cents) and takes about 1–3 minutes. The original stays.`)) return;
    setSplitting("Starting…");
    try {
      const start = await fetch("/api/stems", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: src.id }) }).then((r) => r.json());
      if (!start.jobId) throw new Error(start.error ?? "Couldn't start");
      const began = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await fetch(`/api/stems?job=${start.jobId}`).then((r) => r.json());
        const secs = Math.round((Date.now() - began) / 1000);
        if (st.status === "done") break;
        if (st.status === "failed" || st.error) throw new Error(st.error ?? "failed");
        setSplitting(`${st.status === "importing" ? "Saving the parts" : "Splitting"}… ${secs}s (1–3 min)`);
        if (Date.now() - began > 15 * 60 * 1000) throw new Error("Took too long; check back in a few minutes.");
      }
      setFilesReload((n) => n + 1);
      setShowMixer(true);
      alert("✂ Done! The song is split into stems. Open the Mixer to mute, solo or turn parts up and down.");
    } catch (e) {
      alert("Split: " + (e as Error).message);
    } finally {
      setSplitting(null);
    }
  }

  // ── Heard chords: now / next while playing, and each section's progression ──
  const flatKey = /b|F$|Dm|Gm|Cm|Fm/.test(heardChords?.key ?? "");
  const shownChord = useCallback((name: string) => (pitch ? transposeChord(name, pitch, flatKey) : name), [pitch, flatKey]);
  const chordNow = useMemo(() => {
    if (!heardChords) return null;
    const list = heardChords.chords;
    const i = list.findIndex((c) => c.t <= time + 0.05 && c.end > time + 0.05);
    const cur = i >= 0 ? list[i] : null;
    const next = list.slice(i >= 0 ? i + 1 : 0).find((c) => c.t > time && c.name !== cur?.name);
    return { cur: cur ? shownChord(cur.name) : "", next: next ? shownChord(next.name) : "" };
  }, [heardChords, time, shownChord]);
  const bySection = useMemo(() => {
    if (!heardChords || !marks.length) return null;
    const out: Record<number, string[]> = {};
    marks.forEach((m, i) => {
      const end = marks[i + 1]?.t ?? duration;
      out[m.n] = progression(heardChords.chords, m.t, end).slice(0, 10).map(shownChord);
    });
    return out;
  }, [heardChords, marks, duration, shownChord]);
  const chordsCb = useRef(onChords);
  chordsCb.current = onChords;
  useEffect(() => chordsCb.current?.(bySection), [bySection]);
  async function saveChordsToChart() {
    if (!bySection || !canEdit) return;
    if (!confirm("Add the chords the app heard under each section of this song's chart? (e.g. \"Chords: G D Em C\")\n\nThey're a best guess: check them with the band.")) return;
    const next = withSectionChords(chart, bySection);
    const { error } = await createClient().from("songs").update({ chordpro: next }).eq("id", songId);
    if (error) return alert(error.message);
    if (onChartCreated) onChartCreated(next);
    else window.location.reload();
  }

  function changePitch(d: number) {
    const next = Math.max(-6, Math.min(6, pitch + d));
    if (next === pitch) return;
    unlockCues();
    if (!graph.current) ensureGraph(); // built inside the tap so phones allow it
    setPitch(next);
  }

  // New set of stems (not just new markers): tear down the old graph.
  const stemKey = stems.map((s) => s.id + s.url).join();
  useEffect(() => {
    return () => {
      // Unplug this song's nodes; the shared engine keeps running for the next song.
      const g = graph.current;
      if (g) {
        [...g.sources, g.master].forEach((n) => {
          try {
            n.disconnect();
          } catch {}
        });
        try {
          g.shifter?.disconnect();
        } catch {}
      }
      graph.current = null;
    };
  }, [useStems, stemKey, track?.id]);

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

  const posCb = useRef(onPosition);
  posCb.current = onPosition;
  useEffect(() => {
    if (!posCb.current) return;
    const r = current === null ? null : sectionRange(current);
    const progress = r && r.end > r.start ? Math.min(0.999, Math.max(0, (time - r.start) / (r.end - r.start))) : 0;
    posCb.current({ n: current, progress, playing });
  }, [time, current, playing, sectionRange]);

  useEffect(() => {
    // Slower/faster without changing pitch (the key control does that separately).
    const set = (el: HTMLAudioElement) => {
      (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      el.preservesPitch = true;
      el.playbackRate = rate;
    };
    if (audioRef.current) set(audioRef.current);
    stemEls.current.forEach(set);
  }, [rate, track, useStems]);

  useEffect(() => {
    if (autoPlay && track) play();
  }, [autoPlay, track]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Click, guide and count-in, the way a MultiTracks guide track sounds:
  //    count-in "One … Two … | One, Two, Three, Four" on tempo, the song lands on the downbeat,
  //    a woodblock click on every beat, and the section name called one bar before each section. ──
  const beatsPerBar = Math.max(2, Math.min(12, parseInt(meter ?? "", 10) || 4));
  // Tempo: the song's BPM, or the one heard in the recording. Use the heard beat grid only when it
  // agrees with the entered BPM (or there is none); half/double time counts too.
  const heard = tempo?.bpm ?? 0;
  const agrees = !!bpm && !!heard && [0.5, 1, 2].some((k) => Math.abs(heard * k - bpm) <= 2);
  const countBpm = bpm || heard || 0;
  const grid = tempo && (!bpm || agrees) ? { bpm: bpm || heard, offset: tempo.offset } : null;
  useEffect(() => {
    if (canEdit && !bpm && heard) createClient().from("songs").update({ bpm: heard }).eq("id", songId).is("bpm", null).then(() => {});
  }, [canEdit, bpm, heard, songId]);
  // A MultiTracks-style song with its own Click / Guide stems doesn't need ours.
  const songHasGuide = stems.some((x) => /guide|cue/i.test(x.name));
  const songHasClick = stems.some((x) => /click/i.test(x.name));

  // Click on/off and the Click / Guide volumes, remembered on this device.
  const [click, setClickState] = useState(true);
  const [clickVol, setClickVolState] = useState(0.6);
  const [guideVol, setGuideVolState] = useState(1);
  useEffect(() => {
    try {
      if (localStorage.getItem("fw.click") === "0") setClickState(false);
      const cv = parseFloat(localStorage.getItem("fw.clickVol") ?? "");
      if (cv >= 0 && cv <= 1) setClickVolState(cv);
      const gv = parseFloat(localStorage.getItem("fw.guideVol") ?? "");
      if (gv >= 0 && gv <= 1) setGuideVolState(gv);
    } catch {}
  }, []);
  const remember = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };
  const setClick = (on: boolean) => {
    setClickState(on);
    remember("fw.click", on ? "1" : "0");
    if (on) unlockCues();
  };
  const setClickVol = (v: number) => {
    setClickVolState(v);
    remember("fw.clickVol", String(v));
  };
  const setGuideVol = (v: number) => {
    setGuideVolState(v);
    remember("fw.guideVol", String(v));
  };

  const scheduled = useRef<{ stop: () => void }[]>([]);
  const cancelScheduled = () => {
    scheduled.current.forEach((x) => x.stop());
    scheduled.current = [];
  };
  const spb = countBpm ? 60 / countBpm : 0;
  // Where the song's beats fall, and which beat starts a bar (sections start on bar lines).
  const beatOffset = grid ? grid.offset : 0;
  const snap = (t: number) => (grid ? snapToBeat(t, grid, grid.bpm) : t);
  const barAnchor = marks.find((m) => m.t > 0.3)?.t;
  const isDownbeat = (k: number) => {
    if (barAnchor === undefined || !spb) return k % beatsPerBar === 0;
    const a = Math.round((snap(barAnchor) - beatOffset) / spb);
    return (((k - a) % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
  };
  // First beat with sound in the recording (for landing the song right after the count-in).
  const firstBeat = useMemo(() => {
    if (!spb) return 0;
    let tSound = 0;
    if (peaks?.length && duration) {
      const i = peaks.findIndex((p) => p > 0.12);
      tSound = i > 0 ? (i / peaks.length) * duration : 0;
    }
    const k = Math.max(0, Math.ceil((tSound - 0.08 - beatOffset) / spb));
    return beatOffset + k * spb;
  }, [spb, peaks, duration, beatOffset]);

  // Song clock ↔ audio-engine clock, so clicks and calls are scheduled exactly on the beat.
  const anchor = useRef<{ ctx: number; song: number; rate: number } | null>(null);
  const nextBeat = useRef(-1);
  const called = useRef<Set<number>>(new Set());
  useEffect(() => {
    const c = sharedAudio();
    if (!playing || !c) {
      cancelScheduled();
      anchor.current = null;
      return;
    }
    const restart = () => {
      const a = audioRef.current;
      if (!a) return;
      cancelScheduled();
      anchor.current = { ctx: c.currentTime, song: a.currentTime, rate };
      nextBeat.current = -1;
      for (const m of marks) if (snap(m.t) - (spb ? spb * beatsPerBar : 1.6) > a.currentTime) called.current.delete(m.n);
    };
    restart();
    const toCtx = (t: number) => anchor.current!.ctx + (t - anchor.current!.song) / anchor.current!.rate;
    const id = window.setInterval(() => {
      const a = audioRef.current;
      if (!a || a.paused || !anchor.current) return;
      const songNow = anchor.current.song + (c.currentTime - anchor.current.ctx) * anchor.current.rate;
      if (Math.abs(songNow - a.currentTime) > 0.06 || anchor.current.rate !== rate) return restart(); // seek, stall or speed change
      const ahead = 0.3 * rate;
      // Click on every beat.
      if (click && !songHasClick && spb) {
        let k = Math.max(nextBeat.current, Math.ceil((songNow - beatOffset) / spb - 1e-6));
        for (; beatOffset + k * spb < songNow + ahead; k++) {
          const t = beatOffset + k * spb;
          if (t >= songNow - 0.01 && t >= 0) scheduled.current.push(cueClick(toCtx(t), isDownbeat(k), clickVol));
        }
        nextBeat.current = k;
      }
      // Guide: the section's name, called on the downbeat of the bar before it.
      if (cues && !songHasGuide) {
        const bar = spb ? spb * beatsPerBar : 1.6;
        for (const m of marks) {
          if (called.current.has(m.n) || m.t < 0.3) continue;
          const at = snap(m.t) - bar;
          if (at < songNow - 0.08 || at > songNow + ahead + 0.3) continue;
          called.current.add(m.n);
          sayCue(voice, sections[m.n]?.label ?? "", { when: toCtx(Math.max(at, songNow)), volume: guideVol }).then((x) => scheduled.current.push(x));
        }
      }
      if (scheduled.current.length > 64) scheduled.current = scheduled.current.slice(-32);
    }, 40);
    return () => {
      window.clearInterval(id);
    };
  }, [playing, click, cues, rate, spb, beatOffset, clickVol, guideVol, voice, marks, sections, songHasClick, songHasGuide, beatsPerBar, barAnchor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) called.current.clear();
  }, [songId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCues() {
    if (!cues && !marks.length) {
      return alert(
        !sections.length
          ? "This song's chart has no sections yet (Verse 1, Chorus…). Add the lyrics with section names first, or tap 🤖 to have the AI write them."
          : "Section times are needed first: tap 🤖 Auto-sync or ⏱ Section times."
      );
    }
    const on = !cues;
    setCues(on);
    if (on) {
      unlockCues();
      sayCue(voice, "Cues on", { volume: guideVol });
    }
  }

  // ── Count-in: "One … Two … | One, Two, Three, Four" with the click, then the song lands on the downbeat ──
  function runCountIn(a: HTMLAudioElement): Promise<boolean> {
    const c = sharedAudio();
    const beats = beatsPerBar;
    const step = (spb || 0.6) / rate; // engine seconds per beat
    const bars = countIn === "1bar" ? 1 : 2;
    const words: string[] = [];
    for (let b = 0; b < bars; b++)
      for (let i = 0; i < beats; i++) {
        if (bars === 2 && b === 0) words.push(i === 0 ? "1" : beats % 2 === 0 && i === beats / 2 ? "2" : "");
        else words.push(String(i + 1));
      }
    if (!c) return Promise.resolve(true);
    const t0 = c.currentTime + 0.12;
    const tEnd = t0 + words.length * step; // the song's first beat lands here
    const startAt = tEnd - firstBeat / rate; // when the audio must begin (its first beat is firstBeat seconds in)
    const LATENCY = 0.02; // time for <audio> to actually start sounding
    const sounds: { stop: () => void }[] = [];
    const timers: number[] = [];
    words.forEach((w, i) => {
      const at = t0 + i * step;
      sounds.push(cueClick(at, i % beats === 0, Math.max(clickVol, 0.35)));
      if (w) sayCue(voice, w, { when: at, volume: guideVol }).then((x) => sounds.push(x));
      timers.push(window.setTimeout(() => setCounting(w || "•"), Math.max(0, (at - c.currentTime) * 1000)));
    });
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        timers.forEach(clearTimeout);
        setCounting(null);
        countAbort.current = null;
        resolve(ok);
      };
      countAbort.current = () => {
        sounds.forEach((x) => x.stop());
        finish(false);
      };
      timers.push(
        window.setTimeout(() => {
          a.currentTime = 0;
          a.play().catch(() => {});
          // keep the count's numbers on screen until the downbeat
          window.setTimeout(() => finish(true), Math.max(0, (tEnd - c.currentTime) * 1000));
        }, Math.max(0, (startAt - LATENCY - c.currentTime) * 1000))
      );
    });
  }

  // ── Transport ──
  async function play() {
    ensureGraph();
    unlockCues();
    const a = audioRef.current;
    if (!a) return;
    // Count in when starting the song from the top.
    if (countIn !== "off" && a.currentTime < 0.5 && countBpm) {
      // iPhones only let audio start straight from a tap. Start it silently now so it's allowed to play after the count.
      for (const el of new Set([a, ...followers()])) {
        el.muted = true;
        el.play()
          .then(() => {
            if (countAbort.current) {
              el.pause();
              el.currentTime = 0;
            }
          })
          .catch(() => {})
          .finally(() => (el.muted = false));
      }
      await runCountIn(a);
      return;
    }
    a.play().catch(() => {});
  }
  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (countAbort.current) return countAbort.current(); // tap again to cancel the count-in
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

  // ── Section times without tapping along: estimate, type, or set to "now" ──
  async function saveMarkers(markers: Record<string, number>) {
    if (!track) return;
    setMarkers(track.id, markers);
    const { error } = await createClient().from("song_files").update({ markers }).eq("id", track.id);
    if (error) alert(/markers/.test(error.message) ? "Section times need the database update (run ALL_UPDATES.sql in Supabase). " + error.message : error.message);
  }

  // ── Auto-sync (AI): listen to the song, match the words to the chart, save the section times ──
  const [syncing, setSyncing] = useState<string | null>(null);
  async function autoSync() {
    if (!track || syncing) return;
    // No lyrics (or no section names) yet: the AI writes them from the recording.
    const create = !sections.length;
    if (create && !canEdit) return alert("This song has no lyrics yet. A leader can tap 🤖 Auto-sync to have the AI write them.");
    if (
      create &&
      !confirm(
        (chart.trim() ? "This song's lyrics have no section names, so they'll be replaced.\n\n" : "") +
          "The AI will listen to the song, write the lyrics, and work out the Verse / Pre-Chorus / Chorus / Bridge and where each starts.\n\nTakes about 1–2 minutes. Continue?"
      )
    )
      return;
    // The vocals stem is clearest; otherwise the full mix.
    const src = tracks.find((t) => t.isStem && /vocal|vox|lead/i.test(t.name)) ?? tracks.find((t) => !t.isStem) ?? track;
    setSyncing("Sending the song…");
    try {
      const start = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: src.id }) }).then((r) => r.json());
      if (!start.id) throw new Error(start.error ?? "Couldn't start");
      const began = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const secs = Math.round((Date.now() - began) / 1000);
        setSyncing(`Listening to the song… ${secs}s (about 1–2 min)`);
        const st = await fetch(`/api/sync?id=${start.id}`).then((r) => r.json());
        if (st.status === "succeeded" && create) {
          const made = chartFromTranscript(st.segments ?? [], duration || audioRef.current?.duration || 0);
          if (!made) throw new Error("The AI didn't hear any words in this recording. If it's an instrumental track, try the full mix or the vocals stem.");
          const { error } = await createClient().from("songs").update({ chordpro: made.chart }).eq("id", songId);
          if (error) throw new Error(error.message);
          await saveMarkers(made.markers);
          alert(
            `🤖 Done! The AI wrote the lyrics and found ${made.sections} sections:\n\n${sectionsOf(made.chart).map((x) => x.label).join(" → ")}\n\n` +
              "Check the words (the AI can mishear a few) and rename any section that's off, e.g. if a Verse is really a Bridge."
          );
          if (onChartCreated) onChartCreated(made.chart);
          else window.location.reload();
          break;
        }
        if (st.status === "succeeded") {
          const { markers, found, total } = alignSections(chart, st.segments ?? [], duration || audioRef.current?.duration || 0);
          if (!found) throw new Error("The AI couldn't match any lyrics. Check the chart's words match the recording, or use ⚡ Estimate.");
          await saveMarkers(markers);
          setShowTimes(true);
          alert(`🤖 Synced: found ${found} of ${total} sections by their words${found < total ? "; the rest were placed between them" : ""}.\n\nCheck them in ⏱ Section times (▶ next to each plays from there) and nudge any that are off.`);
          break;
        }
        if (st.status === "failed" || st.status === "canceled" || st.error) throw new Error(st.error ?? st.status);
        if (Date.now() - began > 8 * 60 * 1000) throw new Error("Took too long. Try again in a minute.");
      }
    } catch (e) {
      alert("Auto-sync: " + (e as Error).message);
    } finally {
      setSyncing(null);
    }
  }

  /** Spread the sections across the song by how many lyric lines each has (a repeat uses its first time's length). */
  function estimateMarkers() {
    if (Object.keys(guess).length) saveMarkers(guess);
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
    document.body.style.paddingBottom = `${(open ? 230 : 130) + (showMixer && useStems ? 220 : 0) + (showTimes ? 230 : 0) + bottomOffset}px`;
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, [hasBar, open, bottomOffset, showMixer, useStems, showTimes]);

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
            {canEdit && track && !stems.length && (
              <button
                onClick={splitHere}
                disabled={!!splitting}
                className="mb-3 w-full rounded-md bg-accent px-3 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-80"
                title="Split into vocals, drums, bass, guitar, keys and other"
              >
                {splitting ?? "✂ Split this song into stems (vocals, drums, bass, keys…)"}
              </button>
            )}
            {showTimes && track && (
              <div className="mb-3 max-h-56 overflow-y-auto rounded-md bg-black/5 p-2 text-xs">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex-1 font-bold uppercase tracking-wide">Section start times</span>
                  <button className="rounded-sm bg-accent px-2 py-1 font-bold text-white" onClick={estimateMarkers} disabled={!duration} title="Spread sections across the song by lyric length">
                    ⚡ Estimate
                  </button>
                  <button className="rounded-sm bg-ink px-2 py-1 font-bold text-white disabled:opacity-60" onClick={autoSync} disabled={!!syncing} title="AI listens to the song and finds where each section starts">
                    {syncing ? "🤖 Listening…" : "🤖 Auto-sync (AI)"}
                  </button>
                  <button className="opacity-70" onClick={() => setShowTimes(false)}>Done</button>
                </div>
                <ul className="space-y-1">
                  {sections.map((sec) => {
                    const t = track.markers?.[sec.n];
                    return (
                      <li key={sec.n} className="flex items-center gap-2">
                        <span className="w-24 truncate font-semibold" title={sec.label}>{sec.abbr} · {sec.label}</span>
                        <input
                          key={`${sec.n}-${t ?? "x"}`}
                          className="w-16 rounded border border-current/20 bg-transparent px-1 py-0.5 text-right tabular-nums"
                          placeholder="m:ss"
                          defaultValue={t === undefined ? "" : fmt(t)}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const next = { ...(track.markers ?? {}) };
                            if (!v) delete next[sec.n];
                            else {
                              const m = v.match(/^(\d{1,2}):(\d{1,2})$/) ?? v.match(/^(\d+)$/);
                              if (!m) return alert("Use minutes:seconds, like 1:05");
                              next[sec.n] = m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
                            }
                            saveMarkers(next);
                          }}
                        />
                        <button className="rounded border border-current/20 px-1.5 py-0.5" onClick={() => saveMarkers({ ...(track.markers ?? {}), [sec.n]: Math.round((audioRef.current?.currentTime ?? 0) * 10) / 10 })} title="Set to where the song is now">
                          ⏱ Now
                        </button>
                        {t !== undefined && (
                          <>
                            <button className="px-1 opacity-70" onClick={() => saveMarkers({ ...track.markers, [sec.n]: Math.max(0, t - 1) })}>−1s</button>
                            <button className="px-1 opacity-70" onClick={() => saveMarkers({ ...track.markers, [sec.n]: t + 1 })}>+1s</button>
                            <button className="px-1 opacity-70" onClick={() => { const a = audioRef.current; if (a) { a.currentTime = t; if (a.paused) a.play().catch(() => {}); } }} title="Play from here">▶</button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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
              <audio key={track.id} ref={audioRef} src={track.url} crossOrigin="anonymous" preload="metadata" loop={loop === "song"} {...masterEvents} />
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

            <div className="mb-1 flex items-center justify-between font-mono text-[11px] tabular-nums">
              <span className="opacity-60">{fmt(time)}</span>
              {chordNow && (chordNow.cur || chordNow.next) && (
                <span className="flex items-baseline gap-2 font-sans" title={`Chords heard in the recording (key ${heardChords?.key}). A best guess.`}>
                  <span className="text-[10px] font-bold uppercase tracking-wide opacity-50">🎸</span>
                  <span className="min-w-[2.5ch] text-center text-xl font-extrabold text-accent">{chordNow.cur || "–"}</span>
                  {chordNow.next && <span className="text-sm font-semibold opacity-50">→ {chordNow.next}</span>}
                </span>
              )}
              <span className="opacity-60">{fmt(duration)}</span>
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
                {counting ?? (playing ? "❚❚" : "▶")}
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
                  {[0.5, 0.75, 0.9, 1, 1.1, 1.25].map((r) => <option key={r} value={r} className="text-ink">{r === 1 ? "1× speed" : `${r}×`}</option>)}
                </select>
                <span className="inline-flex items-center rounded-sm border border-current/20" title="Change the song's key (the chart's chords move with it)">
                  <button onClick={() => changePitch(-1)} className="px-1.5 py-0.5 font-bold" aria-label="Key down">−</button>
                  <span className={`min-w-[3.6rem] text-center ${pitch ? "font-bold text-accent" : ""}`}>Key {pitch > 0 ? `+${pitch}` : pitch || "0"}</span>
                  <button onClick={() => changePitch(1)} className="px-1.5 py-0.5 font-bold" aria-label="Key up">+</button>
                </span>
                {countBpm && !songHasClick ? (
                  <button onClick={() => setClick(!click)} className={chip(click)} title={bpm ? "Click on every beat" : "Click on every beat (tempo heard in the recording)"}>
                    ♩ Click {countBpm}{!bpm && "*"}
                  </button>
                ) : null}
                {!songHasGuide && (
                  <button onClick={toggleCues} className={chip(cues)} title="Calls each section (Verse 1, Chorus…) one bar before it starts">
                    🗣 Guide{!marks.length ? " (mark first)" : estimated ? " (est.)" : ""}
                  </button>
                )}
                {countBpm ? (
                  <select
                    aria-label="Count-in"
                    value={countIn}
                    onChange={(e) => chooseCountIn(e.target.value as "2bar" | "1bar" | "off")}
                    className="rounded-sm border border-current/20 bg-transparent px-1 py-0.5"
                    title="Count before the song starts (from the top)"
                  >
                    <option value="2bar" className="text-ink">Count-in: 1 · 2 · 1 2 3 4</option>
                    <option value="1bar" className="text-ink">Count-in: 1 2 3 4</option>
                    <option value="off" className="text-ink">No count-in</option>
                  </select>
                ) : null}
                {(countBpm || !songHasGuide) && (
                  <span className="inline-flex items-center gap-1.5 normal-case">
                    {countBpm && !songHasClick ? (
                      <label className="inline-flex items-center gap-1" title="Click volume">
                        <span className="text-[10px] font-bold uppercase opacity-60">Click</span>
                        <input type="range" min={0} max={1} step={0.05} value={clickVol} onChange={(e) => setClickVol(Number(e.target.value))} className="w-16 accent-[#df6437]" />
                      </label>
                    ) : null}
                    {!songHasGuide && (
                      <label className="inline-flex items-center gap-1" title="Guide volume">
                        <span className="text-[10px] font-bold uppercase opacity-60">Guide</span>
                        <input type="range" min={0} max={1} step={0.05} value={guideVol} onChange={(e) => setGuideVol(Number(e.target.value))} className="w-16 accent-[#df6437]" />
                      </label>
                    )}
                  </span>
                )}
                <select
                  aria-label="Guide voice"
                  value={voice}
                  onChange={(e) => chooseVoice(e.target.value as CueVoiceId)}
                  className="rounded-sm border border-current/20 bg-transparent px-1 py-0.5"
                  title="Voice for cues and the count-in"
                >
                  {CUE_VOICES.map((v) => <option key={v.id} value={v.id} className="text-ink">{v.name}</option>)}
                </select>
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
                {canEdit && track && (
                  <>
                    <button
                      onClick={() => {
                        if (!sections.length) return alert("This song's chart has no section names yet (Verse 1, Chorus…). Edit the song and add them, or import its ProPresenter file.");
                        if (!markersOk) return alert("Section times need the database update. Run ALL_UPDATES.sql in Supabase (SQL editor), then reload.");
                        setShowTimes(false);
                        setMarking(!marking);
                      }}
                      className={`ml-auto rounded-sm px-2 py-1 font-bold uppercase ${marking ? "bg-ok text-white" : "opacity-70 hover:opacity-100"}`}
                    >
                      {marking ? "Done marking" : "Mark sections"}
                    </button>
                    <button
                      onClick={() => {
                        if (!sections.length) return alert("This song's chart has no section names yet (Verse 1, Chorus…). Edit the song and add them, or import its ProPresenter file.");
                        if (!markersOk) return alert("Section times need the database update. Run ALL_UPDATES.sql in Supabase (SQL editor), then reload.");
                        setMarking(false);
                        setShowTimes(!showTimes);
                      }}
                      className={chip(showTimes)}
                    >
                      ⏱ Section times
                    </button>
                    <button onClick={autoSync} disabled={!!syncing} className={chip(!!syncing)} title="AI listens to the song and finds where each section starts">
                      {syncing ?? (sections.length ? "🤖 Auto-sync" : "🤖 AI: write lyrics + sections")}
                    </button>
                    {bySection && sections.length > 0 && (
                      <button onClick={saveChordsToChart} className={chip(false)} title="Write the heard chords under each section of the chart">
                        🎸 Save chords
                      </button>
                    )}
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
