"use client";
import { analyze, saveAnalysis } from "@/lib/analysis";
import { decodeAudio } from "@/lib/cueVoice";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fileExt, fileIcon, isAudio } from "@/lib/media";

type SongFile = { id: string; name: string; path: string; is_stem?: boolean };

const STEM_WORDS = /\b(click|guide|cues?|drums?|perc(ussion)?|loops?|bass|keys|keyboards?|piano|organ|synth|pads?|acoustic|electric|ag|eg|gtr|guitars?|strings|winds?|vocals?|voice|vox|bgvs?|backing|choir|tracks?|other|instrumental|accompaniment|stem)\b/i;

/** Works out the waveform, tempo and chords for a just-uploaded song and saves them (in the background). */
function analyzeUpload(fileId: string, f: File) {
  setTimeout(async () => {
    try {
      const audio = await decodeAudio(await f.arrayBuffer());
      await saveAnalysis(fileId, analyze(audio));
    } catch {}
  }, 300);
}

/** PDF charts (e.g. exported from MultiTracks ChartBuilder) and audio files attached to a song. */
export default function SongFiles({ songId, canEdit, onChange }: { songId: string; canEdit: boolean; onChange?: () => void }) {
  const supabase = createClient();
  const [files, setFiles] = useState<SongFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [split, setSplit] = useState<{ jobId: string; status: string; started: number } | null>(null);

  // Keep checking a running split until the stems are saved.
  useEffect(() => {
    if (!split || ["done", "failed"].includes(split.status)) return;
    const t = window.setTimeout(async () => {
      const res = await fetch(`/api/stems?job=${split.jobId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSplit(null);
        return alert(body.error ?? "Could not check the split");
      }
      setSplit({ ...split, status: body.status });
      if (body.status === "done") {
        load();
        onChange?.();
        alert(`Done! ${body.saved ?? ""} parts were added as stems. The mixer is in the player at the bottom.`);
      } else if (body.status === "failed") alert(`Splitting failed: ${body.error ?? "unknown error"}`);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [split]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up a split that was still running when the page was left.
  useEffect(() => {
    if (!canEdit) return;
    supabase
      .from("stem_jobs")
      .select("id,status,created_at")
      .eq("song_id", songId)
      .not("status", "in", "(done,failed)")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!error && data?.[0]) setSplit({ jobId: data[0].id, status: data[0].status, started: new Date(data[0].created_at).getTime() });
      });
  }, [songId, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  async function splitFile(f: SongFile) {
    if (!confirm(`Split "${f.name}" into parts (vocals, drums, bass, and the other instruments)?\n\nThis uses the paid splitting service (usually a few cents) and takes about 1–3 minutes. The original stays.`)) return;
    const res = await fetch("/api/stems", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: f.id }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(body.error ?? "Could not start splitting");
    setSplit({ jobId: body.jobId, status: body.status ?? "starting", started: Date.now() });
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("song_files").select("*").eq("song_id", songId).order("name");
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
      const ext = fileExt(f.name).replace(/[^a-z0-9]/g, "") || "bin";
      if (f.size > 50 * 1024 * 1024) {
        alert(`${f.name} is over 50 MB. Try a smaller file.`);
        continue;
      }
      const path = `${songId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("charts").upload(path, f, { contentType: f.type || undefined });
      if (up.error) {
        alert(`${f.name}: ${up.error.message}`);
        continue;
      }
      const name = ext === "pro" ? f.name : f.name.replace(/\.[^.]+$/, "");
      // "Alleluia_Live_Drums_mixed" → treat _ and - as spaces so the part name is recognised
      const stem = isAudio(path) && STEM_WORDS.test(name.replace(/[_-]+/g, " "));
      let { data: row, error } = await supabase.from("song_files").insert({ song_id: songId, name, path, ...(stem ? { is_stem: true } : {}) }).select("id").single();
      if (error && stem) ({ data: row, error } = await supabase.from("song_files").insert({ song_id: songId, name, path }).select("id").single());
      if (error) alert(error.message);
      // Analyse the song now, from the file already on this phone, so it opens instantly for everyone.
      else if (row?.id && isAudio(path)) analyzeUpload(row.id, f);
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

  async function toggleStem(f: SongFile) {
    const { error } = await supabase.from("song_files").update({ is_stem: !f.is_stem }).eq("id", f.id);
    if (error) return alert("Stems need the database update 005_stems.sql. " + error.message);
    load();
    onChange?.();
  }

  async function rename(f: SongFile) {
    const n = prompt("Name (e.g. Chord chart, Lead sheet, Vocal chart)", f.name);
    if (!n?.trim()) return;
    await supabase.from("song_files").update({ name: n.trim() }).eq("id", f.id);
    load();
  }

  if (unavailable)
    return (
      <div className="card border-amber-300 bg-amber-50 text-sm">
        <div className="label">Files</div>
      {split && !["done", "failed"].includes(split.status) && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="flex-1">
            Splitting into stems… {split.status === "importing" ? "saving the parts" : split.status === "processing" ? "working" : "starting"} ({Math.max(0, Math.round((Date.now() - split.started) / 1000))}s, usually 1–3 min). You can leave this page.
          </span>
        </div>
      )}
        <p>File uploads aren&apos;t switched on yet. Run the database update <b>003_charts_trainings.sql</b> in Supabase, then reload.</p>
      </div>
    );
  return (
    <div id="song-files" className="card scroll-mt-24 text-sm">
      <div className="label">Files</div>
      {files.length === 0 && <p className="mt-1 text-muted">None yet.{canEdit && " Upload PDF charts, MP3s, stems, ProPresenter files…"}</p>}
      {canEdit && files.some((f) => isAudio(f.path)) && (
        <p className="mt-1 text-xs text-muted">Tap <b>Stem</b> on each part (Click, Guide, Drums, Bass…) to play them together in the mixer.</p>
      )}
      <ul className="mt-2 space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <button className="flex-1 truncate text-left text-accent hover:underline" onClick={() => open(f)}>{fileIcon(f.path)} {f.name}</button>
            {canEdit && isAudio(f.path) && !f.is_stem && !split && (
              <button className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-bold text-white hover:bg-accent-dark" onClick={() => splitFile(f)} title="Split into vocals, drums, bass and the other instruments">
                ✂ Split into stems
              </button>
            )}
            {isAudio(f.path) && f.is_stem !== undefined && (canEdit ? (
              <button
                className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase ${f.is_stem ? "bg-accent text-white" : "border border-line text-muted"}`}
                onClick={() => toggleStem(f)}
                title="Stems play together in the mixer"
              >
                Stem
              </button>
            ) : f.is_stem ? <span className="text-[10px] font-bold uppercase text-accent">Stem</span> : null)}
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
          {busy ? "Uploading…" : "Upload files"}
          <input type="file" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      )}
    </div>
  );
}
