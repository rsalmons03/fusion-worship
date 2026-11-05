"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { embedFor, isAudio } from "@/lib/media";

type Track = { id: string; name: string; url: string };

/** Plays a song's reference link (YouTube, Spotify, Apple Music, SoundCloud) and uploaded audio. */
export default function SongListen({
  songId,
  referenceUrl,
  dark = false,
  showEmptyNote = false,
  audio = true,
}: {
  songId: string;
  referenceUrl?: string | null;
  dark?: boolean;
  showEmptyNote?: boolean;
  /** Also list uploaded audio files (off where the rehearsal player already plays them). */
  audio?: boolean;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loaded, setLoaded] = useState(false);
  const embed = embedFor(referenceUrl);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    (async () => {
      const { data } = await supabase.from("song_files").select("id,name,path").eq("song_id", songId).order("name");
      const files = audio ? (data ?? []).filter((f) => isAudio(f.path)) : [];
      const out: Track[] = [];
      for (const f of files) {
        const { data: s } = await supabase.storage.from("charts").createSignedUrl(f.path, 60 * 60 * 6);
        if (s) out.push({ id: f.id, name: f.name, url: s.signedUrl });
      }
      if (alive) {
        setTracks(out);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [songId, audio]);

  const muted = dark ? "opacity-60" : "text-muted";
  if (loaded && !embed && !tracks.length && !referenceUrl) {
    return showEmptyNote ? <p className={`text-sm ${muted}`}>No audio yet. Add a YouTube/Spotify link or upload an MP3.</p> : null;
  }

  return (
    <div className="space-y-3">
      {embed ? (
        <iframe
          src={embed.src}
          title={`${embed.label} player`}
          height={embed.height}
          className="w-full rounded-md border-0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : (
        referenceUrl && (
          <a href={referenceUrl} target="_blank" rel="noreferrer" className={dark ? "underline" : "text-accent hover:underline"}>
            ▶ Listen (opens in a new tab)
          </a>
        )
      )}
      {tracks.map((t) => (
        <div key={t.id}>
          <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${muted}`}>{t.name}</div>
          <audio controls preload="none" src={t.url} className="w-full" />
        </div>
      ))}
    </div>
  );
}
