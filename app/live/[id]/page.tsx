"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ChordSheet from "@/components/ChordSheet";
import { prefersFlats, semitonesBetween, transposeKey } from "@/lib/chordpro";
import { fmtDate, fmtTime, planLabel } from "@/lib/format";
import type { Plan, PlanItem, Song } from "@/lib/types";

type Item = PlanItem & { songs: Pick<Song, "chordpro" | "default_key" | "author" | "bpm" | "meter"> | null };

// Full-screen setlist for musicians and vocalists on a phone/tablet/stand.
export default function LiveView() {
  const params = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [shift, setShift] = useState<Record<string, number>>({}); // extra local transpose per item
  const [chords, setChords] = useState(true);
  const [size, setSize] = useState(20);
  const [dark, setDark] = useState(true);
  const [numbers, setNumbers] = useState(false);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("live-prefs") ?? "{}");
      if (typeof s.chords === "boolean") setChords(s.chords);
      if (typeof s.size === "number") setSize(s.size);
      if (typeof s.dark === "boolean") setDark(s.dark);
      if (typeof s.numbers === "boolean") setNumbers(s.numbers);
    } catch {}
    const supabase = createClient();
    supabase.from("plans").select("*").eq("id", params.id).maybeSingle().then(({ data }) => setPlan(data as Plan));
    supabase
      .from("plan_items")
      .select("*, songs(chordpro, default_key, author, bpm, meter)")
      .eq("plan_id", params.id)
      .order("position")
      .then(({ data }) => setItems(((data ?? []) as Item[]).filter((i) => i.kind !== "header")));
  }, [params.id]);

  useEffect(() => {
    try {
      localStorage.setItem("live-prefs", JSON.stringify({ chords, size, dark, numbers }));
    } catch {}
  }, [chords, size, dark, numbers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") setIdx((i) => Math.min(i + 1, items.length - 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  useEffect(() => window.scrollTo(0, 0), [idx]);

  const item = items[idx];
  const baseKey = item?.songs?.default_key ?? null;
  const planKey = item?.song_key || baseKey;
  const extra = item ? shift[item.id] ?? 0 : 0;
  const shownKey = planKey ? transposeKey(planKey, extra) : "";
  const semis = baseKey && planKey ? (semitonesBetween(baseKey, planKey) + extra + 12) % 12 : 0;

  const theme = dark ? "bg-black text-stone-100" : "bg-white text-ink";
  const bar = dark ? "border-stone-800 bg-stone-950" : "border-line bg-stone-50";

  return (
    <div className={`min-h-screen ${theme}`}>
      <header className={`sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm ${bar}`}>
        <Link href={`/plans/${params.id}`} className="opacity-70 hover:opacity-100">✕</Link>
        <span className="truncate font-medium">{plan ? `${planLabel(plan)} · ${fmtDate(plan.service_date, { year: undefined })} ${fmtTime(plan.start_time)}` : "…"}</span>
        <div className="ml-auto flex items-center gap-1">
          <Btn onClick={() => setChords(!chords)} active={chords}>Chords</Btn>
          <Btn onClick={() => setNumbers(!numbers)} active={numbers}>1-4-5</Btn>
          <Btn onClick={() => setSize((s) => Math.max(12, s - 2))}>A−</Btn>
          <Btn onClick={() => setSize((s) => Math.min(40, s + 2))}>A+</Btn>
          <Btn onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</Btn>
        </div>
      </header>

      <nav className={`flex gap-1 overflow-x-auto border-b px-3 py-2 text-sm ${bar}`}>
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setIdx(i)}
            className={`shrink-0 rounded-full px-3 py-1 ${i === idx ? "bg-accent text-white" : "opacity-70 hover:opacity-100"}`}
          >
            {i + 1}. {it.title}
          </button>
        ))}
      </nav>

      {!item ? (
        <p className="p-6 opacity-70">{items.length ? "" : "This plan has no items yet."}</p>
      ) : (
        <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
          <div className="mb-4 flex flex-wrap items-baseline gap-3">
            <h1 className="text-2xl font-bold">{item.title}</h1>
            {item.kind === "song" && shownKey && (
              <span className="flex items-center gap-1 text-sm">
                <button className="rounded px-2 opacity-70 hover:opacity-100" onClick={() => setShift({ ...shift, [item.id]: extra - 1 })}>−</button>
                <span className="rounded bg-accent px-2 py-0.5 font-mono font-semibold text-white">{shownKey}</span>
                <button className="rounded px-2 opacity-70 hover:opacity-100" onClick={() => setShift({ ...shift, [item.id]: extra + 1 })}>+</button>
              </span>
            )}
            {item.songs && (
              <span className="text-sm opacity-60">
                {[item.songs.author, item.songs.bpm && `${item.songs.bpm} bpm`, item.songs.meter].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          {item.description && <p className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{item.description}</p>}
          {item.songs ? (
            <ChordSheet source={item.songs.chordpro} semis={semis} flats={prefersFlats(shownKey)} showChords={chords} fontSize={size} dark={dark} numbersKey={numbers ? item.songs.default_key : null} />
          ) : (
            <p className="opacity-60">{item.duration_min ? `${item.duration_min} min` : ""}</p>
          )}
        </main>
      )}

      <footer className={`fixed inset-x-0 bottom-0 flex border-t ${bar}`}>
        <button className="flex-1 py-4 text-lg disabled:opacity-30" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Prev</button>
        <button className="flex-1 py-4 text-lg disabled:opacity-30" disabled={idx >= items.length - 1} onClick={() => setIdx(idx + 1)}>Next →</button>
      </footer>
    </div>
  );
}

function Btn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`rounded px-2 py-1 ${active ? "bg-accent text-white" : "opacity-70 hover:opacity-100"}`}>
      {children}
    </button>
  );
}
