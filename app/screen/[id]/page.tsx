"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SlideView from "@/components/screen/SlideView";
import { useScreenSync } from "@/components/screen/useScreenSync";
import { stepState, usePlanSlides } from "@/components/screen/usePlanSlides";

// The projector / TV output. Open it on the computer connected to the screen, then drive it from a phone (Remote) or the keyboard.
export default function ScreenPage() {
  const { id } = useParams<{ id: string }>();
  const { state, set, online } = useScreenSync(id);
  const { slides, error } = usePlanSlides(id, state.lines);
  const [hint, setHint] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const poke = () => {
    setHint(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHint(false), 3500);
  };
  useEffect(() => {
    poke();
    return () => clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowright", "arrowdown", "pagedown", " ", "enter"].includes(k)) set((s) => stepState(s, 1, slides.length));
      else if (["arrowleft", "arrowup", "pageup", "backspace"].includes(k)) set((s) => stepState(s, -1, slides.length));
      else if (k === "b" || k === ".") set((s) => ({ black: !s.black }));
      else if (k === "c") set((s) => ({ clear: !s.clear }));
      else if (k === "l") set((s) => ({ logo: !s.logo }));
      else if (k === "f") document.documentElement.requestFullscreen?.();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set, slides.length]);

  return (
    <div className={`fixed inset-0 bg-black ${hint ? "" : "cursor-none"}`} onMouseMove={poke}>
      <SlideView slide={slides[state.slide]} state={state} className="h-full w-full" />
      <div
        className={`absolute inset-x-0 top-0 flex flex-wrap items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-8 pt-3 text-sm text-white transition-opacity duration-500 ${hint ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <button className="rounded-full bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25" onClick={() => document.documentElement.requestFullscreen?.()}>⛶ Full screen</button>
        <span className="opacity-80">
          <span className={`mr-1 inline-block h-2 w-2 rounded-full ${online ? "bg-green-400" : "bg-amber-400"}`} />
          {online ? "Remote connected" : "Connecting…"} · open <b>Remote</b> on your phone, or use ← → · B black · C clear · L logo
        </span>
        {error && <span className="text-red-300">{error}</span>}
        {!error && slides.length === 0 && <span className="text-amber-200">No slides yet: add songs with charts to this plan.</span>}
      </div>
      {/* Tap left/right side to go back/forward (handy on a tablet). */}
      <button aria-label="Previous" className="absolute inset-y-0 left-0 w-1/4 cursor-[inherit]" onClick={() => set((s) => stepState(s, -1, slides.length))} />
      <button aria-label="Next" className="absolute inset-y-0 right-0 w-1/4 cursor-[inherit]" onClick={() => set((s) => stepState(s, 1, slides.length))} />
    </div>
  );
}
