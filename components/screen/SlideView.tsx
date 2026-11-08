"use client";
import { type ScreenState, type Slide } from "@/lib/slides";
import Background, { useSignedUrl } from "./Backgrounds";
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
      {showWords && slide.kind === "sermon" && (slide.sermonTheme?.style === "series" ? <SeriesSlide slide={slide} /> : <SermonSlideView slide={slide} />)}
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
        {style === "scripture" && slide.section && !text && (
          <div className={`self-center text-center font-display font-black uppercase tracking-[0.06em] ${shadow}`} style={{ fontSize: "min(7cqw, 14cqh)" }}>
            {slide.section}
            <div className="mx-auto mt-[3cqh] h-[0.7cqh] w-[12cqw] rounded-full bg-[#df6437]" />
          </div>
        )}
        {style === "scripture" && slide.section && text && (
          <div className="mb-[3cqh] font-display text-[min(3.4cqw,6cqh)] font-extrabold uppercase tracking-[0.12em] text-[#f2a65a]">{slide.section}</div>
        )}
        {style === "point" && slide.section && (
          <div className="mb-[2.5cqh] font-display text-[min(2.2cqw,4cqh)] font-bold uppercase tracking-[0.2em] text-[#f2a65a]">{slide.section}</div>
        )}
        {style === "heading" ? (
          <>
            {slide.section && <div className="mb-[2.5cqh] font-display text-[min(2.6cqw,5cqh)] font-bold uppercase tracking-[0.3em] text-[#f2a65a]">{slide.section}</div>}
            <div className={`font-display font-black uppercase leading-[1.05] tracking-[0.04em] ${shadow}`} style={{ fontSize: fit(6.5, 2400) }}>{text}</div>
            <div className="mt-[3cqh] h-[0.7cqh] w-[12cqw] rounded-full bg-[#df6437]" />
          </>
        ) : style === "scripture" ? (
          <div className={`font-display font-semibold leading-snug ${shadow}`} style={{ fontSize: fit(5.2, 2000) }}>{text ? `“${text.replace(/^["“]|["”]$/g, "")}”` : ""}</div>
        ) : (
          <div className="flex items-start gap-[2cqw]">
            <span className="mt-[1.6cqh] h-[2.2cqh] w-[2.2cqh] shrink-0 rounded-full bg-[#df6437]" />
            <div className={`font-display font-bold leading-tight ${shadow}`} style={{ fontSize: fit(5.6, 2000) }}><Emph text={text} accent="#f2a65a" /></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "*words*" → shown in the accent colour. */
function Emph({ text, accent }: { text: string; accent: string }) {
  const parts = text.split(/\*([^*]+)\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <span key={i} style={{ color: accent }}>{p}</span> : <span key={i}>{p}</span>))}
    </>
  );
}

/** Rough paint splash (smooth, irregular blob with drips and specks), for the corners of a series graphic. */
function Splash({ className, fill, seed }: { className: string; fill: string; seed: number }) {
  const n = 26;
  const rnd = (i: number) => (Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 30 + Math.abs(rnd(i)) * 22 + (i % 5 === 0 ? Math.abs(rnd(i + 50)) * 28 : 0); // occasional long drips
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
  });
  // smooth closed curve through the points
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const specks = Array.from({ length: 9 }, (_, i) => ({ cx: 50 + Math.cos(i * 2.4 + seed) * (62 + Math.abs(rnd(i + 9)) * 30), cy: 50 + Math.sin(i * 2.4 + seed) * (62 + Math.abs(rnd(i + 19)) * 30), r: 1 + Math.abs(rnd(i + 29)) * 3.5 }));
  return (
    <svg viewBox="-40 -40 180 180" className={className} aria-hidden>
      <path d={d} fill={fill} />
      {specks.map((c, i) => <circle key={i} {...c} fill={fill} />)}
    </svg>
  );
}

