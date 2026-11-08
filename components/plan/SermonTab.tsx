"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SlideView from "@/components/screen/SlideView";
import { DEFAULT_SCREEN, type Slide } from "@/lib/slides";
import { deleteSermon, loadSermon, newSermonSlide, pdfLines, saveSermon, slidesFromLines, type Sermon, type SermonSlide } from "@/lib/sermon";

const STYLES: { id: SermonSlide["style"]; name: string }[] = [
  { id: "title", name: "Title" },
  { id: "heading", name: "Heading" },
  { id: "point", name: "Point" },
  { id: "scripture", name: "Scripture" },
];

/** Plain text / pasted notes → the same line format the PDF reader produces. */
function linesFromText(text: string) {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => {
      const heading = i > 0 && (/:$/.test(t) || (t === t.toUpperCase() && /[A-Z]/.test(t) && t.length < 60));
      return { text: t.replace(/:$/, ""), size: i === 0 ? 20 : heading ? 14 : 11, x: 0, bold: heading };
    });
}

const toSlide = (s: SermonSlide): Slide => ({ key: `sermon:${s.id}`, itemId: "sermon", kind: "sermon", sermonStyle: s.style, lines: [s.text].filter(Boolean), section: s.label });

export default function SermonTab({ planId, canEdit }: { planId: string; canEdit: boolean }) {
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(true);
  const [paste, setPaste] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loadSermon(planId).then((s) => {
      setSermon(s);
      setLoaded(true);
    });
  }, [planId]);

  // Save a moment after each change.
  function update(next: Sermon) {
    setSermon(next);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        await saveSermon(planId, next);
        setSaved(true);
      } catch (e) {
        alert("Couldn't save the sermon: " + (e as Error).message);
      }
    }, 700);
  }
  const setSlides = (slides: SermonSlide[]) => sermon && update({ ...sermon, slides });
  const edit = (i: number, patch: Partial<SermonSlide>) => sermon && setSlides(sermon.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function upload(file?: File) {
    if (!file) return;
    if (sermon?.slides.length && !confirm("Replace the current sermon slides with this file?")) return;
    setBusy("Reading the PDF…");
    try {
      const made = /\.pdf$/i.test(file.name) || file.type === "application/pdf" ? slidesFromLines(await pdfLines(file)) : slidesFromLines(linesFromText(await file.text()));
      if (!made.slides.length) throw new Error("Couldn't find any text in that file. If it's a scanned image, paste your notes instead.");
      update({ ...made, file: file.name });
      setSel(0);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function fromPaste() {
    if (!paste?.trim()) return;
    const made = slidesFromLines(linesFromText(paste));
    update({ ...made, file: "pasted notes" });
    setPaste(null);
    setSel(0);
  }

  function move(i: number, d: number) {
    if (!sermon) return;
    const j = i + d;
    if (j < 0 || j >= sermon.slides.length) return;
    const s = [...sermon.slides];
    [s[i], s[j]] = [s[j], s[i]];
    setSlides(s);
    setSel(j);
  }

  if (!loaded) return <p className="text-sm text-muted">Loading…</p>;
  const cur = sermon?.slides[sel];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <label className={`btn cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy || (sermon ? "📄 Upload a new sermon PDF" : "📄 Upload sermon PDF")}
            <input type="file" accept=".pdf,application/pdf,.txt,text/plain" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        )}
        {canEdit && <button className="btn-secondary" onClick={() => setPaste(paste === null ? "" : null)}>📝 Paste notes</button>}
        {sermon?.slides.length ? <Link href={`/remote/${planId}`} className="btn-secondary">🖥 Show on big screen</Link> : null}
        {sermon && <span className="text-xs text-muted">{saved ? "✓ Saved" : "Saving…"}{sermon.file ? ` · from ${sermon.file}` : ""}</span>}
      </div>

      {paste !== null && (
        <div className="card space-y-2">
          <p className="text-sm text-muted">Paste your sermon outline. First line = title; lines ending in “:” or in CAPITALS = headings; each other line (or bullet) = one slide; Bible references (e.g. John 3:16) become scripture slides.</p>
          <textarea className="input min-h-[10rem] font-mono text-sm" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Living Hope\nPOINT ONE:\n• God sees you\n• John 3:16 For God so loved the world…"} />
          <button className="btn" onClick={fromPaste}>Make slides</button>
        </div>
      )}

      {!sermon?.slides.length ? (
        <div className="card text-sm text-muted">
          Upload your sermon PDF and each bullet point becomes a slide on the big screen with the Fusion Church logo. The title, headings and scriptures get their own slides. You can edit everything after.
          The slides show right after the <b>Sermon</b> (or “Message”) item in the order, or at the end if there isn&apos;t one.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-2">
            {cur && <SlideView slide={toSlide(cur)} state={{ ...DEFAULT_SCREEN, logo: false, bg: "bokeh:ember" }} className="aspect-video w-full rounded-lg shadow" />}
            {canEdit && cur && (
              <div className="card space-y-2 text-sm">
                <div className="flex flex-wrap gap-1">
                  {STYLES.map((st) => (
                    <button key={st.id} onClick={() => edit(sel, { style: st.id })} className={`rounded-full px-3 py-1 text-xs font-semibold ${cur.style === st.id ? "bg-ink text-white" : "border border-line"}`}>{st.name}</button>
                  ))}
                </div>
                <input
                  className="input"
                  placeholder={cur.style === "scripture" ? "Reference, e.g. John 3:16" : cur.style === "title" ? "Speaker (optional)" : "Small label above (optional)"}
                  value={cur.label ?? ""}
                  onChange={(e) => edit(sel, { label: e.target.value || undefined })}
                />
                <textarea className="input min-h-[6rem]" value={cur.text} onChange={(e) => edit(sel, { text: e.target.value })} placeholder="Text on the slide" />
              </div>
            )}
          </div>
          <ol className="space-y-1">
            {sermon.slides.map((s, i) => (
              <li key={s.id} className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm ${i === sel ? "border-accent bg-accent-soft" : "border-line bg-white"}`}>
                <button className="flex-1 text-left" onClick={() => setSel(i)}>
                  <span className="mr-1.5 rounded bg-stone-100 px-1 text-[10px] font-bold uppercase text-muted">{s.style}</span>
                  {s.label && <span className="mr-1 text-xs font-semibold text-accent">{s.label}</span>}
                  <span className="line-clamp-2">{s.text || <i className="text-muted">(empty)</i>}</span>
                </button>
                {canEdit && (
                  <span className="flex shrink-0 gap-0.5 text-xs">
                    <button className="px-1 opacity-60 hover:opacity-100" onClick={() => move(i, -1)} aria-label="Up">↑</button>
                    <button className="px-1 opacity-60 hover:opacity-100" onClick={() => move(i, 1)} aria-label="Down">↓</button>
                    <button className="px-1 text-bad opacity-60 hover:opacity-100" onClick={() => { setSlides(sermon.slides.filter((_, j) => j !== i)); setSel(Math.max(0, Math.min(sel, sermon.slides.length - 2))); }} aria-label="Delete">✕</button>
                  </span>
                )}
              </li>
            ))}
            {canEdit && (
              <li className="flex gap-2 pt-1">
                <button className="btn-ghost" onClick={() => { const s = [...sermon.slides]; s.splice(sel + 1, 0, newSermonSlide("point")); setSlides(s); setSel(sel + 1); }}>+ Point</button>
                <button className="btn-ghost" onClick={() => { const s = [...sermon.slides]; s.splice(sel + 1, 0, newSermonSlide("scripture")); setSlides(s); setSel(sel + 1); }}>+ Scripture</button>
                <button className="btn-ghost text-bad" onClick={async () => { if (confirm("Remove all sermon slides for this service?")) { await deleteSermon(planId); setSermon(null); } }}>Remove sermon</button>
              </li>
            )}
          </ol>
        </div>
      )}
    </div>
  );
}
