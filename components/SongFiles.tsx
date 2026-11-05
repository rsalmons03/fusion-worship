"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AUDIO_EXT, fileExt, isAudio } from "@/lib/media";

type SongFile = { id: string; name: string; path: string };

/** PDF charts (e.g. exported from MultiTracks ChartBuilder) and audio files attached to a song. */
export default function SongFiles({ songId, canEdit, onChange }: { songId: string; canEdit: boolean; onChange?: () => void }) {
  const supabase = createClient();
  const [files, setFiles] = useState<SongFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("song_files").select("id,name,path").eq("song_id", songId).order("name");
    if (error) return setUnavailable(true);
    setFiles(data ?? []);
  }, [songId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    for (const f of Array.from(list)) {
      const ext = fileExt(f.name);
      if (ext !== "pdf" && !AUDIO_EXT.includes(ext)) {
        alert(`${f.name}: upload a PDF chart or an audio file (${AUDIO_EXT.join(", ")}).`);
        continue;
      }
      if (f.size > 50 * 1024 * 1024) {
        alert(`${f.name} is over 50 MB. Try a smaller MP3.`);
        continue;
      }
      const path = `${songId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("charts").upload(path, f, { contentType: f.type || undefined });
      if (up.error) {
        alert(`${f.name}: ${up.error.message}`);
        continue;
      }
      const name = f.name.replace(/\.[^.]+$/, "");
      const { error } = await supabase.from("song_files").insert({ song_id: songId, name, path });
      if (error) alert(error.message);
    }
    setBusy(false);
    load();
    onChange?.();
  }

  async function open(f: SongFile) {
    const w = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("charts").createSignedUrl(f.path, 60 * 10);
    if (error || !data) {
      w?.close();
      return alert(error?.message ?? "Could not open file");
    }
    if (w) w.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  }

  async function remove(f: SongFile) {
    if (!confirm(`Remove ${f.name}?`)) return;
    await supabase.storage.from("charts").remove([f.path]);
    await supabase.from("song_files").delete().eq("id", f.id);
    load();
    onChange?.();
  }

  async function rename(f: SongFile) {
    const n = prompt("Name (e.g. Chord chart, Lead sheet, Vocal chart)", f.name);
    if (!n?.trim()) return;
    await supabase.from("song_files").update({ name: n.trim() }).eq("id", f.id);
    load();
  }

  if (unavailable) return null;
  return (
    <div className="card text-sm">
      <div className="label">Charts &amp; audio files</div>
      {files.length === 0 && <p className="mt-1 text-muted">None yet.{canEdit && " Upload PDF charts (e.g. from ChartBuilder) or MP3s."}</p>}
      <ul className="mt-2 space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <button className="flex-1 truncate text-left text-accent hover:underline" onClick={() => open(f)}>{isAudio(f.path) ? "🎵" : "📄"} {f.name}</button>
            {canEdit && (
              <>
                <button className="btn-ghost text-xs" onClick={() => rename(f)}>Rename</button>
                <button className="btn-ghost text-xs text-bad" onClick={() => remove(f)}>✕</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <label className="btn-secondary mt-3 w-full cursor-pointer">
          {busy ? "Uploading…" : "Upload PDF or MP3"}
          <input type="file" accept="application/pdf,.pdf,audio/*,.mp3,.m4a,.wav,.aac,.ogg" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      )}
    </div>
  );
}
