"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fileIcon } from "@/lib/media";
import type { Tutorial } from "@/lib/types";

type FileRow = { id: string; song_id: string; name: string; path: string };

/** Every file and tutorial link for the songs in a plan, grouped by song in service order. */
export default function PlanFiles({ planId, songs }: { planId: string; songs: { id: string; title: string }[] }) {
  const supabase = createClient();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [tuts, setTuts] = useState<Record<string, Tutorial[]>>({});
  const ids = songs.map((s) => s.id);
  const key = ids.join();

  useEffect(() => {
    if (!ids.length) return;
    supabase.from("song_files").select("id,song_id,name,path").in("song_id", ids).order("name").then(({ data }) => setFiles((data ?? []) as FileRow[]));
    supabase.from("songs").select("id,tutorials").in("id", ids).then(({ data, error }) => {
      if (error) return;
      const m: Record<string, Tutorial[]> = {};
      for (const r of (data ?? []) as { id: string; tutorials: Tutorial[] | null }[]) m[r.id] = r.tutorials ?? [];
      setTuts(m);
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(f: FileRow) {
    const w = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("charts").createSignedUrl(f.path, 600);
    if (error || !data) {
      w?.close();
      return alert(error?.message ?? "Could not open file");
    }
    if (w) w.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  }

  if (!songs.length) return <p className="text-sm text-muted">No songs in this plan yet.</p>;

  return (
    <div className="space-y-5">
      <Link href={`/plans/${planId}/player`} className="btn">▶ Play</Link>
      {songs.map((s) => {
        const fs = files.filter((f) => f.song_id === s.id);
        const ts = tuts[s.id] ?? [];
        return (
          <section key={s.id}>
            <h3 className="label mb-2">{s.title}</h3>
            <ul className="card divide-y divide-line p-0">
              {fs.map((f) => (
                <li key={f.id}>
                  <button onClick={() => open(f)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50">
                    <span>{fileIcon(f.path)}</span>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  </button>
                </li>
              ))}
              {ts.map((t, i) => (
                <li key={`t${i}`}>
                  <a href={t.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                    <span>🎓</span>
                    <span className="min-w-0 flex-1 truncate">{t.part}: {t.title}</span>
                    <span className="text-xs text-muted">↗</span>
                  </a>
                </li>
              ))}
              {!fs.length && !ts.length && (
                <li className="px-4 py-3 text-sm text-muted">
                  No files yet. <Link href={`/songs/${s.id}`} className="text-accent">Add some</Link>
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
