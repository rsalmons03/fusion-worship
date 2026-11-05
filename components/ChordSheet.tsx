"use client";
import { useEffect, useMemo, useRef } from "react";
import { parseChordPro, toNumber, transposeChord, type SheetLine } from "@/lib/chordpro";

export default function ChordSheet({
  source,
  semis = 0,
  flats = false,
  showChords = true,
  fontSize = 16,
  dark = false,
  numbersKey = null,
  follow = null,
}: {
  source: string;
  semis?: number;
  flats?: boolean;
  showChords?: boolean;
  fontSize?: number;
  dark?: boolean;
  /** When set, chords are shown as Nashville numbers relative to this (original) key. */
  numbersKey?: string | null;
  /** While a track plays: the section playing (null = before the first) and how far through it (0–1). Highlights and scrolls along. */
  follow?: { n: number | null; progress: number } | null;
}) {
  const lines = useMemo(() => parseChordPro(source), [source]);
  // Section number for each line, the lyric lines of each section, and, for a repeat like a bare "Chorus", the words to borrow.
  const { secOf, lyricIdx, counts, borrow } = useMemo(() => {
    const secOf: number[] = [];
    const lyricIdx: number[] = [];
    const counts: number[] = [];
    const labels: string[] = [];
    const first = new Map<string, SheetLine[]>();
    let cur = -1;
    let bucket: SheetLine[] = [];
    lines.forEach((l, i) => {
      if (l.type === "section") {
        cur++;
        labels[cur] = l.label.toLowerCase().replace(/[^a-z0-9]/g, "");
        counts[cur] = 0;
        bucket = [];
        if (!first.has(labels[cur])) first.set(labels[cur], bucket);
      } else if (l.type === "lyrics" && cur >= 0 && l.segments.some((x) => x.text.trim())) {
        lyricIdx[i] = counts[cur]++;
        bucket.push(l);
      }
      secOf[i] = cur;
    });
    const borrow: Record<number, SheetLine[]> = {};
    labels.forEach((lab, n) => {
      if (!counts[n]) {
        const b = first.get(lab);
        if (b?.length) borrow[n] = b;
      }
    });
    return { secOf, lyricIdx, counts, borrow };
  }, [lines]);

  const activeN = follow ? follow.n : null;
  const activeLine = follow && activeN !== null ? Math.floor(follow.progress * (counts[activeN] || borrow[activeN]?.length || 1)) : -1;
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && activeN !== null) activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeN, activeLine]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lines.length) return <p className="text-sm italic opacity-60">No lyrics or chords yet.</p>;
  const chordColor = dark ? "text-amber-300" : "text-accent";
  const following = !!follow && activeN !== null;
  const hiLine = dark ? "bg-amber-300/15 rounded" : "bg-accent-soft rounded";
  let sec = 0;

  const lyricRow = (l: Extract<SheetLine, { type: "lyrics" }>, key: string | number, on: boolean) => {
    const withChords = showChords && l.hasChords;
    return (
      <div key={key} ref={on ? activeRef : undefined} className={`-mx-1 flex flex-wrap items-end px-1 transition-colors ${on ? `${hiLine} font-bold` : ""}`}>
        {l.segments.map((s, j) => (
          <span key={j} className="inline-flex flex-col whitespace-pre">
            {withChords && (
              <span className={`font-mono text-[0.85em] font-semibold ${chordColor} pr-1`}>
                {s.chord ? (numbersKey ? toNumber(s.chord, numbersKey) : transposeChord(s.chord, semis, flats)) : " "}
              </span>
            )}
            <span>{s.text || (withChords ? " " : "")}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div style={{ fontSize }} className="leading-snug">
      {lines.map((l, i) => {
        const dim = following && secOf[i] !== activeN ? "opacity-40" : "";
        if (l.type === "empty") return <div key={i} className="h-[0.9em]" />;
        if (l.type === "section") {
          const n = sec++;
          const on = following && n === activeN;
          return (
            <div key={i}>
              <div
                id={`sec-${n}`}
                ref={on && !counts[n] && !borrow[n] ? activeRef : undefined}
                className={`scroll-mt-24 mt-2 mb-1 text-[0.8em] font-bold uppercase tracking-wider transition-opacity ${on ? "text-accent opacity-100" : `opacity-70 ${dim}`}`}
              >
                {on && "▶ "}
                {l.label}
              </div>
              {/* A repeat with no words of its own: show the words while it plays. */}
              {on && !counts[n] && borrow[n] && <div>{borrow[n].map((b, k) => b.type === "lyrics" && lyricRow(b, `b${k}`, k === activeLine))}</div>}
            </div>
          );
        }
        if (l.type === "comment")
          return (
            <div key={i} className={`my-1 text-[0.85em] italic opacity-70 ${dim}`}>
              {l.text}
            </div>
          );
        const on = following && secOf[i] === activeN && lyricIdx[i] === activeLine;
        return <div key={i} className={`transition-opacity ${dim}`}>{lyricRow(l, i, on)}</div>;
      })}
    </div>
  );
}
