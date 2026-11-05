"use client";
import { useEffect, useState } from "react";
import { embedFor } from "@/lib/media";
import type { Tutorial } from "@/lib/types";

export const PARTS = ["Drums", "Bass", "Keys", "Acoustic", "Electric", "Vocals", "Synth / Pads", "Tracks", "Full band", "Other"];
const PART_KEY = "fw.part";

/** Tutorial videos for a song, filtered by instrument; YouTube etc. play inline. */
export default function Tutorials({ items, dark = false }: { items: Tutorial[]; dark?: boolean }) {
  const [part, setPart] = useState<string>("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  useEffect(() => {
    try {
      setPart(localStorage.getItem(PART_KEY) ?? "");
    } catch {}
  }, []);
  const choose = (p: string) => {
    setPart(p);
    setOpenIdx(null);
    try {
      if (p) localStorage.setItem(PART_KEY, p);
      else localStorage.removeItem(PART_KEY);
    } catch {}
  };

  const parts = [...new Set(items.map((t) => t.part || "Other"))];
  const shown = items.map((t, i) => ({ t, i })).filter(({ t }) => !part || !parts.includes(part) || (t.part || "Other") === part);
  const muted = dark ? "opacity-60" : "text-muted";

  if (!items.length) return <p className={`text-sm ${muted}`}>No tutorials for this song yet.</p>;

  return (
    <div className="space-y-3">
      {parts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {["", ...parts].map((p) => (
            <button
              key={p || "all"}
              onClick={() => choose(p)}
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                (part === p || (!parts.includes(part) && !p)) ? "bg-accent text-white" : dark ? "bg-white/10" : "bg-stone-100 text-muted"
              }`}
            >
              {p || "All"}
            </button>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {shown.map(({ t, i }) => {
          const embed = embedFor(t.url);
          const isOpen = openIdx === i;
          return (
            <li key={i} className={`rounded-md border ${dark ? "border-white/15" : "border-line"} p-3`}>
              <div className="flex items-center gap-2">
                <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">{t.part || "Other"}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{t.title || "Tutorial"}</span>
                {embed ? (
                  <button className="btn-secondary py-1 text-xs" onClick={() => setOpenIdx(isOpen ? null : i)}>{isOpen ? "Close" : "▶ Watch"}</button>
                ) : (
                  <a className="btn-secondary py-1 text-xs" href={t.url} target="_blank" rel="noreferrer">Open ↗</a>
                )}
              </div>
              {isOpen && embed && (
                <iframe
                  src={embed.src}
                  title={t.title || "Tutorial"}
                  className="mt-3 aspect-video w-full rounded-md border-0"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Add / edit / remove tutorial links while editing a song. */
export function TutorialsEditor({ items, onChange }: { items: Tutorial[]; onChange: (t: Tutorial[]) => void }) {
  const set = (i: number, patch: Partial<Tutorial>) => onChange(items.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      {items.map((t, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[8rem_1fr_auto]">
          <select className="input" value={t.part} onChange={(e) => set(i, { part: e.target.value })} aria-label="Instrument">
            {PARTS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <div className="grid gap-2">
            <input className="input" placeholder="Title (e.g. Drum tutorial – Jordan's groove)" value={t.title} onChange={(e) => set(i, { title: e.target.value })} />
            <input className="input" placeholder="YouTube / Vimeo / MultiTracks link" value={t.url} onChange={(e) => set(i, { url: e.target.value })} />
          </div>
          <button type="button" className="btn-ghost text-bad" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove tutorial">✕</button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange([...items, { part: "Drums", title: "", url: "" }])}>+ Add tutorial link</button>
    </div>
  );
}