/** Sermon slides in the church's sermon-series style: colour + grunge texture, gold frame, bold capitals, accent words. */
function SeriesSlide({ slide }: { slide: Slide }) {
  const th = slide.sermonTheme!;
  const art = useSignedUrl(th.image ?? null);
  const text = slide.lines[0] ?? "";
  const style = slide.sermonStyle ?? "point";
  const len = text.replace(/\*/g, "").length;
  const size = (big: number, area: number) => `min(${Math.min(big, Math.sqrt(area / (Math.max(8, len) * 0.75))).toFixed(2)}cqw, ${(big * 1.9).toFixed(2)}cqh)`;
  const words = "font-display font-black uppercase leading-[1.12] tracking-[0.01em] [text-shadow:0_0.3cqw_0.9cqw_rgba(0,0,0,.55)]";
  const noise =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
  return (
    <div key={slide.key} className="fw-fade absolute inset-0 overflow-hidden" style={{ background: th.bg }}>
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <>
          {/* light and dark blotches + grain, like a printed poster */}
          <div className="absolute inset-0" style={{ background: `radial-gradient(60% 70% at 30% 35%, rgba(255,255,255,.16), transparent 70%), radial-gradient(45% 55% at 78% 40%, rgba(0,0,0,.38), transparent 70%), radial-gradient(70% 60% at 70% 95%, rgba(0,0,0,.25), transparent 70%)` }} />
          {/* a big dark painted patch behind the words */}
          <Splash className="absolute left-[34cqw] top-[2cqh] h-[80cqh] w-[60cqw] opacity-[0.28] mix-blend-multiply" fill="#000020" seed={4.2} />
          <div className="absolute inset-0 opacity-40 mix-blend-multiply" style={{ backgroundImage: noise, backgroundSize: "30cqw 30cqw" }} />
          <Splash className="absolute -bottom-[14cqh] -left-[8cqw] h-[40cqh] w-[24cqw] opacity-90" fill="#ffffff" seed={1.3} />
          <Splash className="absolute -right-[7cqw] bottom-[6cqh] h-[34cqh] w-[20cqw] opacity-70" fill="#cfd8ff" seed={2.6} />
          <svg viewBox="0 0 100 100" className="absolute bottom-[4cqh] left-[24cqw] h-[22cqh] w-[22cqw] opacity-25" aria-hidden>
            <circle cx="50" cy="50" r="38" fill="none" stroke={th.accent} strokeWidth="3" strokeDasharray="60 12 30 8" />
            <circle cx="52" cy="48" r="30" fill="none" stroke={th.accent} strokeWidth="2" strokeDasharray="40 10 20 14" />
          </svg>
        </>
      )}
      {/* frame */}
      <div className="absolute inset-[2.2cqw] rounded-[0.3cqw]" style={{ border: `1.1cqw solid ${th.accent}`, boxShadow: "inset 0 0 2cqw rgba(0,0,0,.35)" }} />
      {/* logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-white.png" alt={CHURCH_NAME} className="absolute bottom-[6.5cqh] right-[5.5cqw] h-[6cqh] w-auto opacity-85" />

      <div className="absolute inset-x-[9cqw] inset-y-[10cqh] flex flex-col items-center justify-center text-center text-white">
        {style === "title" ? (
          <>
            <div className={words} style={{ fontSize: size(8, 2600), color: "white" }}><Emph text={text} accent={th.accent} /></div>
            {slide.section && <div className="mt-[3cqh] font-display text-[min(2.4cqw,4.5cqh)] font-bold uppercase tracking-[0.25em]" style={{ color: th.accent }}>{slide.section}</div>}
          </>
        ) : style === "heading" ? (
          <>
            {slide.section && <div className="mb-[2cqh] font-display text-[min(2.6cqw,5cqh)] font-bold uppercase tracking-[0.3em] text-white/85">{slide.section}</div>}
            <div className={words} style={{ fontSize: size(6.8, 2300), color: th.accent }}>{text.replace(/\*/g, "")}</div>
          </>
        ) : style === "scripture" ? (
          <>
            <div className={words} style={{ fontSize: text ? "min(3.6cqw,7cqh)" : "min(7.5cqw,15cqh)", color: th.accent }}>{slide.section}</div>
            {text && <div className={`mt-[2.5cqh] ${words} normal-case`} style={{ fontSize: size(4.8, 1900) }}>“<Emph text={text.replace(/^["“]|["”]$/g, "")} accent={th.accent} />”</div>}
          </>
        ) : slide.section === "Say it together" ? (
          <div className={words} style={{ fontSize: size(6.2, 2200), color: th.accent }}>{text.replace(/\*/g, "")}</div>
        ) : (
          <div className={words} style={{ fontSize: size(5.6, 2100) }}><Emph text={text} accent={th.accent} /></div>
        )}
      </div>
    </div>
  );
}
