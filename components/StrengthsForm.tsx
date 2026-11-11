"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { complete, DISC, ENNEAGRAM, GENIUS, GIFTS, KINDS, MBTI, saveResult, STRENGTHS, wingsOf, type Kind } from "@/lib/assessments";

type Data = Record<string, unknown>;
const chip = (on: boolean, tone = "accent") =>
  `rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
    on ? (tone === "bad" ? "border-red-400 bg-red-50 text-red-800" : tone === "mid" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-accent bg-accent text-white") : "border-line bg-white text-ink hover:border-accent"
  }`;

/** Tap-to-pick results for each assessment. Saves as you go. */
export default function StrengthsForm({ profileId, initial, onSaved }: { profileId: string; initial: Partial<Record<Kind, Data>>; onSaved?: () => void }) {
  const [vals, setVals] = useState<Partial<Record<Kind, Data>>>(initial);
  const [state, setState] = useState<Partial<Record<Kind, "saving" | "saved" | string>>>({});
  const timers = useRef<Partial<Record<Kind, ReturnType<typeof setTimeout>>>>({});
  useEffect(() => setVals(initial), [initial]);

  function set(kind: Kind, d: Data | null) {
    setVals((v) => ({ ...v, [kind]: d ?? undefined }));
    setState((s) => ({ ...s, [kind]: "saving" }));
    clearTimeout(timers.current[kind]);
    timers.current[kind] = setTimeout(async () => {
      const { error } = await saveResult(createClient(), profileId, kind, d && Object.keys(d).length ? d : null);
      setState((s) => ({ ...s, [kind]: error ? (/assessments/.test(error.message) ? "Needs the database update 016_assessments.sql" : error.message) : "saved" }));
      if (!error) onSaved?.();
    }, 500);
  }
  /** Adds/removes an item from an ordered list (max n). */
  const toggleIn = (list: string[] = [], x: string, max: number) => (list.includes(x) ? list.filter((y) => y !== x) : list.length >= max ? list : [...list, x]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {KINDS.map(({ kind, name, take, help }) => {
        const d = (vals[kind] ?? {}) as Data;
        const st = state[kind];
        return (
          <section key={kind} className={`card ${kind === "strengths" || kind === "spiritual_gifts" ? "lg:col-span-2" : ""}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="h2 flex-1">
                {name} {complete(kind, vals[kind]) && <span className="ml-1 text-sm text-emerald-700">✓</span>}
              </h2>
              <span className="text-xs text-muted">{st === "saving" ? "Saving…" : st === "saved" ? "Saved ✓" : st ? <span className="text-bad">{st}</span> : ""}</span>
              {vals[kind] && <button className="btn-ghost text-xs" onClick={() => set(kind, null)}>Clear</button>}
            </div>
            <p className="mb-3 text-sm text-muted">
              {help} Haven&apos;t taken it? <a href={take.url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">Take it at {take.label} ↗</a>
            </p>

            {kind === "enneagram" && (() => {
              const t = d.type as number | undefined;
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    {ENNEAGRAM.map((e) => (
                      <button key={e.n} className={`${chip(t === e.n)} text-left`} onClick={() => set(kind, t === e.n ? null : { type: e.n, wing: null })} title={e.gist}>
                        <b>{e.n}</b> {e.name}
                      </button>
                    ))}
                  </div>
                  {t && (
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="text-muted">Wing:</span>
                      {wingsOf(t).map((w) => (
                        <button key={w} className={chip(d.wing === w)} onClick={() => set(kind, { type: t, wing: d.wing === w ? null : w })}>{t}w{w}</button>
                      ))}
                      <span className="text-xs text-muted">(optional)</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {kind === "working_genius" && (() => {
              const g = { genius: (d.genius as string[]) ?? [], competency: (d.competency as string[]) ?? [], frustration: (d.frustration as string[]) ?? [] };
              const pick = (k: keyof typeof g, x: string) => {
                const next = { genius: g.genius.filter((y) => y !== x), competency: g.competency.filter((y) => y !== x), frustration: g.frustration.filter((y) => y !== x) };
                if (!g[k].includes(x)) next[k] = [...next[k], x].slice(-2);
                set(kind, next);
              };
              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted">
                      <th className="pb-1 text-left font-semibold"></th>
                      <th className="pb-1 font-semibold">Genius</th>
                      <th className="pb-1 font-semibold">Competency</th>
                      <th className="pb-1 font-semibold">Frustration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GENIUS.map((x) => (
                      <tr key={x.key} className="border-t border-line">
                        <td className="py-1.5 pr-2"><b>{x.key}</b><span className="block text-[11px] text-muted">{x.gist}</span></td>
                        {(["genius", "competency", "frustration"] as const).map((k) => (
                          <td key={k} className="text-center">
                            <button className={chip(g[k].includes(x.key), k === "genius" ? "accent" : k === "competency" ? "mid" : "bad")} onClick={() => pick(k, x.key)} aria-label={`${x.key}: ${k}`}>
                              {g[k].includes(x.key) ? "✓" : "·"}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}

            {(kind === "spiritual_gifts" || kind === "strengths") && (() => {
              const top = (d.top as string[]) ?? [];
              const list = kind === "spiritual_gifts" ? GIFTS : STRENGTHS;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {list.map((x) => {
                    const i = top.indexOf(x);
                    return (
                      <button key={x} className={chip(i >= 0)} onClick={() => set(kind, { top: toggleIn(top, x, 5) })}>
                        {i >= 0 && <span className="mr-1 rounded-full bg-white/25 px-1">{i + 1}</span>}
                        {x}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {kind === "disc" && (
              <div className="space-y-2 text-sm">
                {(["primary", "secondary"] as const).map((k) => (
                  <div key={k} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 text-muted">{k === "primary" ? "Main" : "Second"}</span>
                    {DISC.map((x) => (
                      <button
                        key={x.key}
                        className={chip(d[k] === x.key)}
                        disabled={k === "secondary" && (!d.primary || d.primary === x.key)}
                        title={x.gist}
                        onClick={() => set(kind, k === "primary" ? { primary: x.key, secondary: d.secondary === x.key ? null : d.secondary ?? null } : { ...d, secondary: d.secondary === x.key ? null : x.key })}
                      >
                        <b>{x.key}</b> {x.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {kind === "mbti" && (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {MBTI.map((x) => (
                  <button key={x} className={chip(d.type === x)} onClick={() => set(kind, d.type === x ? null : { type: x })}>{x}</button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
