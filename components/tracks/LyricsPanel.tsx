"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseChordPro, prefersFlats, transposeChord, transposeKey, type SheetLine } from "@/lib/chordpro";

type Group = { n: number; label: string; lines: SheetLine[] };

/** Splits a chart into its sections (n matches sectionsOf numbering; -1 = lines before the first heading). */
function groups(src: string): Group[] {
  const out: Group[] = [{ n: -1, label: "", lines: [] }];
  let n = 0;
  for (const l of parseChordPro(src)) {
    if (l.type === "section") out.push({ n: n++, label: l.label, lines: [] });
    else out[out.length - 1].lines.push(l);
  }
  for (const g of out) while (g.lines.length && g.lines[g.lines.length - 1].type === "empty") g.lines.pop();
  // a repeated section with no lines of its own (e.g. "Chorus" again) uses the first one's lines
  for (const g of out) if (!g.lines.some((l) => l.type === "lyrics")) {
    const first = out.find((o) => o.label.toLowerCase() === g.label.toLowerCase() && o.lines.some((l) => l.type === "lyrics"));
    if (first) g.lines = first.lines;
  }
  return out.filter((g) => g.n >= 0 || g.lines.some((l) => l.type === "lyrics"));
}

/** Rough section starts spread by lyric lines; used until real times are set. */
function guess(gs: Group[], duration: number) {
  const out: Record<number, number> = {};
  const secs = gs.filter((g) => g.n >= 0);
  if (!duration || !secs.length) return out;
  const w = secs.map((g) => Math.max(1, g.lines.filter((l) => l.type === "lyrics").length || 2));
  const total = w.reduce((a, b) => a + b, 0);
  let t = 0;
  secs.forEach((g, i) => {
    out[g.n] = t;
    t += (w[i] / total) * duration;
  });
  return out;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function LyricsPanel({
  chordpro,
  songKey,
  time,
  playing,
  duration,
  pitch,
  markers,
  onJump,
  onMark,
  onMarkingDone,
  onEdit,
}: {
  chordpro: string;
  songKey: string;
  time: number;
  playing: boolean;
  duration: number;
  pitch: number;
  /** Saved section start times (section number → seconds). */
  markers: Record<number, number>;
  onJump: (t: number) => void;
  onMark: (n: number, t: number) => void;
  onMarkingDone: () => void;
  /** Opens the lyrics editor. */
  onEdit: () => void;
}) {
  const gs = useMemo(() => groups(chordpro), [chordpro]);
  const [chords, setChords] = useState(false);
  const [marking, setMarking] = useState(false);
  useEffect(() => {
    try {
      setChords(localStorage.getItem("fw.tracks.chords") === "1");
    } catch {}
  }, []);
  const saved = Object.keys(markers).length > 0;
  const times = useMemo(() => (saved ? markers : guess(gs, duration)), [saved, markers, gs, duration]);
  const timed = gs.filter((g) => g.n >= 0 && times[g.n] != null).sort((a, b) => times[a.n] - times[b.n]);
  let cur: Group | undefined = gs[0]?.n === -1 ? gs[0] : undefined;
  for (const g of timed) if (times[g.n] <= time + 0.05) cur = g;
  const next = cur ? timed[timed.indexOf(cur) + 1] : timed[0];
  const key = transposeKey(songKey, pitch);
  const flats = prefersFlats(key);

  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chips.current?.querySelector<HTMLElement>("[data-on='1']")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [cur?.n]);

  if (!gs.some((g) => g.lines.some((l) => l.type === "lyrics")))
    return (
      <div className="flex flex-col items-center gap-3 border-t border-white/10 bg-[#101016] p-5 text-center text-sm text-white/70">
        <span>This song has no lyrics yet.</span>
        <button onClick={onEdit} className="rounded-full bg-[#9b7bff] px-5 py-2 text-base font-bold text-white">＋ Add lyrics</button>
        <span className="text-xs text-white/40">Paste them, type them, or import a ProPresenter (.pro) file.</span>
      </div>
    );

  function tap(g: Group) {
    if (marking) onMark(g.n, Math.round(time * 10) / 10);
    else if (times[g.n] != null) onJump(times[g.n]);
  }

  return (
    <div className="flex h-[38vh] min-h-[220px] flex-col border-t border-white/10 bg-[#101016] text-white">
      <div className="flex items-center gap-2 px-3 pt-2">
        <div ref={chips} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          {gs.filter((g) => g.n >= 0).map((g) => {
            const on = g === cur;
            const set = marking && markers[g.n] != null;
            return (
              <button
                key={g.n}
                data-on={on ? "1" : "0"}
                onClick={() => tap(g)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${on ? "bg-[#9b7bff] text-white" : marking ? (set ? "bg-emerald-600/70" : "bg-white/15 ring-1 ring-[#f2c94c]") : "bg-white/10 text-white/70"}`}
                title={marking ? "Tap the moment this section starts" : times[g.n] != null ? `Jump to ${fmt(times[g.n])}` : ""}
              >
                {g.label}
              </button>
            );
          })}
        </div>
        <button onClick={onEdit} className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70">
          ✎ Edit lyrics
        </button>
        <button
          onClick={() => {
            const v = !chords;
            setChords(v);
            try {
              localStorage.setItem("fw.tracks.chords", v ? "1" : "0");
            } catch {}
          }}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${chords ? "bg-white text-black" : "bg-white/10 text-white/70"}`}
        >
          Chords
        </button>
        <button
          onClick={() => {
            if (marking) onMarkingDone();
            setMarking(!marking);
          }}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${marking ? "bg-[#f2c94c] text-black" : "bg-white/10 text-white/70"}`}
          title="Play the song and tap each section as it starts, so the lyrics (and the guide's calls) land on time"
        >
          {marking ? "Done" : "Set times"}
        </button>
      </div>
      {marking ? (
        <p className="px-3 text-xs text-[#f2c94c]">{playing ? "Tap each section the moment it starts." : "Press play, then tap each section the moment it starts."}</p>
      ) : (
        !saved && <p className="px-3 text-xs text-white/40">Section times are estimated. Tap “Set times” once to make them exact.</p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-center">
        {cur?.label && <div className="mb-2 text-xs font-bold uppercase tracking-widest text-[#9b7bff]">{cur.label}</div>}
        {(cur?.lines ?? []).map((l, i) =>
          l.type === "lyrics" ? (
            <div key={i} className="mb-1 font-display text-2xl font-bold leading-snug md:text-3xl">
              {chords && l.hasChords ? (
                <span className="inline-flex flex-wrap items-end justify-center">
                  {l.segments.map((s, j) => (
                    <span key={j} className="inline-flex flex-col items-start">
                      <span className="h-5 text-base font-bold text-[#f2c94c]">{s.chord ? transposeChord(s.chord, pitch, flats) : " "}</span>
                      <span className="whitespace-pre">{s.text || " "}</span>
                    </span>
                  ))}
                </span>
              ) : (
                l.segments.map((s) => s.text).join("")
              )}
            </div>
          ) : l.type === "comment" ? (
            <div key={i} className="text-sm italic text-white/50">{l.text}</div>
          ) : l.type === "empty" ? (
            <div key={i} className="h-3" />
          ) : null
        )}
        {next && (
          <div className="mt-4 text-sm text-white/40">
            Next: <b className="uppercase">{next.label}</b>
            {(() => {
              const first = next.lines.find((l) => l.type === "lyrics");
              return first && first.type === "lyrics" ? ` · ${first.segments.map((s) => s.text).join("").trim()}` : "";
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
