"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { fmtDate } from "@/lib/format";
import type { Song } from "@/lib/types";
import { proToChart } from "@/lib/propresenter";
import { normKey, readAudioTags } from "@/lib/audioTags";
import { chordsOverLyricsToChordPro, isChordLine, parseChordPro } from "@/lib/chordpro";

/** True when a chart has at least one line of words. */
function hasLyrics(src: string | null | undefined) {
  return !!src && parseChordPro(src).some((l) => l.type === "lyrics" && l.segments.some((x) => x.text.trim()));
}
const AUDIO_RE = /\.(m4a|m4p|mp3|aac|wav|aif|aiff|flac|alac|m4b)$/i;
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
    const audio = files.filter((f) => AUDIO_RE.test(f.name));
    const other = files.filter((f) => !AUDIO_RE.test(f.name));
    const lines: string[] = [];
    // Keep the phone awake: uploads stop if the screen locks.
    let lock: { release: () => Promise<void> } | null = null;
    try {
      lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
    } catch {}
    try {
      if (other.length) lines.push(...(await importLyrics(other)));
      if (audio.length) lines.push(...(await importAudio(audio)));
    } finally {
      lock?.release().catch(() => {});
      setImporting("");
      setReload((n) => n + 1);
    }
    alert(lines.join("\n") || "Nothing to import.");
  }

  /** iTunes / Apple Music (.m4a) and MP3 files: each one finds or creates its song and is added as that song's audio. */
  async function importAudio(files: File[]): Promise<string[]> {
    const supabase = createClient();
    const drm = files.filter((f) => /\.m4p$/i.test(f.name));
    const ok = files.filter((f) => !/\.m4p$/i.test(f.name));
    // fresh list, so songs created by a lyrics import a moment ago are matched too
    const { data: songRows } = await supabase.from("songs").select("id,title,author,bpm,default_key");
    const byTitle = new Map((songRows ?? []).map((r) => [norm(r.title), r as { id: string; title: string; author: string | null; bpm: number | null; default_key: string | null }]));
    let created = 0, attached = 0, skipped = 0;
    const errs: string[] = [];
    for (const [i, f] of ok.entries()) {
      setImporting(`Song ${i + 1} of ${ok.length}…`);
      if (f.size > 50 * 1024 * 1024) {
        errs.push(`${f.name}: over 50 MB`);
        continue;
      }
      const tags = await readAudioTags(f);
      const title = (tags.title || f.name.replace(/\.[^.]+$/, "")).trim();
      const key = normKey(tags.key);
      let song = byTitle.get(norm(title));
      if (!song) {
        const { data, error } = await supabase
          .from("songs")
          .insert({ title, author: tags.artist || null, bpm: tags.bpm || null, default_key: key })
          .select("id,title,author,bpm,default_key")
          .single();
        if (error || !data) {
          errs.push(`${title}: ${error?.message ?? "couldn't create"}`);
          continue;
        }
        song = data;
        byTitle.set(norm(title), data);
        created++;
      } else {
        // fill in what's missing, never overwrite
        const patch: Record<string, unknown> = {};
        if (!song.author && tags.artist) patch.author = tags.artist;
        if (!song.bpm && tags.bpm) patch.bpm = tags.bpm;
        if (!song.default_key && key) patch.default_key = key;
        if (Object.keys(patch).length) await supabase.from("songs").update(patch).eq("id", song.id);
      }
      const name = tags.artist ? `${title} – ${tags.artist}` : title;
      const { data: existing } = await supabase.from("song_files").select("id").eq("song_id", song.id).eq("name", name).limit(1);
      if (existing?.length) {
        skipped++;
        continue;
      }
      const ext = (f.name.split(".").pop() ?? "m4a").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${song.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("charts").upload(path, f, { contentType: f.type || (ext === "mp3" ? "audio/mpeg" : "audio/mp4") });
      if (up.error) {
        errs.push(`${f.name}: ${up.error.message}`);
        continue;
      }
      const { error } = await supabase.from("song_files").insert({ song_id: song.id, name, path });
      if (error) errs.push(`${f.name}: ${error.message}`);
      else attached++;
    }
    return [
      attached && `🎵 Added audio to ${attached} song${attached > 1 ? "s" : ""}${created ? ` (${created} new song${created > 1 ? "s" : ""} created)` : ""}`,
      skipped && `Skipped ${skipped} already uploaded`,
      drm.length && `${drm.length} file${drm.length > 1 ? "s are" : " is"} copy-protected (.m4p) and can't be played outside iTunes: ${drm.slice(0, 3).map((f) => f.name).join(", ")}`,
      errs.length && `Problems: ${errs.slice(0, 4).join("; ")}${errs.length > 4 ? "…" : ""}`,
    ].filter(Boolean) as string[];
  }

  async function importLyrics(files: File[]): Promise<string[]> {
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
    return (
      [
        fill.length && `✓ Added lyrics to ${fill.length} existing song${fill.length > 1 ? "s" : ""}`,
        replace && has.length && `✓ Replaced lyrics on ${has.length}`,
        !replace && has.length && `Skipped ${has.length} that already had lyrics`,
        fresh.length && `✓ Created ${fresh.length} new song${fresh.length > 1 ? "s" : ""}`,
        failed.length && `Couldn't read ${failed.length}: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`,
        errs.length && `Errors: ${errs.slice(0, 3).join("; ")}`,
      ].filter(Boolean) as string[]
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
            <label className={`btn-secondary cursor-pointer ${importing ? "pointer-events-none opacity-60" : ""}`} title="iTunes / Apple Music (.m4a) or MP3 song files. Pick many at once.">
              {importing || "🎵 Add iTunes / MP3 songs"}
              <input type="file" multiple hidden accept=".m4a,.mp3,.aac,.wav,.aif,.aiff,.flac,.m4p,audio/*" onChange={(e) => { importFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <label className={`btn-secondary cursor-pointer ${importing ? "pointer-events-none opacity-60" : ""}`} title="ProPresenter (.pro), ChordPro or text lyrics. Pick many at once.">
              📥 Import lyrics
              <input type="file" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <Link href="/songs/new" className="btn">+ New song</Link>
          </div>
        )}
      </div>
      {me.isLeader && (
        <p className="text-xs text-muted">
          <b>🎵 Add iTunes / MP3 songs:</b> pick your song files (.m4a or .mp3) and each one is matched to its song (or added) with the name, artist, BPM and key filled in, ready to play.
          Use the computer that has iTunes: the files are in <i>Music › iTunes › iTunes Media › Music</i> (Windows) or <i>Music › Music › Media › Music</i> (Mac). iPhone music can&apos;t be picked from a web page.
        </p>
      )}
      {me.isLeader && missing > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>{missing === 1 ? "1 song has" : `${missing} songs have`} no lyrics yet</b>, so {missing === 1 ? "it won't" : "they won't"} show on the lyrics screen or give section cues.{" "}
          <button className="font-semibold underline" onClick={() => setMissingOnly(!missingOnly)}>{missingOnly ? "Show all songs" : "Show which"}</button>
          <div className="mt-1 text-amber-800">Tip: 📥 Import lyrics takes your ProPresenter .pro files (select them all at once).</div>
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
