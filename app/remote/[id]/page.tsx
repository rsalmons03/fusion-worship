"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import SlideView from "@/components/screen/SlideView";
import { useScreenSync } from "@/components/screen/useScreenSync";
import { stepState, usePlanSlides } from "@/components/screen/usePlanSlides";
import { BACKGROUNDS, buildSlides } from "@/lib/slides";
import { fmtDate, planLabel } from "@/lib/format";

// Phone remote for the lyrics screen.
export default function RemotePage() {
  const { id } = useParams<{ id: string }>();
  const { state, set, online } = useScreenSync(id);
  const { plan, items, slides, error } = usePlanSlides(id, state.lines);
  const cur = slides[state.slide];
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.slide]);

  const toggle = (k: "logo" | "clear" | "black") => set((s) => ({ logo: false, clear: false, black: false, [k]: !s[k] }));
  const go = (i: number) => set({ slide: i, logo: false, clear: false, black: false });
  const setLines = (n: number) => {
    // stay on the same song when re-splitting
    const idx = cur ? buildSlides(items, n).findIndex((x) => x.itemId === cur.itemId) : 0;
    set({ lines: n, slide: Math.max(0, idx) });
  };

  const groups = items
    .filter((it) => slides.some((s) => s.itemId === it.id))
    .map((it) => ({ it, list: slides.map((s, i) => ({ s, i })).filter((x) => x.s.itemId === it.id) }));

  return (
    <div className="min-h-screen bg-stone-950 pb-40 text-stone-100">
      <header className="sticky top-0 z-10 border-b border-stone-800 bg-stone-950/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/plans/${id}`} className="opacity-70">✕</Link>
          <span className="flex-1 truncate font-semibold">{plan ? `${planLabel(plan)} · ${fmtDate(plan.service_date, { year: undefined })}` : "…"}</span>
          <span className={`h-2 w-2 rounded-full ${online ? "bg-green-400" : "bg-amber-400"}`} title={online ? "Live" : "Connecting"} />
          <Link href={`/screen/${id}`} target="_blank" className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">Open screen ↗</Link>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Live</div>
            <SlideView slide={cur} state={state} className="aspect-video w-full rounded-md ring-2 ring-red-500" />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Next</div>
            <SlideView slide={slides[state.logo || state.clear || state.black ? state.slide : state.slide + 1]} state={{ ...state, logo: false, clear: false, black: false }} className="aspect-video w-full rounded-md opacity-80" />
          </div>
        </div>
      </header>

      {error && <p className="m-3 rounded bg-red-900/40 p-3 text-sm">{error}</p>}
      {!error && plan && slides.length === 0 && <p className="m-3 text-sm opacity-70">No slides yet. Add songs that have lyrics/charts to this plan.</p>}

      <main className="space-y-4 px-3 pt-3">
        {groups.map(({ it, list }) => (
          <section key={it.id}>
            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-400">{it.title}</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {list.map(({ s, i }) => {
                const on = i === state.slide && !state.logo && !state.clear && !state.black;
                return (
                  <button
                    key={s.key}
                    ref={i === state.slide ? activeRef : undefined}
                    onClick={() => go(i)}
                    className={`rounded-md border px-2 py-1.5 text-left text-xs leading-snug ${on ? "border-red-500 bg-red-500/20" : i === state.slide ? "border-stone-500 bg-stone-800" : "border-stone-800 bg-stone-900"} ${s.kind !== "lyrics" ? "col-span-2" : ""}`}
                  >
                    {s.abbr && <span className="mr-1 rounded bg-accent px-1 text-[10px] font-bold text-white">{s.abbr}</span>}
                    {s.kind === "title" && <span className="mr-1 text-[10px] font-bold uppercase text-stone-400">Title</span>}
                    {s.lines.join(" / ")}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <section className="space-y-2 rounded-lg border border-stone-800 p-3 text-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-stone-400">Background</div>
          <div className="flex flex-wrap gap-2">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                onClick={() => set({ bg: b.id })}
                className={`h-10 w-14 rounded-md text-[10px] font-semibold ring-2 ${state.bg === b.id ? "ring-white" : "ring-transparent"}`}
                style={{ background: b.colors.length ? `linear-gradient(135deg, ${b.colors.join(", ")})` : "#000" }}
              >
                {b.name}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 pt-1">
            Lines per slide
            {[1, 2, 3, 4].map((n) => (
              <button key={n} onClick={() => setLines(n)} className={`h-8 w-8 rounded-full ${state.lines === n ? "bg-white text-black" : "bg-stone-800"}`}>{n}</button>
            ))}
          </label>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-stone-800 bg-stone-950 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <div className="mb-2 grid grid-cols-3 gap-2 text-sm font-semibold">
          {(["logo", "clear", "black"] as const).map((k) => (
            <button key={k} onClick={() => toggle(k)} className={`rounded-md py-2 ${state[k] ? "bg-white text-black" : "bg-stone-800"}`}>
              {k === "logo" ? "Logo" : k === "clear" ? "Clear words" : "Black"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-lg bg-stone-800 py-4 text-lg font-bold" onClick={() => set((s) => stepState(s, -1, slides.length))}>← Back</button>
          <button className="rounded-lg bg-accent py-4 text-lg font-bold" onClick={() => set((s) => stepState(s, 1, slides.length))}>Next →</button>
        </div>
      </footer>
    </div>
  );
}
