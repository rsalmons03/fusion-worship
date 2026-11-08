"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MultitrackPlayer, { type Stem } from "@/components/tracks/MultitrackPlayer";
import { sectionsOf } from "@/lib/chordpro";
import LyricsPanel from "@/components/tracks/LyricsPanel";
import ChartEditor from "@/components/ChartEditor";
import { teamVoiceUrls, type CueVoiceId } from "@/lib/cueVoice";

// Fusion Tracks: one song's parts in the multitrack mixer.
export default function TracksSong() {
  const { songId } = useParams<{ songId: string }>();
  const [song, setSong] = useState<{ title: string; author: string | null; default_key: string | null; bpm: number | null; meter: string | null; chordpro: string } | null>(null);
  const [sections, setSections] = useState<{ label: string; t: number }[]>([]);
  // Saved section start times (section number → seconds) and the file they're kept on.
  const [markers, setMarkers] = useState<Record<number, number>>({});
  const [markerFile, setMarkerFile] = useState<string | null>(null);
  const [play, setPlay] = useState({ t: 0, playing: false, duration: 0, pitch: 0 });
  const control = useRef<{ seek: (t: number) => void; playFrom: (t: number) => void } | null>(null);
  const [showLyrics, setShowLyrics] = useState(true);
  // Lyrics editor (opened from the lyrics panel)
  const [draft, setDraft] = useState<string | null>(null);
  const [savingLyrics, setSavingLyrics] = useState(false);
  async function saveLyrics() {
    if (draft == null || !song) return;
    setSavingLyrics(true);
    const { error } = await createClient().from("songs").update({ chordpro: draft }).eq("id", songId);
    setSavingLyrics(false);
    if (error) return alert("Couldn't save the lyrics: " + error.message);
    setSong({ ...song, chordpro: draft });
    applyToGuide(markers, draft);
    setDraft(null);
    setShowLyrics(true);
  }
  useEffect(() => {
    try {
      setShowLyrics(localStorage.getItem("fw.tracks.lyrics") !== "0");
    } catch {}
  }, []);
  // The guide calls each section at its time; refresh them from the saved times.
  function applyToGuide(m: Record<number, number>, chart: string) {
    const secs = sectionsOf(chart);
    setSections(
      Object.entries(m)
        .map(([n, t]) => ({ label: secs[Number(n)]?.label ?? "", t }))
        .filter((x) => x.label)
        .sort((a, b) => a.t - b.t)
    );
  }
  const [voice, setVoice] = useState<CueVoiceId>("male");
  useEffect(() => {
    teamVoiceUrls().then((m) => {
      if (m.size) return setVoice("team");
      try {
        const v = localStorage.getItem("fw.voice");
        if (v === "male" || v === "female") setVoice(v);
      } catch {}
    });
  }, []);
  const [stems, setStems] = useState<Stem[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data: s } = await sb.from("songs").select("title, author, default_key, bpm, meter, chordpro").eq("id", songId).maybeSingle();
      setSong(s);
      const { data: files, error } = await sb.from("song_files").select("*").eq("song_id", songId);
      if (error) return setErr(error.message);
      // Section times (for the lyrics and the guide's calls), saved on any of the song's files.
      const withMarks = (files ?? []).find((f) => f.markers && Object.keys(f.markers).length);
      if (withMarks) {
        const m = Object.fromEntries(Object.entries(withMarks.markers as Record<string, number>).map(([n, t]) => [Number(n), t]));
        setMarkers(m);
        setMarkerFile(withMarks.id);
        applyToGuide(m, s?.chordpro ?? "");
      }
      const audio = (files ?? []).filter((f) => /\.(mp3|m4a|wav|aac|flac|ogg|aif|aiff)$/i.test(f.path));
      // Parts = files marked as stems; if none are marked but there are several audio files, use them all.
      const marked = audio.filter((f) => f.is_stem);
      const parts = marked.length ? marked : audio.length > 1 ? audio : [];
      if (!parts.length) return setStems([]);
      const { data: signed } = await sb.storage.from("charts").createSignedUrls(parts.map((f) => f.path), 60 * 60 * 8);
      if (!withMarks) setMarkerFile(parts[0]?.id ?? audio[0]?.id ?? null);
      setStems(parts.map((f, i) => ({ id: f.id, name: f.name, url: signed?.[i]?.signedUrl ?? "" })).filter((x) => x.url));
    })();
  }, [songId]);
  return (
    <div className="fixed inset-0 flex flex-col bg-[#15151c]">
      <div className="flex items-center gap-3 px-3 py-2 text-sm text-white/70">
        <Link href={`/songs/${songId}`} aria-label="Back">‹ Back</Link>
        <button
          className={`ml-auto rounded-full px-3 py-0.5 text-xs font-bold ${showLyrics ? "bg-white/20 text-white" : "bg-white/10"}`}
          onClick={() => {
            setShowLyrics(!showLyrics);
            try {
              localStorage.setItem("fw.tracks.lyrics", showLyrics ? "0" : "1");
            } catch {}
          }}
        >
          Lyrics {showLyrics ? "on" : "off"}
        </button>
        <span className="text-xs uppercase tracking-wider">Fusion Tracks</span>
      </div>
      {err && <p className="m-4 rounded bg-red-900/40 p-3 text-white">{err}</p>}
      {song && stems && (
        stems.length ? (
          <>
          <div className="min-h-0 flex-1">
            <MultitrackPlayer songKey={song.default_key ?? ""} title={song.title} artist={song.author} bpm={song.bpm} meter={song.meter} stems={stems} storageKey={`fw.tracks.${songId}`} sections={sections} voice={voice} control={control} onTime={(t, playing, duration, pitch) => setPlay((p) => (Math.abs(p.t - t) < 0.1 && p.playing === playing && p.duration === duration && p.pitch === pitch ? p : { t, playing, duration, pitch }))} onKeyHeard={(k) => {
                // save the heard key to the song when it has none (leaders only; others quietly can't)
                createClient().from("songs").update({ default_key: k }).eq("id", songId).is("default_key", null).then(() => {});
              }} />
          </div>
          {showLyrics && (
            <LyricsPanel
              chordpro={song.chordpro ?? ""}
              songKey={song.default_key ?? ""}
              time={play.t}
              playing={play.playing}
              duration={play.duration}
              pitch={play.pitch}
              markers={markers}
              onJump={(t) => (play.playing ? control.current?.seek(t) : control.current?.playFrom(t))}
              onMark={(n, t) => {
                const m = { ...markers, [n]: t };
                setMarkers(m);
                if (markerFile)
                  createClient().from("song_files").update({ markers: m }).eq("id", markerFile).then(({ error }) => error && alert(error.message));
              }}
              onMarkingDone={() => applyToGuide(markers, song.chordpro ?? "")}
              onEdit={() => setDraft(song.chordpro ?? "")}
            />
          )}
          {draft != null && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onClick={() => setDraft(null)}>
              <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 text-black" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="font-display text-lg font-extrabold">Lyrics: {song.title}</h2>
                  <button className="ml-auto text-2xl leading-none text-black/50" onClick={() => setDraft(null)} aria-label="Close">×</button>
                </div>
                <p className="mb-2 text-sm text-black/60">
                  Put each section name on its own line (tap the buttons), with its lyrics underneath. Chords are optional: put them in brackets, like [G]Amazing [C]grace.
                </p>
                <ChartEditor value={draft} onChange={setDraft} songKey={song.default_key} placeholder={"Verse 1\nFirst line of the verse\nSecond line\n\nChorus\nFirst line of the chorus"} />
                <div className="mt-3 flex gap-2">
                  <button className="btn" onClick={saveLyrics} disabled={savingLyrics}>{savingLyrics ? "Saving…" : "Save lyrics"}</button>
                  <button className="btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
          </>
        ) : (
          <p className="m-6 text-white/70">This song has no parts yet. On the song page, upload its stem files (Drums, Bass, Keys…), each one marked as a Stem.</p>
        )
      )}
    </div>
  );
}
