"use client";
import { type ScreenState, type Slide } from "@/lib/slides";
import Background from "./Backgrounds";
import { CHURCH_NAME } from "@/lib/format";

/** Kept for older imports: the moving background. */
export function MotionBackground({ bg }: { bg: string }) {
  return <Background bg={bg} />;
}

/** One projector slide. Sizes use container units so it works full-screen and as a small preview. */
export default function SlideView({ slide, state, className = "" }: { slide?: Slide; state: ScreenState; className?: string }) {
  const showWords = !state.black && !state.clear && !state.logo && slide;
  const longest = Math.max(10, ...(slide?.lines ?? []).map((l) => l.length));
  const fit = Math.min(7.2, 165 / longest); // cqw
  const size = slide?.kind === "lyrics" ? `min(${fit}cqw, ${slide.lines.length > 2 ? 13 : 17}cqh)` : `min(${Math.min(6.5, 150 / longest)}cqw, 14cqh)`;
  return (
    <div className={`relative overflow-hidden bg-black text-white ${className}`} style={{ containerType: "size" }}>
      {!state.black && <MotionBackground bg={state.bg} />}
      {!state.black && state.logo && (
        <div key="logo" className="fw-fade absolute inset-0 grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={CHURCH_NAME} className="max-h-[22cqh] max-w-[50cqw] brightness-0 invert" />
        </div>
      )}
      {showWords && slide.kind === "title" && (
        <div key={slide.key} className="fw-title absolute inset-0 flex flex-col items-center justify-center px-[5cqw] text-center">
          <div
            className="font-display font-black uppercase leading-[0.95] tracking-[0.12em] [text-shadow:0_0_2cqw_rgba(255,255,255,.55),0_0.4cqw_2cqw_rgba(0,0,0,.6)]"
            style={{ fontSize: `min(${Math.min(11, 190 / Math.max(6, slide.lines[0].length))}cqw, 24cqh)` }}
          >
            {slide.lines[0]}
          </div>
          {slide.lines[1] && <div className="mt-[3cqh] font-display text-[min(2.6cqw,5cqh)] font-semibold uppercase tracking-[0.3em] opacity-80">{slide.lines[1]}</div>}
        </div>
      )}
      {showWords && slide.kind !== "title" && (
        <div key={slide.key} className="fw-fade absolute inset-0 flex flex-col items-center justify-center px-[6cqw] text-center">
          {slide.lines.map((l, i) => (
            <div
              key={i}
              className={`font-display leading-tight [text-shadow:0_0.4cqw_1.6cqw_rgba(0,0,0,.7)] ${slide.kind === "title" && i > 0 ? "mt-[2cqh] font-normal opacity-80" : "font-bold"}`}
              style={{ fontSize: slide.kind === "title" && i > 0 ? `min(3cqw, 6cqh)` : size }}
            >
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
