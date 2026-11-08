"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sectionsOf } from "@/lib/chordpro";
import { loadAnalysis, type Analysis } from "@/lib/analysis";
import { snapToBeat } from "@/lib/tempo";
import { cueClick, preloadCues, sayCue, sharedAudio, teamVoiceUrls, unlockCues, type CueVoiceId } from "@/lib/cueVoice";
import { fmtDate, planLabel } from "@/lib/format";
import { useScreenSync } from "@/components/screen/useScreenSync";
import { usePlanSlides } from "@/components/screen/usePlanSlides";
import { slideForPosition } from "@/lib/slides";
import type { Plan } from "@/lib/types";

// ── Sunday Mode: live tracks from a Mac into the soundboard ──
// Left channel  = click + guide (count-ins, section calls) → in-ears only.
// Right channel = the tracks you choose per song → main speakers.

type F = { id: string; name: string; path: string; markers: Record<string, number> | null; is_stem: boolean; url?: string };
type LiveSong = { itemId: string; songId: string; title: string; key: string | null; bpm: number | null; meter: string | null; chart: string; files: F[] };
type Mix = Record<string, { on: boolean; vol: number }>;

const LEFT = /click|guide|cue/i;
const TRACK_DEFAULT = /other|keys?|piano|synth|pads?|strings?|track|instrument|loop|ambient/i;
const fmt = (t: number) => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00");
const remember = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const recall = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};

