import { parseChordPro, toNumber, transposeChord } from "@/lib/chordpro";

export default function ChordSheet({
  source,
  semis = 0,
  flats = false,
  showChords = true,
  fontSize = 16,
  dark = false,
  numbersKey = null,
}: {
  source: string;
  semis?: number;
  flats?: boolean;
  showChords?: boolean;
  fontSize?: number;
  dark?: boolean;
  /** When set, chords are shown as Nashville numbers relative to this (original) key. */
  numbersKey?: string | null;
}) {
  const lines = parseChordPro(source);
  if (!lines.length) return <p className="text-sm italic opacity-60">No lyrics or chords yet.</p>;
  const chordColor = dark ? "text-amber-300" : "text-accent";
  return (
    <div style={{ fontSize }} className="leading-snug">
      {lines.map((l, i) => {
        if (l.type === "empty") return <div key={i} className="h-[0.9em]" />;
        if (l.type === "section")
          return (
            <div key={i} className="mt-2 mb-1 text-[0.8em] font-bold uppercase tracking-wider opacity-70">
              {l.label}
            </div>
          );
        if (l.type === "comment")
          return (
            <div key={i} className="my-1 text-[0.85em] italic opacity-70">
              {l.text}
            </div>
          );
        const withChords = showChords && l.hasChords;
        return (
          <div key={i} className="flex flex-wrap items-end">
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
      })}
    </div>
  );
}
