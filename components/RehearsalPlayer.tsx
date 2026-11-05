"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sectionsOf, type SectionInfo } from "@/lib/chordpro";
import { isAudio } from "@/lib/media";

type Track = { id: string; name: string; url: string; markers: Record<string, number> };

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

function fmt(t: number) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Section roadmap + bottom player bar for a song's uploaded audio.
 * Leaders can mark where each section starts in the track; then tapping a section jumps there.
 */
export default function RehearsalPlayer({
  songId,
  chart,
  canEdit,
  dark = false,
  bottomOffset = 0,
}: {
  songId: string;
  chart: string;
  canEdit: boolean;
  dark?: boolean;
  /** Space to leave below the player (e.g. for the stage view's Prev/Next bar), in px. */
  bottomOffset?: number;
}) {
  const sections = useMemo(() => sectionsOf(chart), [chart]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackIdx, setTrackIdx] = useState(0);
  const [markersOk, setMarkersOk] = useState(true);
  const track = tracks[trackIdx];

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState<"off" | "song" | "section">("off");
  const [rate, setRate] = useState(1);
  const [marking, setMarking] = useState(false);
  const [open, setOpen] = useState(true);

  // Load audio files for this song.
  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    (async () => {
      type Row = { id: string; name: string; path: string; markers?: Record<string, number> };
      let rows: Row[] = [];
      const res = await supabase.from("song_files").select("id,name,path,markers").eq("song_id", songId).order("name");
      if (res.error) {
        setMarkersOk(false);
        const old = await supabase.from("song_files").select("id,name,path").eq("song_id", songId).order("name");
        rows = (old.data ?? []) as Row[];
      } else rows = (res.data ?? []) as Row[];
      const audio = (rows as { id: string; name: string; path: string; markers?: Record<string, number> }[]).filter((f) => isAudio(f.path));
      const out: Track[] = [];
      for (const f of audio) {
        const { data } = await supabase.storage.from("charts").createSignedUrl(f.path, 60 * 60 * 6);
        if (data) out.push({ id: f.id, name: f.name, url: data.signedUrl, markers: f.markers ?? {} });
      }
      if (alive) setTracks(out);
    })();
    return () => {
      alive = false;
    };
  }, [songId]);

  // Build the waveform for the current track.
  useEffect(() => {
    setPeaks(null);
    setTime(0);
    setPlaying(false);
    if (!track) return;
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(track.url)).arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
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
  }, [track]);

  // Ordered markers: [{n, t}]
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

  // Draw waveform.
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
    const accent = "#df6437";
    const rest = dark ? "rgba(255,255,255,0.28)" : "rgba(17,17,17,0.22)";
    p.forEach((v, i) => {
      const bh = Math.max(2, v * (h - 4));
      g.fillStyle = i / p.length < played ? accent : rest;
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 1), bh);
    });
    if (duration) {
      g.fillStyle = dark ? "#fff" : "#111";
      for (const m of marks) g.fillRect((m.t / duration) * w, 0, 1, h);
    }
  }, [peaks, time, duration, dark, marks]);

  // Section loop.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || loop !== "section" || current === null) return;
    const r = sectionRange(current);
    if (r && time >= r.end - 0.05) a.currentTime = r.start;
  }, [time, loop, current, sectionRange]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, track]);

  function scrollTo(n: number) {
    document.getElementById(`sec-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function tapSection(s: SectionInfo) {
    const a = audioRef.current;
    if (marking && a && track) {
      const markers = { ...track.markers, [s.n]: Math.round(a.currentTime * 10) / 10 };
      setTracks((ts) => ts.map((t, i) => (i === trackIdx ? { ...t, markers } : t)));
      const { error } = await createClient().from("song_files").update({ markers }).eq("id", track.id);
      if (error) alert(error.message);
      return;
    }
    scrollTo(s.n);
    const r = sectionRange(s.n);
    if (a && r) {
      a.currentTime = r.start;
      if (a.paused) a.play();
    }
  }

  async function clearMarkers() {
    if (!track || !confirm("Clear all section markers for this track?")) return;
    setTracks((ts) => ts.map((t, i) => (i === trackIdx ? { ...t, markers: {} } : t)));
    await createClient().from("song_files").update({ markers: {} }).eq("id", track.id);
  }

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * duration;
  }

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }

  // Follow along: when a new marked section starts playing, scroll the chart to it.
  const lastScrolled = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || marking || current === null || current === lastScrolled.current) return;
    lastScrolled.current = current;
    scrollTo(current);
  }, [current, playing, marking]);

  // Leave room at the bottom of the page so the player bar doesn't cover the end of the chart.
  useEffect(() => {
    if (!track) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `${(open ? 190 : 110) + bottomOffset}px`;
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, [track, open, bottomOffset]);

  const styles = dark ? KIND_STYLE_DARK : KIND_STYLE;
  const bar = dark ? "bg-stone-900 border-stone-700 text-white" : "bg-white border-line text-ink";

  return (
    <>
      {sections.length > 0 && (
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

      {track && (
        <>
          <div style={{ bottom: bottomOffset }} className={`fixed inset-x-0 z-30 border-t shadow-[0_-4px_16px_rgba(0,0,0,0.08)] print:hidden ${bar}`}>
            <button className="mx-auto block w-16 py-1.5" onClick={() => setOpen(!open)} aria-label={open ? "Collapse player" : "Expand player"}>
              <span className="block h-1 rounded-full bg-current opacity-30" />
            </button>
            <div className="mx-auto max-w-3xl px-4 pb-4">
              {open && (
                <canvas ref={canvasRef} onClick={seek} className="mb-2 h-14 w-full cursor-pointer" aria-label="Waveform: tap to seek" />
              )}
              <audio
                ref={audioRef}
                src={track.url}
                preload="metadata"
                loop={loop === "song"}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onEnded={() => setPlaying(false)}
              />
              <div className="flex items-center gap-3">
                <span className="w-20 font-mono text-xs tabular-nums opacity-70">{fmt(time)} / {fmt(duration)}</span>
                <button className="text-xl opacity-80 hover:opacity-100" aria-label="Back to start" onClick={() => audioRef.current && (audioRef.current.currentTime = 0)}>⏮</button>
                <button
                  onClick={toggle}
                  aria-label={playing ? "Pause" : "Play"}
                  className="grid h-12 w-12 place-items-center rounded-full bg-accent text-xl text-white"
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <button
                  onClick={() => setLoop(loop === "off" ? "song" : loop === "song" && marks.length ? "section" : "off")}
                  className={`rounded-sm px-2 py-1 text-xs font-bold uppercase ${loop !== "off" ? "bg-accent text-white" : "opacity-70"}`}
                  title="Loop off / whole song / current section"
                >
                  {loop === "off" ? "Loop" : loop === "song" ? "Loop song" : "Loop section"}
                </button>
                <select
                  aria-label="Speed"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  className="ml-auto rounded-sm border border-current/20 bg-transparent px-1 py-0.5 text-xs"
                >
                  {[0.5, 0.75, 0.9, 1].map((r) => <option key={r} value={r} className="text-ink">{r === 1 ? "1×" : `${r}×`}</option>)}
                </select>
              </div>
              {open && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {tracks.length > 1 && (
                    <select aria-label="Track" value={trackIdx} onChange={(e) => setTrackIdx(Number(e.target.value))} className="rounded-sm border border-current/20 bg-transparent px-1 py-0.5">
                      {tracks.map((t, i) => <option key={t.id} value={i} className="text-ink">{t.name}</option>)}
                    </select>
                  )}
                  {tracks.length === 1 && <span className="opacity-60">{track.name}</span>}
                  {canEdit && markersOk && sections.length > 0 && (
                    <>
                      <button
                        onClick={() => setMarking(!marking)}
                        className={`ml-auto rounded-sm px-2 py-1 font-bold uppercase ${marking ? "bg-ok text-white" : "opacity-70 hover:opacity-100"}`}
                      >
                        {marking ? "Done marking" : "Mark sections"}
                      </button>
                      {marks.length > 0 && !marking && <button className="opacity-60 hover:opacity-100" onClick={clearMarkers}>Clear marks</button>}
                    </>
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
        </>
      )}
    </>
  );
}
