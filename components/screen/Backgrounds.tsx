"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PALETTES, parseBg } from "@/lib/slides";

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
type Maker = (colors: string[]) => Draw;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function base(g: CanvasRenderingContext2D, w: number, h: number, colors: string[]) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, colors[1]);
  gr.addColorStop(1, "#05050a");
  g.globalCompositeOperation = "source-over";
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}

// Soft out-of-focus circles drifting upward.
const bokeh: Maker = (colors) => {
  const dots = Array.from({ length: 42 }, () => ({ x: Math.random(), y: Math.random(), r: rnd(0.04, 0.14), s: rnd(0.004, 0.015), a: rnd(0.25, 0.6), c: colors[Math.floor(Math.random() * colors.length)], p: rnd(0, 6) }));
  return (g, w, h, t) => {
    base(g, w, h, colors);
    g.globalCompositeOperation = "lighter";
    const m = Math.min(w, h);
    for (const d of dots) {
      const y = (((d.y - t * d.s) % 1.3) + 1.3) % 1.3 - 0.15;
      const x = d.x + Math.sin(t * 0.3 + d.p) * 0.03;
      const r = d.r * m;
      const gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      const a = d.a * (0.7 + 0.3 * Math.sin(t * 0.8 + d.p));
      gr.addColorStop(0, hexA(d.c, a));
      gr.addColorStop(0.7, hexA(d.c, a * 0.6));
      gr.addColorStop(1, hexA(d.c, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x * w, y * h, r, 0, Math.PI * 2);
      g.fill();
    }
  };
};

// Beams of light from above, slowly sweeping.
const rays: Maker = (colors) => {
  const beams = Array.from({ length: 9 }, (_, i) => ({ a: -0.9 + (i / 8) * 1.8, wd: rnd(0.04, 0.12), sp: rnd(0.08, 0.2), p: rnd(0, 6), c: colors[i % colors.length] }));
  return (g, w, h, t) => {
    base(g, w, h, colors);
    g.globalCompositeOperation = "lighter";
    const ox = w / 2, oy = -h * 0.15, len = h * 1.6;
    for (const b of beams) {
      const ang = Math.PI / 2 + b.a + Math.sin(t * b.sp + b.p) * 0.18;
      const wd = b.wd * (0.8 + 0.2 * Math.sin(t * 0.5 + b.p));
      const gr = g.createLinearGradient(ox, oy, ox + Math.cos(ang) * len, oy + Math.sin(ang) * len);
      gr.addColorStop(0, hexA(b.c, 0.45));
      gr.addColorStop(1, hexA(b.c, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(ang - wd) * len, oy + Math.sin(ang - wd) * len);
      g.lineTo(ox + Math.cos(ang + wd) * len, oy + Math.sin(ang + wd) * len);
      g.closePath();
      g.fill();
    }
    const glow = g.createRadialGradient(ox, 0, 0, ox, 0, h * 0.6);
    glow.addColorStop(0, hexA(colors[2], 0.5));
    glow.addColorStop(1, hexA(colors[2], 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  };
};

// Layered ribbons of colour flowing sideways.
const waves: Maker = (colors) => {
  const layers = Array.from({ length: 5 }, (_, i) => ({ y: 0.45 + i * 0.1, amp: rnd(0.04, 0.1), f: rnd(1.2, 2.6), sp: rnd(0.15, 0.4) * (i % 2 ? 1 : -1), c: colors[i % colors.length] }));
  return (g, w, h, t) => {
    base(g, w, h, colors);
    g.globalCompositeOperation = "lighter";
    for (const l of layers) {
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 60) {
        const k = x / w;
        const y = (l.y + Math.sin(k * Math.PI * l.f + t * l.sp) * l.amp + Math.sin(k * 7 + t * l.sp * 1.7) * l.amp * 0.3) * h;
        g.lineTo(x, y);
      }
      g.lineTo(w, h);
      g.closePath();
      const gr = g.createLinearGradient(0, l.y * h - l.amp * h, 0, h);
      gr.addColorStop(0, hexA(l.c, 0.35));
      gr.addColorStop(1, hexA(l.c, 0.02));
      g.fillStyle = gr;
      g.fill();
    }
  };
};

// Glowing sparks rising like embers.
const sparks: Maker = (colors) => {
  const ps = Array.from({ length: 150 }, () => ({ x: Math.random(), y: Math.random(), r: rnd(0.0015, 0.005), s: rnd(0.02, 0.07), d: rnd(-0.01, 0.01), p: rnd(0, 6), c: colors[Math.floor(Math.random() * colors.length)] }));
  return (g, w, h, t) => {
    base(g, w, h, colors);
    const glow = g.createRadialGradient(w / 2, h * 1.1, 0, w / 2, h * 1.1, h * 0.9);
    glow.addColorStop(0, hexA(colors[0], 0.75));
    glow.addColorStop(1, hexA(colors[0], 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    const m = Math.min(w, h);
    for (const p of ps) {
      const y = 1.05 - ((((p.y + t * p.s) % 1.1) + 1.1) % 1.1);
      const x = p.x + Math.sin(t * 0.7 + p.p) * 0.02 + p.d * t * 0.05;
      const a = (0.5 + 0.5 * Math.sin(t * 3 + p.p * 3)) * Math.min(1, (1 - y) * 3) * 0.9;
      const r = p.r * m * 4;
      const gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      gr.addColorStop(0, hexA("#ffffff", a));
      gr.addColorStop(0.25, hexA(p.c, a * 0.8));
      gr.addColorStop(1, hexA(p.c, 0));
      g.fillStyle = gr;
      g.fillRect(x * w - r, y * h - r, r * 2, r * 2);
    }
  };
};

// Slowly turning starfield with a coloured nebula.
const stars: Maker = (colors) => {
  const st = Array.from({ length: 220 }, () => ({ a: rnd(0, Math.PI * 2), d: Math.sqrt(Math.random()) * 0.8, r: rnd(0.4, 1.6), p: rnd(0, 6) }));
  return (g, w, h, t) => {
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#03030a";
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    colors.forEach((c, i) => {
      const x = w * (0.3 + 0.4 * Math.sin(t * 0.05 + i * 2));
      const y = h * (0.4 + 0.25 * Math.cos(t * 0.04 + i * 2.5));
      const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.5);
      gr.addColorStop(0, hexA(c, 0.5));
      gr.addColorStop(1, hexA(c, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2, k = Math.max(1, w / 900);
    g.fillStyle = "#ffffff";
    for (const s of st) {
      const a = s.a + t * 0.01;
      g.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + s.p));
      g.beginPath();
      g.arc(cx + Math.cos(a) * s.d * R, cy + Math.sin(a) * s.d * R, s.r * k, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };
};

const MAKERS: Record<string, Maker> = { bokeh, rays, waves, sparks, stars };

function CanvasBg({ style, colors }: { style: string; colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const draw = (MAKERS[style] ?? bokeh)(colors);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const size = () => {
      // Draw at a modest resolution: smooth on old projector PCs, and it's all soft shapes anyway.
      const s = Math.min(1, 1280 / Math.max(1, cv.clientWidth)) * Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.max(1, Math.round(cv.clientWidth * s));
      cv.height = Math.max(1, Math.round(cv.clientHeight * s));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const t0 = performance.now() - Math.random() * 20000;
    const frame = (now: number) => {
      draw(g, cv.width, cv.height, (now - t0) / 1000);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [style, colors.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

/** Signed link to a file in the private "charts" bucket (for uploaded backgrounds). */
export function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let alive = true;
    createClient()
      .storage.from("charts")
      .createSignedUrl(path, 60 * 60 * 8)
      .then(({ data }) => alive && setUrl(data?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export const isVideo = (p: string) => /\.(mp4|mov|webm|m4v)$/i.test(p);

function MediaBg({ path }: { path: string }) {
  const url = useSignedUrl(path);
  if (!url) return <div className="absolute inset-0 bg-black" />;
  return isVideo(path) ? (
    <video key={url} src={url} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="fw-kenburns absolute inset-0 h-full w-full object-cover" />
  );
}

/** The moving background behind the lyrics. */
export default function Background({ bg, dim }: { bg: string; dim?: number }) {
  const b = parseBg(bg);
  if (b.style === "black") return <div className="absolute inset-0 bg-black" />;
  const colors = (PALETTES.find((p) => p.id === b.palette) ?? PALETTES[0]).colors;
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {b.style === "media" && b.path ? (
        <MediaBg path={b.path} />
      ) : b.style === "flow" ? (
        <div className="absolute inset-0" style={{ background: colors[1] }}>
          {colors.map((c, i) => (
            <div key={i} className={`fw-blob fw-blob-${i}`} style={{ background: `radial-gradient(circle, ${c} 0%, transparent 65%)` }} />
          ))}
        </div>
      ) : (
        <CanvasBg style={b.style} colors={colors} />
      )}
      {/* Darken a little so white words stay easy to read. Photos/videos need more. */}
      <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim ?? (b.style === "media" ? 0.4 : b.style === "flow" ? 0.3 : 0.12)})` }} />
    </div>
  );
}
