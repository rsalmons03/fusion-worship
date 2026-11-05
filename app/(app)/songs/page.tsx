"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { fmtDate } from "@/lib/format";
import type { Song } from "@/lib/types";
import { proToChart } from "@/lib/propresenter";
import { chordsOverLyricsToChordPro, isChordLine, parseChordPro } from "@/lib/chordpro";

/** True when a chart has at least one line of words. */
function hasLyrics(src: string | null | undefined) {
  return !!src && parseChordPro(src).some((l) => l.type === "lyrics" && l.segments.some((x) => x.text.trim()));
}
const norm = (t: string) => t.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

type Row = Pick<Song, "id" | "title" | "author" | "default_key" | "bpm" | "themes" | "archived"> & {
  lyrics: boolean;
  lastUsed: string | null;
  uses: number;
};

export default function SongsPage() {
  const me = useProfile();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<"title" | "lastUsed" | "uses">("title");
  const [missingOnly, setMissingOnly] = useState(false);
  const [importing, setImporting] = useState("");
  const [reload, setReload] = useState(0);

  async function importFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setImporting(`Reading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    const parsed: { title: string; chart: string; file: string }[] = [];
    const failed: string[] = [];
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
      try {
        if (/\.pro$/i.test(f.name) || !/\.(txt|cho|chopro|chordpro|crd)$/i.test(f.name)) {
          const res = proToChart(new Uint8Array(await f.arrayBuffer()));
          if (res && hasLyrics(res.chart)) {
            parsed.push({ title: res.title?.trim() || base, chart: res.chart, file: f.name });
            continue;
          }
          if (/\.pro$/i.test(f.name)) {
            failed.push(f.name);
            continue;
          }
        }
        let text = (await f.text()).replace(/\r\n?/g, "\n");
        if (text.split("\n").some((l) => isChordLine(l) && !/\[/.test(l))) text = chordsOverLyricsToChordPro(text);
        const t = text.match(/\{(?:title|t):\s*([^}]+)\}/i)?.[1]?.trim();
        // drop a first line that is just the song title
        const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
        if (norm(firstLine) && (norm(firstLine) === norm(t || base) || norm(firstLine) === norm(base))) text = text.replace(firstLine, "").replace(/^\s+/, "");
        if (hasLyrics(text)) parsed.push({ title: t || base, chart: text.trim(), file: f.name });
        else failed.push(f.name);
      } catch {
        failed.push(f.name);
      }
    }
    const byTitle = new Map(rows.map((r) => [norm(r.title), r]));
    const fresh = parsed.filter((p) => !byTitle.get(norm(p.title)));
    const fill = parsed.filter((p) => byTitle.get(norm(p.title)) && !byTitle.get(norm(p.title))!.lyrics);
    const has = parsed.filter((p) => byTitle.get(norm(p.title))?.lyrics);
    let replace = false;
    if (has.length) {
      replace = confirm(
        `${has.length} song${has.length > 1 ? "s" : ""} already ha${has.length > 1 ? "ve" : "s"} lyrics (${has.slice(0, 4).map((h) => h.title).join(", ")}${has.length > 4 ? "…" : ""}).\n\nOK = replace them with the imported lyrics\nCancel = keep what's there`
      );
    }
    const supabase = createClient();
    let done = 0;
    const errs: string[] = [];
    for (const p of [...fill, ...(replace ? has : [])]) {
      setImporting(`Saving ${++done}…`);
      const { error } = await supabase.from("songs").update({ chordpro: p.chart }).eq("id", byTitle.get(norm(p.title))!.id);
      if (error) errs.push(`${p.title}: ${error.message}`);
    }
    if (fresh.length) {
      setImporting(`Adding ${fresh.length} new song${fresh.length > 1 ? "s" : ""}…`);
      const seen = new Set<string>();
      const uniq = fresh.filter((p) => !seen.has(norm(p.title)) && seen.add(norm(p.title)));
      const { error } = await supabase.from("songs").insert(uniq.map((p) => ({ title: p.title, chordpro: p.chart })));
      if (error) errs.push(error.message);
    }
    setImporting("");
    setReload((n) => n + 1);
    alert(
      [
        fill.length && `✓ Added lyrics to ${fill.length} existing song${fill.length > 1 ? "s" : ""}`,
        replace && has.length && `✓ Replaced lyrics on ${has.length}`,
        !replace && has.length && `Skipped ${has.length} that already had lyrics`,
        fresh.length && `✓ Created ${fresh.length} new song${fresh.length > 1 ? "s" : ""}`,
        failed.length && `Couldn't read ${failed.length}: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`,
        errs.length && `Errors: ${errs.slice(0, 3).join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n") || "Nothing to import."
    );
  }

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("songs").select("id,title,author,default_key,bpm,themes,archived,chordpro").order("title"),
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
        (s.data ?? []).map(({ chordpro, ...x }) => ({ ...x, lyrics: hasLyrics(chordpro), lastUsed: usage.get(x.id)?.last ?? null, uses: usage.get(x.id)?.n ?? 0 }))
      );
    });
  }, [reload]);

  const missing = rows.filter((r) => !r.archived && !r.lyrics).length;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => showArchived || !r.archived)
      .filter((r) => !missingOnly || !r.lyrics)
      .filter((r) => !needle || `${r.title} ${r.author ?? ""} ${r.themes ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === "title" ? a.title.localeCompare(b.title) : sort === "uses" ? b.uses - a.uses : (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "")
      );
  }, [rows, q, showArchived, sort, missingOnly]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Songs</h1>
        <span className="text-sm text-muted">{shown.length} songs</span>
        {me.isLeader && (
          <div className="ml-auto flex flex-wrap gap-2">
            <label className={`btn-secondary cursor-pointer ${importing ? "pointer-events-none opacity-60" : ""}`} title="ProPresenter (.pro), ChordPro or plain-text lyrics. Pick many at once.">
              {importing || "📥 Import songs"}
              <input type="file" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <Link href="/songs/new" className="btn">+ New song</Link>
          </div>
        )}
      </div>
      {me.isLeader && missing > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>{missing === 1 ? "1 song has" : `${missing} songs have`} no lyrics yet</b>, so {missing === 1 ? "it won't" : "they won't"} show on the lyrics screen or give section cues.{" "}
          <button className="font-semibold underline" onClick={() => setMissingOnly(!missingOnly)}>{missingOnly ? "Show all songs" : "Show which"}</button>
          <div className="mt-1 text-amber-800">Tip: tap 📥 Import songs and select all your ProPresenter .pro files at once.</div>
        </div>
      )}
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
                  {!r.lyrics && <span className="ml-2 rounded-sm bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-bad">No lyrics</span>}
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
