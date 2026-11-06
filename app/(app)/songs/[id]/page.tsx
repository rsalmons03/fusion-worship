"use client";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import ChordSheet from "@/components/ChordSheet";
import ChartEditor from "@/components/ChartEditor";
import SongFiles from "@/components/SongFiles";
import SongListen from "@/components/SongListen";
import RehearsalPlayer from "@/components/RehearsalPlayer";
import Tutorials from "@/components/Tutorials";
import type { Tutorial } from "@/lib/types";
import { KEYS, keyFromSource, prefersFlats, semitonesBetween, transposeKey } from "@/lib/chordpro";
import { fmtDate } from "@/lib/format";
import type { Song } from "@/lib/types";

const EMPTY: Omit<Song, "id"> = {
  title: "",
  author: "",
  ccli: "",
  default_key: "",
  bpm: null,
  meter: "",
  themes: "",
  chordpro: "",
  reference_url: "",
  notes: "",
  archived: false,
};

const SAMPLE = `{comment: Example — replace with your song}
Verse 1
[G]Here is a [D/F#]line with [Em]chords in [C]brackets

Chorus
[C]Chords go right be[G]fore the syllable
[D]they land on`;

export default function SongPage() {
  const params = useParams<{ id: string }>();
  const isNew = params.id === "new";
  const me = useProfile();
  const canEdit = me.isLeader;
  const router = useRouter();
  const supabase = createClient();
  const [song, setSong] = useState<Omit<Song, "id">>(EMPTY);
  const [pos, setPos] = useState<{ n: number | null; progress: number } | null>(null);
  const [audioPitch, setAudioPitch] = useState(0);
  const [loaded, setLoaded] = useState(isNew);
  const [editing, setEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [viewKey, setViewKey] = useState("");
  const [view, setView] = useState<"chords" | "numbers" | "lyrics">("chords");
  const [hadMt, setHadMt] = useState(false);
  const [hadTut, setHadTut] = useState(false);
  const [filesVersion, setFilesVersion] = useState(0);
  const [history, setHistory] = useState<{ plan_id: string; date: string; key: string | null }[]>([]);

  useEffect(() => {
    if (isNew) return;
    supabase.from("songs").select("*").eq("id", params.id).maybeSingle().then(({ data }) => {
      if (data) {
        const { id: _id, created_at: _c, updated_at: _u, ...rest } = data;
        setSong(rest as Omit<Song, "id">);
        setHadMt("multitracks_url" in rest);
        setHadTut("tutorials" in rest);
        setViewKey(rest.default_key ?? "");
      }
      setLoaded(true);
    });
    supabase
      .from("plan_items")
      .select("plan_id, song_key, plans(service_date)")
      .eq("song_id", params.id)
      .then(({ data }) => {
        const rows = ((data ?? []) as unknown as { plan_id: string; song_key: string | null; plans: { service_date: string } | null }[])
          .map((r) => ({ plan_id: r.plan_id, date: r.plans?.service_date ?? "", key: r.song_key }))
          .sort((a, b) => b.date.localeCompare(a.date));
        setHistory(rows);
      });
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof song>(k: K, v: (typeof song)[K]) => setSong((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!song.title.trim()) return alert("Title is required");
    setSaving(true);
    const payload = {
      ...song,
      title: song.title.trim(),
      default_key: song.default_key || keyFromSource(song.chordpro) || null,
      bpm: song.bpm ? Number(song.bpm) : null,
      updated_at: new Date().toISOString(),
    };
    // Only send the MultiTracks field once the database has it (or when it's filled in).
    // Same for tutorials: drop the field if the database doesn't have it yet and none were added.
    payload.tutorials = (payload.tutorials ?? []).filter((t) => t.url.trim());
    if (!hadTut && !payload.tutorials.length) delete payload.tutorials;
    if (!payload.multitracks_url) {
      if (hadMt) payload.multitracks_url = null;
      else delete payload.multitracks_url;
    }
    if (isNew) {
      const { data, error } = await supabase.from("songs").insert(payload).select("id").single();
      setSaving(false);
      if (error) return alert(error.message);
      router.replace(`/songs/${data.id}`);
    } else {
      const { error } = await supabase.from("songs").update(payload).eq("id", params.id);
      setSaving(false);
      if (error) return alert(error.message);
      setEditing(false);
      setViewKey(payload.default_key ?? "");
    }
  }

  async function saveTutorials(next: Tutorial[]) {
    const { error } = await supabase.from("songs").update({ tutorials: next }).eq("id", params.id);
    if (error) {
      alert(/tutorials/.test(error.message) ? "Tutorials need the database update 006_tutorials.sql. " + error.message : error.message);
      return false;
    }
    set("tutorials", next);
    setHadTut(true);
    return true;
  }

  async function remove() {
    if (history.length && !confirm(`This song is in ${history.length} plan(s). Archive it instead? (OK = archive)`)) return;
    if (history.length) {
      await supabase.from("songs").update({ archived: true }).eq("id", params.id);
    } else {
      if (!confirm("Delete this song?")) return;
      await supabase.from("songs").delete().eq("id", params.id);
    }
    router.push("/songs");
  }

  if (!loaded) return <p className="text-muted">Loading…</p>;

  const semis = (semitonesBetween(song.default_key, viewKey) + audioPitch + 12) % 12;
  const flats = prefersFlats(viewKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/songs" className="text-sm text-muted hover:text-ink print:hidden">← Songs</Link>
          <h1 className="h1">{isNew ? "New song" : song.title}</h1>
          {!isNew && (
            <p className="text-muted">
              {[song.author, song.default_key && `Key ${song.default_key}`, song.bpm && `${song.bpm} bpm`, song.meter, song.ccli && `CCLI ${song.ccli}`]
                .filter(Boolean)
                .join(" · ")}
              {song.archived && " · Archived"}
            </p>
          )}
        </div>
        {canEdit && !editing && (
          <div className="flex gap-2 print:hidden">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            {song.archived ? (
              <button className="btn-secondary" onClick={async () => { await supabase.from("songs").update({ archived: false }).eq("id", params.id); set("archived", false); }}>Unarchive</button>
            ) : (
              <button className="btn-secondary text-bad" onClick={remove}>Delete</button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Title *"><input className="input" value={song.title} onChange={(e) => set("title", e.target.value)} autoFocus /></F>
              <F label="Author / artist"><input className="input" value={song.author ?? ""} onChange={(e) => set("author", e.target.value)} /></F>
              <F label="Original key (chords are written in)">
                <select className="input" value={song.default_key ?? ""} onChange={(e) => set("default_key", e.target.value)}>
                  <option value="">—</option>
                  {[...KEYS, ...KEYS.map((k) => k + "m")].map((k) => <option key={k}>{k}</option>)}
                </select>
              </F>
              <div className="grid grid-cols-2 gap-3">
                <F label="BPM"><input type="number" className="input" value={song.bpm ?? ""} onChange={(e) => set("bpm", e.target.value ? Number(e.target.value) : null)} /></F>
                <F label="Meter"><input className="input" placeholder="4/4" value={song.meter ?? ""} onChange={(e) => set("meter", e.target.value)} /></F>
              </div>
              <F label="CCLI #"><input className="input" value={song.ccli ?? ""} onChange={(e) => set("ccli", e.target.value)} /></F>
              <F label="Themes"><input className="input" placeholder="grace, communion, easter" value={song.themes ?? ""} onChange={(e) => set("themes", e.target.value)} /></F>
              <div className="sm:col-span-2">
                <F label="Listen link (YouTube, Spotify, Apple Music, SoundCloud)"><input className="input" value={song.reference_url ?? ""} onChange={(e) => set("reference_url", e.target.value)} /></F>
              </div>
              <div className="sm:col-span-2">
                <F label="MultiTracks / ChartBuilder link"><input className="input" placeholder="Paste the song's MultiTracks link" value={song.multitracks_url ?? ""} onChange={(e) => set("multitracks_url", e.target.value)} /></F>
              </div>
            </div>
            <div>
              <span className="label">Chart: lyrics &amp; chords</span>
              <ChartEditor value={song.chordpro} onChange={(v) => set("chordpro", v)} songKey={song.default_key} placeholder={SAMPLE} onTitle={(t) => !song.title.trim() && set("title", t)} />
            </div>
            {!isNew && <SongFiles songId={params.id} canEdit={canEdit} onChange={() => setFilesVersion((v) => v + 1)} />}
            {isNew && <p className="text-sm text-muted">Save the song first, then you can upload audio, PDFs and other files.</p>}
            <F label="Arrangement notes"><textarea className="input" rows={2} value={song.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></F>
            <div className="flex gap-2">
              <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save song"}</button>
              <button className="btn-secondary" onClick={() => (isNew ? router.push("/songs") : setEditing(false))}>Cancel</button>
            </div>
          </div>
          <div className="card">
            <div className="label mb-3">Preview</div>
            <ChordSheet source={song.chordpro || SAMPLE} />
          </div>
        </div>
      ) : (
        <>
        {/* On phones the extras sit below the chart, so offer shortcuts to them. */}
        {!isNew && (
          <div className="-mt-2 mb-4 flex flex-wrap gap-2 lg:hidden print:hidden">
            {[
              ["song-tutorials", `🎓 Tutorials${song.tutorials?.length ? ` (${song.tutorials.length})` : ""}`],
              ["song-files", "📁 Files & audio"],
              ["song-listen", "🔗 Listen link"],
            ].map(([id, label]) => (
              <button
                key={id}
                className="rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold"
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {label}
              </button>
            ))}
            {song.multitracks_url && (
              <a href={song.multitracks_url} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold">
                MultiTracks ↗
              </a>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="card min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
              <span className="text-sm text-muted">View in key</span>
              <select className="input w-auto py-1" value={viewKey} onChange={(e) => setViewKey(e.target.value)} disabled={!song.default_key}>
                {!song.default_key && <option value="">Set an original key to transpose</option>}
                {song.default_key && [...new Set([song.default_key, ...KEYS.map((k) => (song.default_key!.endsWith("m") ? k + "m" : k))])].map((k) => <option key={k}>{k}</option>)}
              </select>
              {song.default_key && (
                <>
                  <button className="btn-ghost" onClick={() => setViewKey(transposeKey(viewKey, -1))}>−½</button>
                  <button className="btn-ghost" onClick={() => setViewKey(transposeKey(viewKey, 1))}>+½</button>
                </>
              )}
              <div className="ml-auto flex rounded-sm border border-line bg-white p-0.5 text-xs font-semibold uppercase">
                {(["chords", "numbers", "lyrics"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`rounded-sm px-2 py-1 ${view === v ? "bg-accent text-white" : "text-muted"}`} disabled={v === "numbers" && !song.default_key} title={v === "numbers" && !song.default_key ? "Set the original key first" : ""}>
                    {v === "numbers" ? "1-4-5" : v}
                  </button>
                ))}
              </div>
              <button className="btn-ghost" onClick={() => window.print()}>Print</button>
            </div>
            <RehearsalPlayer key={filesVersion} songId={params.id} chart={song.chordpro} canEdit={canEdit} bpm={song.bpm} meter={song.meter} onPitch={setAudioPitch} onChartCreated={(chordpro) => setSong((s) => ({ ...s, chordpro }))} onPosition={(p) => setPos(p.n === null ? null : { n: p.n, progress: p.progress })} />
            <ChordSheet source={song.chordpro} semis={semis} flats={flats} showChords={view !== "lyrics"} numbersKey={view === "numbers" ? song.default_key : null} follow={pos} />
          </div>
          <aside className="space-y-4">
            {song.multitracks_url && (
              <a href={song.multitracks_url} target="_blank" rel="noreferrer" className="btn w-full">Open in MultiTracks</a>
            )}
            {((song.tutorials?.length ?? 0) > 0 || (canEdit && !isNew)) && (
              <div id="song-tutorials" className="card scroll-mt-24">
                <div className="label mb-2">Tutorials</div>
                <Tutorials items={song.tutorials ?? []} onSave={canEdit ? saveTutorials : undefined} />
              </div>
            )}
            {!isNew && (
              <div id="song-listen" className="card scroll-mt-24">
                <div className="label mb-2">Listen</div>
                <SongListen songId={params.id} referenceUrl={song.reference_url} audio={false} />
                <p className="mt-2 text-xs text-muted">Uploaded MP3s play in the player bar at the bottom of the screen.</p>
              </div>
            )}
            {!isNew && <SongFiles songId={params.id} canEdit={canEdit} onChange={() => setFilesVersion((v) => v + 1)} />}
            {song.notes && <div className="card whitespace-pre-wrap text-sm"><div className="label">Notes</div>{song.notes}</div>}
            <div className="card text-sm">
              <div className="label">Used in {history.length} plan{history.length === 1 ? "" : "s"}</div>
              <ul className="mt-2 space-y-1">
                {history.slice(0, 15).map((h, i) => (
                  <li key={i} className="flex justify-between">
                    <Link href={`/plans/${h.plan_id}`} className="hover:text-accent">{h.date ? fmtDate(h.date, { weekday: undefined }) : "—"}</Link>
                    <span className="font-mono text-muted">{h.key}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
        </>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
