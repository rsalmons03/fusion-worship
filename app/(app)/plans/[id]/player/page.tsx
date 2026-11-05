"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import ChordSheet from "@/components/ChordSheet";
import RehearsalPlayer from "@/components/RehearsalPlayer";
import SongListen from "@/components/SongListen";
import Tutorials from "@/components/Tutorials";
import { prefersFlats, semitonesBetween } from "@/lib/chordpro";
import { fileExt, fileIcon, isAudio } from "@/lib/media";
import { fmtDate, planLabel } from "@/lib/format";
import type { Plan, PlanItem, Song } from "@/lib/types";

type SongBits = Pick<Song, "id" | "title" | "author" | "chordpro" | "default_key" | "bpm" | "meter" | "notes" | "reference_url" | "tutorials">;
type Item = PlanItem & { songs: SongBits | null };
type FileRow = { id: string; name: string; path: string };

const TABS = ["Set list", "Chart", "Lyrics", "Tutorials", "Files", "Notes"] as const;
type Tab = (typeof TABS)[number];

// Plays through a service's songs in order, with the chart, lyrics, files and notes for each.
export default function SetPlayerPage() {
  const params = useParams<{ id: string }>();
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [songs, setSongs] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [tab, setTab] = useState<Tab>("Chart");
  const [files, setFiles] = useState<FileRow[]>([]);

  useEffect(() => {
    supabase.from("plans").select("*").eq("id", params.id).maybeSingle().then(({ data }) => setPlan(data as Plan));
    supabase
      .from("plan_items")
      .select("*, songs(*)")
      .eq("plan_id", params.id)
      .order("position")
      .then(({ data }) => setSongs(((data ?? []) as Item[]).filter((i) => i.kind === "song" && i.songs)));
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = songs[idx];
  const song = item?.songs ?? null;

  useEffect(() => {
    setFiles([]);
    if (!song) return;
    supabase.from("song_files").select("id,name,path").eq("song_id", song.id).order("name").then(({ data }) => setFiles(data ?? []));
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function go(i: number, play: boolean) {
    if (i < 0 || i >= songs.length) return;
    setAutoPlay(play);
    setIdx(i);
    window.scrollTo({ top: 0 });
  }

  async function openFile(f: FileRow) {
    const w = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("charts").createSignedUrl(f.path, 600);
    if (error || !data) {
      w?.close();
      return alert(error?.message ?? "Could not open file");
    }
    if (w) w.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  }

  if (!plan) return <p className="text-muted">Loading…</p>;
  if (!songs.length)
    return (
      <p className="text-muted">
        No songs in this plan yet. <Link href={`/plans/${params.id}`} className="text-accent">Back to the plan</Link>
      </p>
    );

  const key = item.song_key || song?.default_key || "";
  const semis = semitonesBetween(song?.default_key, key);
  const groups: [string, FileRow[]][] = [
    ["Charts", files.filter((f) => fileExt(f.path) === "pdf")],
    ["Audio", files.filter((f) => isAudio(f.path))],
    ["ProPresenter", files.filter((f) => fileExt(f.path) === "pro")],
    ["Other", files.filter((f) => !isAudio(f.path) && !["pdf", "pro"].includes(fileExt(f.path)))],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-3 flex items-start gap-3">
        <Link href={`/plans/${params.id}`} className="btn-ghost -ml-2 mt-1" aria-label="Back to plan">←</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-extrabold">{song?.title}</h1>
          <p className="text-sm text-muted">
            {fmtDate(plan.service_date, { weekday: undefined, year: undefined })} · {planLabel(plan)}
            {plan.location_id && ` · ${loc.name(plan.location_id)}`}
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          {key && <div className="rounded-sm bg-accent px-2 py-0.5 font-mono text-sm font-bold text-white">{key}</div>}
          <div className="mt-1">{idx + 1} of {songs.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-[57px] z-10 -mx-4 mb-4 flex overflow-x-auto border-b border-line bg-paper px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-3 py-2.5 font-display text-xs font-bold uppercase tracking-wider ${tab === t ? "border-accent text-ink" : "border-transparent text-muted"}`}
          >
            {t}
            {t === "Files" && files.length > 0 && <span className="ml-1 text-accent">{files.length}</span>}
            {t === "Tutorials" && (song?.tutorials?.length ?? 0) > 0 && <span className="ml-1 text-accent">{song?.tutorials?.length}</span>}
          </button>
        ))}
      </div>

      {/* Roadmap + player (stays mounted across tabs so playback continues) */}
      <div>
        {song && (
          <RehearsalPlayer
            key={song.id + idx}
            songId={song.id}
            chart={song.chordpro}
            canEdit={me.isLeader}
            bpm={song.bpm}
            autoPlay={autoPlay}
            title={`${idx + 1}. ${song.title}`}
            onPrevSong={() => go(idx - 1, false)}
            onNextSong={(playing) => go(idx + 1, playing)}
            hideRoadmap={tab !== "Chart" && tab !== "Lyrics"}
          />
        )}
      </div>

      {tab === "Set list" && (
        <ul className="card divide-y divide-line p-0">
          {songs.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => { go(i, false); setTab("Chart"); }} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 ${i === idx ? "bg-accent-soft" : ""}`}>
                <span className="w-6 text-center font-display font-bold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.songs?.title}</span>
                  <span className="block truncate text-xs text-muted">{[s.songs?.author, s.songs?.bpm && `${s.songs.bpm} bpm`].filter(Boolean).join(" · ")}</span>
                </span>
                {(s.song_key || s.songs?.default_key) && <span className="font-mono text-sm font-bold text-accent">{s.song_key || s.songs?.default_key}</span>}
                {i === idx && <span className="text-accent">♪</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(tab === "Chart" || tab === "Lyrics") && song && (
        <div className="card">
          <div className="mb-3 flex flex-wrap gap-x-4 text-sm text-muted">
            {song.author && <span>{song.author}</span>}
            {song.bpm && <span>Tempo {song.bpm}</span>}
            {song.meter && <span>{song.meter}</span>}
          </div>
          {song.chordpro.trim() ? (
            <ChordSheet source={song.chordpro} semis={semis} flats={prefersFlats(key)} showChords={tab === "Chart"} fontSize={18} />
          ) : (
            <p className="text-sm text-muted">No chart yet. {me.isLeader && <Link href={`/songs/${song.id}`} className="text-accent">Add one</Link>}</p>
          )}
        </div>
      )}

      {tab === "Tutorials" && song && (
        <div className="card">
          <Tutorials
            items={song.tutorials ?? []}
            onSave={
              me.isLeader
                ? async (next) => {
                    const { error } = await supabase.from("songs").update({ tutorials: next }).eq("id", song.id);
                    if (error) {
                      alert(error.message);
                      return false;
                    }
                    setSongs((xs) => xs.map((x) => (x.songs?.id === song.id ? { ...x, songs: { ...x.songs!, tutorials: next } } : x)));
                    return true;
                  }
                : undefined
            }
          />
        </div>
      )}

      {tab === "Files" && (
        <div className="space-y-4">
          {song?.reference_url && (
            <div className="card">
              <div className="label mb-2">Listen link</div>
              <SongListen songId={song.id} referenceUrl={song.reference_url} audio={false} />
            </div>
          )}
          {files.length === 0 && <p className="text-sm text-muted">No files for this song. {me.isLeader && song && <Link href={`/songs/${song.id}`} className="text-accent">Upload some</Link>}</p>}
          {groups.filter(([, fs]) => fs.length).map(([label, fs]) => (
            <section key={label} className="card p-0">
              <div className="border-b border-line bg-stone-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted">{label}</div>
              <ul className="divide-y divide-line">
                {fs.map((f) => (
                  <li key={f.id}>
                    <button onClick={() => openFile(f)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50">
                      <span>{fileIcon(f.path)}</span>
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-muted">Open</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tab === "Notes" && (
        <div className="space-y-4">
          {item.description && <div className="card"><div className="label">For this service</div><p className="whitespace-pre-wrap">{item.description}</p></div>}
          {song?.notes && <div className="card"><div className="label">Arrangement notes</div><p className="whitespace-pre-wrap">{song.notes}</p></div>}
          {plan.notes && <div className="card"><div className="label">Notes for the team</div><p className="whitespace-pre-wrap">{plan.notes}</p></div>}
          {!item.description && !song?.notes && !plan.notes && <p className="text-sm text-muted">No notes.</p>}
        </div>
      )}
    </div>
  );
}