export default function SundayMode() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [songs, setSongs] = useState<LiveSong[]>([]);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState("");

  // ── Load the service: songs in order, their audio files (signed links) ──
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data: p } = await sb.from("plans").select("*").eq("id", id).maybeSingle();
      setPlan(p as Plan);
      const { data: items, error } = await sb.from("plan_items").select("id, kind, song_id, song_key, songs(id, title, bpm, meter, default_key, chordpro)").eq("plan_id", id).order("position");
      if (error) return setErr(error.message);
      type Row = { id: string; kind: string; song_key: string | null; songs: { id: string; title: string; bpm: number | null; meter: string | null; default_key: string | null; chordpro: string } | null };
      const rows = ((items ?? []) as unknown as Row[]).filter((r) => r.kind === "song" && r.songs);
      const ids = [...new Set(rows.map((r) => r.songs!.id))];
      const { data: files } = ids.length ? await sb.from("song_files").select("*").in("song_id", ids) : { data: [] };
      const audio = ((files ?? []) as (F & { song_id: string })[]).filter((f) => /\.(mp3|m4a|wav|aac|flac|ogg|aif|aiff)$/i.test(f.path));
      const { data: signed } = audio.length ? await sb.storage.from("charts").createSignedUrls(audio.map((f) => f.path), 60 * 60 * 8) : { data: [] };
      audio.forEach((f, i) => (f.url = signed?.[i]?.signedUrl ?? undefined));
      setSongs(
        rows.map((r) => ({
          itemId: r.id,
          songId: r.songs!.id,
          title: r.songs!.title,
          key: r.song_key || r.songs!.default_key,
          bpm: r.songs!.bpm,
          meter: r.songs!.meter,
          chart: r.songs!.chordpro ?? "",
          files: audio.filter((f) => f.song_id === r.songs!.id && f.url),
        }))
      );
    })();
  }, [id]);

  const song = songs[idx];
  // Play the stems together when there are any, otherwise the full track.
  const sources = useMemo(() => {
    if (!song) return [];
    const stems = song.files.filter((f) => f.is_stem);
    return stems.length ? stems : song.files.filter((f) => !f.is_stem).slice(0, 1);
  }, [song]);
  const hasStems = sources.some((f) => f.is_stem);
  const songHasClick = sources.some((f) => /click/i.test(f.name));
  const songHasGuide = sources.some((f) => /guide|cue/i.test(f.name));
  const sections = useMemo(() => sectionsOf(song?.chart ?? ""), [song]);
  const markerFile = song?.files.find((f) => f.markers && Object.keys(f.markers).length) ?? null;
  const marks = useMemo(
    () =>
      Object.entries(markerFile?.markers ?? {})
        .map(([n, t]) => ({ n: Number(n), t }))
        .filter((m) => sections[m.n])
        .sort((a, b) => a.t - b.t),
    [markerFile, sections]
  );

  // Analysis (tempo + beat grid) of the main file, saved earlier by the player.
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  useEffect(() => {
    setAnalysis(null);
    const main = song?.files.find((f) => !f.is_stem) ?? song?.files[0];
    if (main) loadAnalysis(main.id).then(setAnalysis);
  }, [song]);
  const bpm = song?.bpm || analysis?.tempo?.bpm || 0;
  const spb = bpm ? 60 / bpm : 0;
  const beatsPerBar = Math.max(2, Math.min(12, parseInt(song?.meter ?? "", 10) || 4));
  const offset = analysis?.tempo && (!song?.bpm || [0.5, 1, 2].some((k) => Math.abs(analysis.tempo!.bpm * k - song.bpm!) <= 2)) ? analysis.tempo.offset : 0;
  const snap = useCallback((t: number) => (spb && analysis?.tempo ? snapToBeat(t, { bpm, offset }, bpm) : t), [spb, analysis, bpm, offset]);

  // ── Settings remembered on this Mac ──
  const [mix, setMix] = useState<Mix>({});
  useEffect(() => {
    if (!song) return;
    const saved = recall<Mix>(`fw.live.${song.songId}`, {});
    const m: Mix = {};
    for (const f of sources) m[f.id] = saved[f.id] ?? { on: LEFT.test(f.name) || !hasStems || TRACK_DEFAULT.test(f.name), vol: 1 };
    setMix(m);
  }, [song, sources, hasStems]);
  const setChannel = (fid: string, patch: Partial<{ on: boolean; vol: number }>) =>
    setMix((m) => {
      const next = { ...m, [fid]: { ...m[fid], ...patch } };
      if (song) remember(`fw.live.${song.songId}`, next);
      return next;
    });
  const [clickOn, setClickOn] = useState(true);
  const [guideOn, setGuideOn] = useState(true);
  const [clickVol, setClickVol] = useState(0.7);
  const [guideVol, setGuideVol] = useState(1);
  const [countIn, setCountIn] = useState<"2bar" | "1bar" | "off">("2bar");
  const [voice, setVoice] = useState<CueVoiceId>("male");
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    const s = recall("fw.live.settings", { clickOn: true, guideOn: true, clickVol: 0.7, guideVol: 1, countIn: "2bar", follow: true });
    setClickOn(s.clickOn);
    setGuideOn(s.guideOn);
    setClickVol(s.clickVol);
    setGuideVol(s.guideVol);
    setCountIn(s.countIn as "2bar");
    setFollow(s.follow);
    teamVoiceUrls().then((m) => setVoice(m.size ? "team" : (recall("fw.voice", "male") as CueVoiceId)));
  }, []);
  useEffect(() => remember("fw.live.settings", { clickOn, guideOn, clickVol, guideVol, countIn, follow }), [clickOn, guideOn, clickVol, guideVol, countIn, follow]);
  useEffect(() => {
    preloadCues(voice, [...sections.map((s) => s.label), "1", "2", "3", "4", "5", "6"]);
  }, [voice, sections]);

  // ── Audio engine: two mono buses into a stereo output (L = click/guide, R = tracks) ──
  const bus = useRef<{ ctx: AudioContext; left: GainNode; right: GainNode } | null>(null);
  const engine = useCallback(() => {
    if (bus.current) return bus.current;
    const ctx = sharedAudio();
    if (!ctx) return null;
    const mono = () => {
      const g = ctx.createGain();
      g.channelCount = 1;
      g.channelCountMode = "explicit";
      g.channelInterpretation = "speakers";
      return g;
    };
    const left = mono(), right = mono();
    const merger = ctx.createChannelMerger(2);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(ctx.destination);
    bus.current = { ctx, left, right };
    return bus.current;
  }, []);

  const els = useRef<Map<string, HTMLAudioElement>>(new Map());
  const gains = useRef<Map<string, GainNode>>(new Map());
  const wired = useRef<WeakSet<HTMLAudioElement>>(new WeakSet());
  const wire = useCallback(() => {
    const e = engine();
    if (!e) return;
    for (const f of sources) {
      const el = els.current.get(f.id);
      if (!el || wired.current.has(el)) continue;
      const g = e.ctx.createGain();
      e.ctx.createMediaElementSource(el).connect(g).connect(LEFT.test(f.name) ? e.left : e.right);
      gains.current.set(f.id, g);
      wired.current.add(el);
    }
  }, [engine, sources]);
  useEffect(() => {
    for (const f of sources) {
      const g = gains.current.get(f.id);
      const c = mix[f.id];
      if (g && c) g.gain.value = c.on ? c.vol : 0;
    }
  }, [mix, sources]);

  const master = () => els.current.get(sources[0]?.id ?? "");
  const all = () => sources.map((f) => els.current.get(f.id)).filter(Boolean) as HTMLAudioElement[];
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [counting, setCounting] = useState<string | null>(null);
  const abortCount = useRef<(() => void) | null>(null);
  const [loopN, setLoopN] = useState<number | null>(null);
  const pendingJump = useRef<number | undefined>(undefined);

  const seekAll = (t: number) => all().forEach((el) => (el.currentTime = Math.max(0, t)));
  const playAll = () => all().forEach((el) => el.play().catch(() => {}));
  // keep stems in step with the first one
  useEffect(() => {
    if (!playing || all().length < 2) return;
    const t = window.setInterval(() => {
      const m = master();
      if (!m) return;
      for (const el of all()) if (el !== m && Math.abs(el.currentTime - m.currentTime) > 0.06) el.currentTime = m.currentTime;
    }, 500);
    return () => window.clearInterval(t);
  }, [playing, sources]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Click + guide scheduler (left channel), locked to the song's beat ──
  const scheduled = useRef<{ stop: () => void }[]>([]);
  const cancel = () => {
    scheduled.current.forEach((x) => x.stop());
    scheduled.current = [];
  };
  useEffect(() => {
    const e = bus.current;
    if (!playing || !e) {
      cancel();
      return;
    }
    let anchor = { ctx: e.ctx.currentTime, song: master()?.currentTime ?? 0 };
    let nextBeat = -1;
    const called = new Set<number>();
    marks.forEach((m) => m.t <= anchor.song && called.add(m.n));
    const toCtx = (t: number) => anchor.ctx + (t - anchor.song);
    const barAnchor = marks.find((m) => m.t > 0.3)?.t;
    const downbeat = (k: number) => {
      if (barAnchor === undefined || !spb) return k % beatsPerBar === 0;
      const a = Math.round((snap(barAnchor) - offset) / spb);
      return (((k - a) % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
    };
    const id = window.setInterval(() => {
      const m = master();
      if (!m || m.paused) return;
      const now = anchor.song + (e.ctx.currentTime - anchor.ctx);
      if (Math.abs(now - m.currentTime) > 0.06) {
        cancel();
        anchor = { ctx: e.ctx.currentTime, song: m.currentTime };
        nextBeat = -1;
        called.clear();
        marks.forEach((x) => x.t <= m.currentTime && called.add(x.n));
        return;
      }
      const ahead = 0.3;
      if (clickOn && !songHasClick && spb) {
        let k = Math.max(nextBeat, Math.ceil((now - offset) / spb - 1e-6));
        for (; offset + k * spb < now + ahead; k++) {
          const t = offset + k * spb;
          if (t >= now - 0.01) scheduled.current.push(cueClick(toCtx(t), downbeat(k), clickVol, e.left));
        }
        nextBeat = k;
      }
      if (guideOn && !songHasGuide) {
        const bar = spb ? spb * beatsPerBar : 1.6;
        for (const x of marks) {
          if (called.has(x.n) || x.t < 0.3) continue;
          const at = snap(x.t) - bar;
          if (at < now - 0.08 || at > now + ahead + 0.3) continue;
          called.add(x.n);
          sayCue(voice, sections[x.n]?.label ?? "", { when: toCtx(Math.max(at, now)), volume: guideVol, dest: e.left }).then((s) => scheduled.current.push(s));
        }
      }
      if (scheduled.current.length > 64) scheduled.current = scheduled.current.slice(-32);
    }, 40);
    return () => window.clearInterval(id);
  }, [playing, clickOn, guideOn, clickVol, guideVol, spb, offset, beatsPerBar, marks, sections, voice, songHasClick, songHasGuide, snap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vamp: loop the current section until you let go ──
  const sectionAt = (t: number) => {
    let c: number | null = null;
    for (const m of marks) if (m.t <= t + 0.05) c = m.n;
    return c;
  };
  const range = (n: number) => {
    const i = marks.findIndex((m) => m.n === n);
    return i < 0 ? null : { start: snap(marks[i].t), end: marks[i + 1] ? snap(marks[i + 1].t) : duration };
  };
  useEffect(() => {
    if (loopN === null || !playing) return;
    const r = range(loopN);
    if (r && time >= r.end - 0.04) seekAll(r.start);
  }, [time, loopN, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transport ──
  async function play() {
    const e = engine();
    unlockCues();
    wire();
    if (!e || !sources.length) return;
    e.ctx.resume().catch(() => {});
    const m = master();
    if (!m) return;
    if (countIn !== "off" && m.currentTime < 0.5 && spb) {
      // count-in on the left channel, the song lands on the downbeat
      const bars = countIn === "1bar" ? 1 : 2;
      const words: string[] = [];
      for (let b = 0; b < bars; b++)
        for (let i = 0; i < beatsPerBar; i++) words.push(bars === 2 && b === 0 ? (i === 0 ? "1" : beatsPerBar % 2 === 0 && i === beatsPerBar / 2 ? "2" : "") : String(i + 1));
      const t0 = e.ctx.currentTime + 0.12;
      const first = analysis?.peaks?.length && duration ? Math.max(0, offset + Math.max(0, Math.ceil(((analysis.peaks.findIndex((p) => p > 0.12) / analysis.peaks.length) * duration - 0.08 - offset) / spb)) * spb) : offset;
      const tEnd = t0 + words.length * spb;
      const sounds: { stop: () => void }[] = [];
      const timers: number[] = [];
      words.forEach((w, i) => {
        const at = t0 + i * spb;
        sounds.push(cueClick(at, i % beatsPerBar === 0, Math.max(clickVol, 0.4), e.left));
        if (w) sayCue(voice, w, { when: at, volume: guideVol, dest: e.left }).then((x) => sounds.push(x));
        timers.push(window.setTimeout(() => setCounting(w || "•"), Math.max(0, (at - e.ctx.currentTime) * 1000)));
      });
      abortCount.current = () => {
        sounds.forEach((x) => x.stop());
        timers.forEach(clearTimeout);
        setCounting(null);
        abortCount.current = null;
      };
      timers.push(
        window.setTimeout(() => {
          seekAll(0);
          playAll();
          window.setTimeout(() => {
            setCounting(null);
            abortCount.current = null;
          }, Math.max(0, (tEnd - e.ctx.currentTime) * 1000));
        }, Math.max(0, (tEnd - first - 0.02 - e.ctx.currentTime) * 1000))
      );
      return;
    }
    playAll();
  }
  function pause() {
    abortCount.current?.();
    all().forEach((el) => el.pause());
  }
  function stop() {
    pause();
    seekAll(0);
    setLoopN(null);
  }
  function goSong(i: number) {
    if (i < 0 || i >= songs.length) return;
    stop();
    setIdx(i);
    setLoopN(null);
  }
  /** Jump to a section: right away when stopped, on the next downbeat while playing. */
  function jumpTo(n: number) {
    const r = range(n);
    if (!r) return;
    const m = master();
    if (!m || m.paused || !spb) return seekAll(r.start);
    const now = m.currentTime;
    const k = Math.ceil((now - offset) / (spb * beatsPerBar) + 1e-3);
    const nextBar = offset + k * spb * beatsPerBar;
    clearTimeout(pendingJump.current);
    pendingJump.current = window.setTimeout(() => seekAll(r.start), Math.max(0, (nextBar - now) * 1000 - 15));
  }
  function testSide(side: "left" | "right") {
    const e = engine();
    unlockCues();
    if (!e) return;
    e.ctx.resume().catch(() => {});
    const t = e.ctx.currentTime + 0.05;
    if (side === "left") [0, 1, 2, 3].forEach((i) => cueClick(t + i * 0.4, i === 0, 0.8, e.left));
    else {
      const o = e.ctx.createOscillator();
      const g = e.ctx.createGain();
      o.frequency.value = 220;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g).connect(e.right);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  // ── Keyboard / foot pedal ──
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === "INPUT" || (ev.target as HTMLElement)?.tagName === "SELECT") return;
      const k = ev.key.toLowerCase();
      if (k === " ") master()?.paused && !abortCount.current ? play() : pause();
      else if (k === "escape") stop();
      else if (k === "n" || k === "pagedown") goSong(idx + 1);
      else if (k === "p" || k === "pageup") goSong(idx - 1);
      else if (k === "l") setLoopN((v) => (v === null ? sectionAt(master()?.currentTime ?? 0) : null));
      else if (k === "arrowright" || k === "arrowleft") {
        const cur = sectionAt(master()?.currentTime ?? 0);
        const i = marks.findIndex((m) => m.n === cur);
        const to = marks[Math.max(0, Math.min(marks.length - 1, i + (k === "arrowright" ? 1 : -1)))];
        if (to) jumpTo(to.n);
      } else if (/^[1-9]$/.test(k) && marks[+k - 1]) jumpTo(marks[+k - 1].n);
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bound each render so it sees the latest state

  // ── Big screen lyrics follow the track ──
  const screen = useScreenSync(id);
  const { slides } = usePlanSlides(id, screen.state.lines);
  const cur = sectionAt(time);
  useEffect(() => {
    if (!follow || !playing || !song) return;
    const r = cur === null ? null : range(cur);
    const progress = r && r.end > r.start ? Math.min(0.999, Math.max(0, (time - r.start) / (r.end - r.start))) : 0;
    const i = slideForPosition(slides, song.itemId, { n: cur, progress });
    const st = screen.state;
    if (i >= 0 && (i !== st.slide || st.logo || st.clear || st.black)) screen.set({ slide: i, logo: false, clear: false, black: false, follow: true });
  }, [time, follow, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const masterEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => setTime(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLAudioElement>) => setDuration(e.currentTarget.duration),
    onEnded: () => {
      setPlaying(false);
      setLoopN(null);
      if (idx < songs.length - 1) setIdx(idx + 1); // ready on the next song; press play when the band is ready
    },
  };

  const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-bold ${on ? "bg-accent text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`;

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white">
      {/* hidden audio for this song */}
      <div key={song?.itemId} className="hidden">
        {sources.map((f, i) => (
          <audio
            key={f.id}
            ref={(el) => {
              if (el) els.current.set(f.id, el);
              else els.current.delete(f.id);
            }}
            src={f.url}
            crossOrigin="anonymous"
            preload="auto"
            {...(i === 0 ? masterEvents : {})}
          />
        ))}
      </div>

      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2.5 text-sm">
        <Link href={`/plans/${id}`} className="opacity-60 hover:opacity-100">✕</Link>
        <b className="font-display uppercase tracking-wide">Sunday Mode</b>
        <span className="opacity-60">{plan ? `${planLabel(plan)} · ${fmtDate(plan.service_date, { year: undefined })}` : "…"}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs opacity-60">Output:</span>
          <button className="rounded bg-white/10 px-2 py-1 text-xs font-semibold" onClick={() => testSide("left")}>Test L (click → in-ears)</button>
          <button className="rounded bg-white/10 px-2 py-1 text-xs font-semibold" onClick={() => testSide("right")}>Test R (tracks → mains)</button>
          <button className={pill(follow)} onClick={() => setFollow(!follow)} title="Big screen lyrics follow the track">🖥 Lyrics follow</button>
        </span>
      </header>
      {err && <p className="m-4 rounded bg-red-900/40 p-3">{err}</p>}

      <div className="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
        {/* setlist */}
        <ol className="space-y-1">
          {songs.map((s, i) => (
            <li key={s.itemId}>
              <button onClick={() => goSong(i)} className={`w-full rounded-lg px-3 py-2 text-left ${i === idx ? "bg-accent text-white" : "bg-white/5 hover:bg-white/10"}`}>
                <div className="text-xs opacity-70">{i + 1}{s.key ? ` · ${s.key}` : ""}{s.bpm ? ` · ${s.bpm} bpm` : ""}</div>
                <div className="font-semibold">{s.title}</div>
                {!s.files.length && <div className="text-xs text-amber-300">No audio uploaded</div>}
              </button>
            </li>
          ))}
          {plan && !songs.length && <li className="text-sm opacity-60">No songs in this service yet.</li>}
        </ol>

        {song && (
          <main className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-3xl font-extrabold">{song.title}</h1>
                <div className="text-sm opacity-70">
                  {song.key && <>Key {song.key} · </>}
                  {bpm ? `${bpm} bpm${!song.bpm ? "*" : ""}` : "no tempo yet"} · {beatsPerBar}/4 · {fmt(time)} / {fmt(duration)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="h-14 w-14 rounded-full bg-white/10 text-xl" onClick={stop} aria-label="Stop (Esc)">■</button>
                <button className="h-20 w-20 rounded-full bg-accent text-3xl font-black shadow-lg" onClick={() => (playing || counting ? pause() : play())} aria-label="Play / pause (Space)">
                  {counting ?? (playing ? "❚❚" : "▶")}
                </button>
                <button className="h-14 w-14 rounded-full bg-white/10 text-xl" onClick={() => goSong(idx + 1)} aria-label="Next song (N)">⏭</button>
              </div>
            </div>

            {/* sections */}
            <div className="relative h-14 overflow-hidden rounded-lg bg-white/5">
              {marks.map((m, i) => {
                const end = marks[i + 1]?.t ?? duration;
                const on = cur === m.n;
                return (
                  <button
                    key={m.n}
                    onClick={() => jumpTo(m.n)}
                    className={`absolute inset-y-0 border-r border-black/40 px-1 text-left text-xs font-bold ${on ? "bg-accent" : "bg-white/10 hover:bg-white/20"} ${loopN === m.n ? "ring-2 ring-inset ring-amber-300" : ""}`}
                    style={{ left: `${(m.t / (duration || 1)) * 100}%`, width: `${((end - m.t) / (duration || 1)) * 100}%` }}
                    title={`${sections[m.n]?.label} (key ${i + 1})`}
                  >
                    <span className="block truncate">{sections[m.n]?.abbr}</span>
                  </button>
                );
              })}
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(time / (duration || 1)) * 100}%` }} />
              {!marks.length && <div className="grid h-full place-items-center text-xs opacity-60">No section times yet: open the song and tap 🤖 Auto-sync (once).</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className={pill(loopN !== null)} onClick={() => setLoopN(loopN === null ? cur : null)} disabled={cur === null} title="Loop this section until you turn it off (L)">
                🔁 {loopN !== null ? `Vamping ${sections[loopN]?.label ?? ""}: tap to release` : "Vamp this section"}
              </button>
              <span className="text-xs opacity-50">Tap a section to jump there on the next bar · ← → sections · L vamp · Space play/pause · Esc stop · N next song</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* left channel */}
              <section className="rounded-lg bg-white/5 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide opacity-60">Left · in-ears (click + guide)</div>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={clickOn} onChange={(e) => setClickOn(e.target.checked)} disabled={songHasClick} />
                    <span className="w-16">Click</span>
                    <input type="range" min={0} max={1} step={0.05} value={clickVol} onChange={(e) => setClickVol(+e.target.value)} className="flex-1 accent-[#df6437]" />
                    {songHasClick && <span className="text-xs opacity-60">(song&apos;s own click stem)</span>}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={guideOn} onChange={(e) => setGuideOn(e.target.checked)} disabled={songHasGuide} />
                    <span className="w-16">Guide</span>
                    <input type="range" min={0} max={1} step={0.05} value={guideVol} onChange={(e) => setGuideVol(+e.target.value)} className="flex-1 accent-[#df6437]" />
                    {songHasGuide && <span className="text-xs opacity-60">(song&apos;s own guide stem)</span>}
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-[5.5rem]">Count-in</span>
                    <select className="rounded bg-white/10 px-2 py-1" value={countIn} onChange={(e) => setCountIn(e.target.value as "2bar")}>
                      <option value="2bar" className="text-black">1 · 2 · 1 2 3 4</option>
                      <option value="1bar" className="text-black">1 2 3 4</option>
                      <option value="off" className="text-black">None</option>
                    </select>
                  </label>
                </div>
              </section>
              {/* right channel */}
              <section className="rounded-lg bg-white/5 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide opacity-60">Right · mains (tracks): turn on only what the band isn&apos;t playing</div>
                <div className="space-y-2 text-sm">
                  {sources.map((f) => (
                    <label key={f.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={mix[f.id]?.on ?? false} onChange={(e) => setChannel(f.id, { on: e.target.checked })} />
                      <span className="w-40 truncate">{f.name.replace(/\s*\(split.*\)$/, "")}{LEFT.test(f.name) && <span className="ml-1 text-xs opacity-60">→ left</span>}</span>
                      <input type="range" min={0} max={1} step={0.05} value={mix[f.id]?.vol ?? 1} onChange={(e) => setChannel(f.id, { vol: +e.target.value })} className="flex-1 accent-[#df6437]" />
                    </label>
                  ))}
                  {!sources.length && <p className="opacity-60">No audio for this song.</p>}
                  {sources.length > 0 && !hasStems && <p className="text-xs opacity-60">This song isn&apos;t split into stems, so it&apos;s the full mix. Split it on the song page to choose parts.</p>}
                </div>
              </section>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
