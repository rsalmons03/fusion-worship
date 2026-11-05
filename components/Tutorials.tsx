"use client";
import { useEffect, useState } from "react";
import { embedFor } from "@/lib/media";
import type { Tutorial } from "@/lib/types";

export const PARTS = ["Drums", "Bass", "Keys", "Acoustic", "Electric", "Vocals", "Synth / Pads", "Tracks", "Full band", "Other"];
const PART_KEY = "fw.part";

/**
 * Tutorial videos for a song, filtered by instrument; YouTube/Vimeo play inline.
 * With `onSave`, leaders can add and remove links right here (saved immediately).
 */
export default function Tutorials({
  items,
  dark = false,
  onSave,
}: {
  items: Tutorial[];
  dark?: boolean;
  onSave?: (next: Tutorial[]) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Tutorial>({ part: "Drums", title: "", url: "" });
  const [saving, setSaving] = useState(false);
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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!onSave || !draft.url.trim()) return;
    let url = draft.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    setSaving(true);
    const ok = await onSave([...items, { ...draft, url, title: draft.title.trim() || `${draft.part} tutorial` }]);
    setSaving(false);
    if (ok) {
      setDraft({ part: draft.part, title: "", url: "" });
      setAdding(false);
    }
  }

  async function remove(i: number) {
    if (!onSave || !confirm(`Remove "${items[i].title || "this tutorial"}"?`)) return;
    await onSave(items.filter((_, j) => j !== i));
  }

  const addForm = onSave && (
    adding ? (
      <form onSubmit={add} className={`grid gap-2 rounded-md border border-dashed p-3 ${dark ? "border-white/20" : "border-accent/50 bg-accent-soft/40"}`}>
        <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
          <select className="input" value={draft.part} onChange={(e) => setDraft({ ...draft, part: e.target.value })} aria-label="Instrument">
            {PARTS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input className="input" placeholder="Title (e.g. Drum tutorial)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <input className="input" required placeholder="Paste a YouTube, Vimeo or other link" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} inputMode="url" autoFocus />
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Add"}</button>
          <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      </form>
    ) : (
      <button className="btn-secondary w-full" onClick={() => setAdding(true)}>+ Add tutorial link</button>
    )
  );

  if (!items.length)
    return (
      <div className="space-y-3">
        <p className={`text-sm ${muted}`}>No tutorials for this song yet.</p>
        {addForm}
      </div>
    );

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
                {onSave && (
                  <button className="btn-ghost px-1 text-xs text-bad" onClick={() => remove(i)} aria-label="Remove tutorial">✕</button>
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
      {addForm}
    </div>
  );
}
