"use client";
import { useRef } from "react";
import { chordsInKey, chordsOverLyricsToChordPro, isChordLine } from "@/lib/chordpro";

const SECTIONS = ["Intro", "Verse 1", "Verse 2", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Instrumental", "Outro"];

/** Chord-chart text box with quick buttons for sections and chords, and paste-to-convert. */
export default function ChartEditor({
  value,
  onChange,
  songKey,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  songKey: string | null | undefined;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(text: string, ownLine = false) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    let ins = text;
    if (ownLine) {
      const before = value.slice(0, start);
      ins = (before && !before.endsWith("\n") ? "\n" : "") + (before.trim() ? "\n" : "") + text + "\n";
    }
    const next = value.slice(0, start) + ins + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + ins.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text || !text.split("\n").some((l) => isChordLine(l) && !/\[/.test(l))) return;
    e.preventDefault();
    insert(chordsOverLyricsToChordPro(text));
  }

  const hasChordLines = value.split("\n").some((l) => isChordLine(l) && !/\[/.test(l));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <button key={s} type="button" onClick={() => insert(s, true)} className="rounded-sm border border-line bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide hover:border-accent">
            + {s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted">Tap to add a chord{songKey ? ` (key of ${songKey})` : ""}:</span>
        {chordsInKey(songKey).map((c) => (
          <button key={c} type="button" onClick={() => insert(`[${c}]`)} className="rounded-sm bg-accent-soft px-2 py-1 font-mono text-xs font-semibold text-accent hover:bg-accent hover:text-white">
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const c = prompt("Chord (e.g. Em7, D/F#, Csus)");
            if (c?.trim()) insert(`[${c.trim()}]`);
          }}
          className="rounded-sm border border-dashed border-line px-2 py-1 font-mono text-xs text-muted hover:border-accent"
        >
          other…
        </button>
      </div>
      <textarea
        ref={ref}
        className="input min-h-[360px] font-mono text-[13px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
      />
      {hasChordLines && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm bg-accent-soft px-3 py-2 text-sm">
          <span className="flex-1">This looks like a chart with chords above the lyrics.</span>
          <button type="button" className="btn" onClick={() => onChange(chordsOverLyricsToChordPro(value))}>Convert</button>
        </div>
      )}
      <p className="text-xs text-muted">
        Tip: paste a chord chart from anywhere (chords on the line above the words) and it&apos;s lined up automatically.
        Put the cursor just before a word, then tap a chord.
      </p>
    </div>
  );
}
