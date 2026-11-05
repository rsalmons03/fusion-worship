"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { fmtDate } from "@/lib/format";
import type { Song } from "@/lib/types";

type Row = Pick<Song, "id" | "title" | "author" | "default_key" | "bpm" | "themes" | "archived"> & {
  lastUsed: string | null;
  uses: number;
};

export default function SongsPage() {
  const me = useProfile();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<"title" | "lastUsed" | "uses">("title");

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("songs").select("id,title,author,default_key,bpm,themes,archived").order("title"),
      supabase.from("plan_items").select("song_id, plans(service_date)").not("song_id", "is", null),
    ]).then(([s, u]) => {
      const usage = new Map<string, { last: string | null; n: number }>();
      for (const r of (u.data ?? []) as unknown as { song_id: string; plans: { service_date: string } | null }[]) {
        const d = r.plans?.service_date ?? null;
        const cur = usage.get(r.song_id) ?? { last: null, n: 0 };
        cur.n++;
        if (d && (!cur.last || d > cur.last)) cur.last = d;
        usage.set(r.song_id, cur);
      }
      setRows(
        (s.data ?? []).map((x) => ({ ...x, lastUsed: usage.get(x.id)?.last ?? null, uses: usage.get(x.id)?.n ?? 0 }))
      );
    });
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => showArchived || !r.archived)
      .filter((r) => !needle || `${r.title} ${r.author ?? ""} ${r.themes ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === "title" ? a.title.localeCompare(b.title) : sort === "uses" ? b.uses - a.uses : (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "")
      );
  }, [rows, q, showArchived, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Songs</h1>
        <span className="text-sm text-muted">{shown.length} songs</span>
        {me.isLeader && <Link href="/songs/new" className="btn ml-auto">+ New song</Link>}
      </div>
      <div className="flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Search title, author, theme…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="title">Sort: Title</option>
          <option value="lastUsed">Sort: Recently used</option>
          <option value="uses">Sort: Most used</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Key</th>
              <th className="hidden px-4 py-2 sm:table-cell">BPM</th>
              <th className="hidden px-4 py-2 md:table-cell">Themes</th>
              <th className="px-4 py-2">Last used</th>
              <th className="hidden px-4 py-2 text-right sm:table-cell">Times</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r) => (
              <tr key={r.id} className={`hover:bg-stone-50 ${r.archived ? "opacity-50" : ""}`}>
                <td className="px-4 py-2">
                  <Link href={`/songs/${r.id}`} className="font-medium hover:text-accent">{r.title}</Link>
                  {r.author && <div className="text-xs text-muted">{r.author}</div>}
                </td>
                <td className="px-4 py-2 font-mono">{r.default_key}</td>
                <td className="hidden px-4 py-2 sm:table-cell">{r.bpm}</td>
                <td className="hidden px-4 py-2 text-muted md:table-cell">{r.themes}</td>
                <td className="px-4 py-2 text-muted">{r.lastUsed ? fmtDate(r.lastUsed, { weekday: undefined }) : "Never"}</td>
                <td className="hidden px-4 py-2 text-right sm:table-cell">{r.uses}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No songs found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
