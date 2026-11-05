"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useScreenSync } from "@/components/screen/useScreenSync";
import { usePlanSlides } from "@/components/screen/usePlanSlides";

// Stage display (confidence monitor) for the band: current and next lines, next section, and a clock.
export default function StagePage() {
  const { id } = useParams<{ id: string }>();
  const { state, online } = useScreenSync(id);
  const { items, slides } = usePlanSlides(id, state.lines);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const cur = slides[state.slide];
  const next = slides[state.slide + 1];
  const item = items.find((i) => i.id === cur?.itemId);
  const nextItem = next && next.itemId !== cur?.itemId ? items.find((i) => i.id === next.itemId) : null;
  // The next section that's different from this one.
  let nextSection = "";
  for (let i = state.slide + 1; i < slides.length && slides[i].itemId === cur?.itemId; i++) {
    if (slides[i].sectionN !== cur?.sectionN) {
      nextSection = slides[i].section ?? "";
      break;
    }
  }
  const screenNote = state.black ? "Screen: BLACK" : state.logo ? "Screen: LOGO" : state.clear ? "Screen: CLEAR" : "";

  return (
    <div className="fixed inset-0 flex flex-col bg-black px-[3vw] py-[2vh] font-display text-white" style={{ cursor: "none" }}>
      <header className="flex items-center gap-4 text-[3vh]">
        <span className="font-mono text-[6vh] font-bold tabular-nums text-amber-300">
          {now?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="flex-1 truncate text-stone-300">{item?.title ?? ""}</span>
        {screenNote && <span className="rounded bg-red-600 px-3 py-1 text-[2.5vh] font-bold">{screenNote}</span>}
        {state.follow && <span className="rounded bg-accent px-3 py-1 text-[2.2vh] font-bold">AUTO</span>}
        <span className={`h-[1.6vh] w-[1.6vh] rounded-full ${online ? "bg-green-500" : "bg-amber-400"}`} />
      </header>

      <main className="flex min-h-0 flex-1 flex-col justify-center">
        {cur?.section && <div className="mb-[1vh] text-[3.5vh] font-bold uppercase tracking-wider text-accent">{cur.section}</div>}
        <div className="space-y-[1vh]">
          {(cur?.lines ?? []).map((l, i) => (
            <div key={i} className="text-[9vh] font-bold leading-tight">{l}</div>
          ))}
        </div>
      </main>

      <footer className="border-t-2 border-stone-700 pt-[2vh]">
        <div className="mb-[1vh] flex items-baseline gap-4 text-[3vh] font-bold uppercase tracking-wider">
          <span className="text-stone-500">Next</span>
          {nextItem ? <span className="text-amber-300">♪ {nextItem.title}</span> : nextSection && <span className="text-amber-300">→ {nextSection}</span>}
        </div>
        <div className="space-y-[0.5vh] text-stone-400">
          {(next?.lines ?? []).map((l, i) => (
            <div key={i} className="truncate text-[5.5vh] font-semibold leading-tight">{l}</div>
          ))}
        </div>
      </footer>
    </div>
  );
}
