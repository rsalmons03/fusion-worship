"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MultitrackPlayer, { type Stem } from "@/components/tracks/MultitrackPlayer";
import { sectionsOf } from "@/lib/chordpro";
import { teamVoiceUrls, type CueVoiceId } from "@/lib/cueVoice";

// Fusion Tracks: one song's parts in the multitrack mixer.
export default function TracksSong() {
  const { songId } = useParams<{ songId: string }>();
  const [song, setSong] = useState<{ title: string; author: string | null; default_key: string | null; bpm: number | null; meter: string | null; chordpro: string } | null>(null);
  const [sections, setSections] = useState<{ label: string; t: number }[]>([]);
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
      // Section times (for the guide's calls), saved on any of the song's files.
      const secs = sectionsOf(s?.chordpro ?? "");
      const withMarks = (files ?? []).find((f) => f.markers && Object.keys(f.markers).length);
      if (withMarks)
        setSections(
          Object.entries(withMarks.markers as Record<string, number>)
            .map(([n, t]) => ({ label: secs[Number(n)]?.label ?? "", t }))
            .filter((x) => x.label)
            .sort((a, b) => a.t - b.t)
        );
      const audio = (files ?? []).filter((f) => /\.(mp3|m4a|wav|aac|flac|ogg|aif|aiff)$/i.test(f.path));
      // Parts = files marked as stems; if none are marked but there are several audio files, use them all.
      const marked = audio.filter((f) => f.is_stem);
      const parts = marked.length ? marked : audio.length > 1 ? audio : [];
      if (!parts.length) return setStems([]);
      const { data: signed } = await sb.storage.from("charts").createSignedUrls(parts.map((f) => f.path), 60 * 60 * 8);
      setStems(parts.map((f, i) => ({ id: f.id, name: f.name, url: signed?.[i]?.signedUrl ?? "" })).filter((x) => x.url));
    })();
  }, [songId]);
  return (
    <div className="fixed inset-0 flex flex-col bg-[#15151c]">
      <div className="flex items-center gap-3 px-3 py-2 text-sm text-white/70">
        <Link href={`/songs/${songId}`} aria-label="Back">‹ Back</Link>
        <span className="ml-auto text-xs uppercase tracking-wider">Fusion Tracks</span>
      </div>
      {err && <p className="m-4 rounded bg-red-900/40 p-3 text-white">{err}</p>}
      {song && stems && (
        stems.length ? (
          <div className="min-h-0 flex-1">
            <MultitrackPlayer songKey={song.default_key ?? ""} title={song.title} artist={song.author} bpm={song.bpm} meter={song.meter} stems={stems} storageKey={`fw.tracks.${songId}`} sections={sections} voice={voice} onKeyHeard={(k) => {
                // save the heard key to the song when it has none (leaders only; others quietly can't)
                createClient().from("songs").update({ default_key: k }).eq("id", songId).is("default_key", null).then(() => {});
              }} />
          </div>
        ) : (
          <p className="m-6 text-white/70">This song has no parts yet. On the song page, upload its stem files (Drums, Bass, Keys…), each one marked as a Stem.</p>
        )
      )}
    </div>
  );
}
