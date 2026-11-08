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
      {showWords && slide.kind === "sermon" && <SermonSlideView slide={slide} />}
      {showWords && slide.kind !== "title" && slide.kind !== "sermon" && (
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

/** Sermon slides: the church logo with the title, a heading, a bullet point, or a scripture. */
function SermonSlideView({ slide }: { slide: Slide }) {
  const text = slide.lines[0] ?? "";
  const style = slide.sermonStyle ?? "point";
  // Size the words to fill the area: shorter text bigger, long text smaller so it wraps onto more lines.
  const fit = (big: number, area: number) => `min(${Math.min(big, Math.sqrt(area / (Math.max(8, text.length) * 0.62))).toFixed(2)}cqw, ${(big * 1.9).toFixed(2)}cqh)`;
  const shadow = "[text-shadow:0_0.4cqw_1.6cqw_rgba(0,0,0,.65)]";
  const logo = (cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-white.png" alt={CHURCH_NAME} className={cls} />
  );
  if (style === "title")
    return (
      <div key={slide.key} className="fw-title absolute inset-0 flex flex-col items-center justify-center px-[7cqw] text-center">
        {logo("mb-[5cqh] h-[11cqh] w-auto opacity-95")}
        <div className={`font-display font-black uppercase leading-[1.02] tracking-[0.06em] ${shadow}`} style={{ fontSize: fit(7.5, 2600) }}>{text}</div>
        {slide.section && <div className="mt-[3cqh] font-display text-[min(2.4cqw,4.5cqh)] font-semibold uppercase tracking-[0.3em] opacity-80">{slide.section}</div>}
      </div>
    );
  return (
    <div key={slide.key} className="fw-fade absolute inset-0">
      {logo("absolute left-[4cqw] top-[5cqh] h-[7cqh] w-auto opacity-90")}
      <div className={`absolute inset-x-[8cqw] top-[16cqh] bottom-[10cqh] flex flex-col justify-center ${style === "heading" ? "items-center text-center" : "items-start text-left"}`}>
        {style === "scripture" && slide.section && (
          <div className="mb-[3cqh] font-display text-[min(3.4cqw,6cqh)] font-extrabold uppercase tracking-[0.12em] text-[#f2a65a]">{slide.section}</div>
        )}
        {style === "point" && slide.section && (
          <div className="mb-[2.5cqh] font-display text-[min(2.2cqw,4cqh)] font-bold uppercase tracking-[0.2em] text-[#f2a65a]">{slide.section}</div>
        )}
        {style === "heading" ? (
          <>
            <div className={`font-display font-black uppercase leading-[1.05] tracking-[0.04em] ${shadow}`} style={{ fontSize: fit(6.5, 2400) }}>{text}</div>
            <div className="mt-[3cqh] h-[0.7cqh] w-[12cqw] rounded-full bg-[#df6437]" />
          </>
        ) : style === "scripture" ? (
          <div className={`font-display font-semibold leading-snug ${shadow}`} style={{ fontSize: fit(5.2, 2000) }}>{text ? `“${text.replace(/^["“]|["”]$/g, "")}”` : ""}</div>
        ) : (
          <div className="flex items-start gap-[2cqw]">
            <span className="mt-[1.6cqh] h-[2.2cqh] w-[2.2cqh] shrink-0 rounded-full bg-[#df6437]" />
            <div className={`font-display font-bold leading-tight ${shadow}`} style={{ fontSize: fit(5.6, 2000) }}>{text}</div>
          </div>
        )}
      </div>
    </div>
  );
}
