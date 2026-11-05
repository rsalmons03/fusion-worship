"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SongFile = { id: string; name: string; path: string };

/** PDF charts (e.g. exported from MultiTracks ChartBuilder) attached to a song. */
export default function SongFiles({ songId, canEdit }: { songId: string; canEdit: boolean }) {
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
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
        alert(`${f.name} isn't a PDF.`);
        continue;
      }
      const path = `${songId}/${crypto.randomUUID()}.pdf`;
      const up = await supabase.storage.from("charts").upload(path, f, { contentType: "application/pdf" });
      if (up.error) {
        alert(`${f.name}: ${up.error.message}`);
        continue;
      }
      const name = f.name.replace(/\.pdf$/i, "");
      const { error } = await supabase.from("song_files").insert({ song_id: songId, name, path });
      if (error) alert(error.message);
    }
    setBusy(false);
    load();
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
      <div className="label">PDF charts</div>
      {files.length === 0 && <p className="mt-1 text-muted">None yet.{canEdit && " Upload charts exported from ChartBuilder."}</p>}
      <ul className="mt-2 space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <button className="flex-1 truncate text-left text-accent hover:underline" onClick={() => open(f)}>📄 {f.name}</button>
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
          {busy ? "Uploading…" : "Upload PDF"}
          <input type="file" accept="application/pdf,.pdf" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      )}
    </div>
  );
}
