"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import Avatar, { displayName } from "@/components/Avatar";
import { complete, DISC, ENNEAGRAM, GENIUS, GIFTS, KINDS, loadAll, MBTI, STRENGTHS, summary, tags, TEAM_FIT, type Kind, type Row } from "@/lib/assessments";
import type { Position, PositionMember, Profile, Team } from "@/lib/types";

type Data = Record<string, unknown>;
type Person = { p: Profile; res: Partial<Record<Kind, Data>>; tags: Set<string>; teams: string[] };

// What can be searched for, and how it's labelled.
const FIELDS: { key: string; label: string; values: { v: string; label: string }[] }[] = [
  { key: "wg-genius", label: "Working Genius: genius", values: GENIUS.map((g) => ({ v: g.key, label: g.key })) },
  { key: "wg-frustration", label: "Working Genius: frustration", values: GENIUS.map((g) => ({ v: g.key, label: g.key })) },
  { key: "gift-top3", label: "Spiritual gift (top 3)", values: GIFTS.map((g) => ({ v: g, label: g })) },
  { key: "gift", label: "Spiritual gift (any)", values: GIFTS.map((g) => ({ v: g, label: g })) },
  { key: "enneagram", label: "Enneagram type", values: ENNEAGRAM.map((e) => ({ v: String(e.n), label: `${e.n} ${e.name}` })) },
  { key: "disc", label: "DISC main style", values: DISC.map((d) => ({ v: d.key, label: `${d.key} ${d.name}` })) },
  { key: "strength", label: "CliftonStrength (top 5)", values: STRENGTHS.map((s) => ({ v: s, label: s })) },
  { key: "mbti", label: "Myers-Briggs type", values: MBTI.map((m) => ({ v: m, label: m })) },
];
const PRESETS: { label: string; tags: string[] }[] = [
  { label: "🏁 Finishers (Tenacity)", tags: ["wg-genius:Tenacity"] },
  { label: "💡 Idea people (Invention)", tags: ["wg-genius:Invention"] },
  { label: "📣 Rally the troops (Galvanizing)", tags: ["wg-genius:Galvanizing"] },
  { label: "🤝 Hospitality", tags: ["gift-top3:Hospitality"] },
  { label: "📖 Teachers", tags: ["gift-top3:Teaching"] },
  { label: "🧭 Leaders", tags: ["gift-top3:Leadership"] },
  { label: "🙏 Intercessors", tags: ["gift-top3:Intercession"] },
];
const CHIP: Record<string, string> = {
  "wg-genius": "Genius", "wg-frustration": "Drained by", "gift-top3": "Top-3 gift", gift: "Gift", enneagram: "Enneagram", disc: "DISC", strength: "Strength", mbti: "Type",
};
const tagLabel = (t: string) => {
  const [k, v] = t.split(":");
  const f = FIELDS.find((x) => x.key === k);
  return `${CHIP[k] ?? k}: ${f?.values.find((x) => x.v === v)?.label ?? v}`;
};

/** Strengths & gifts across the church: find people, see everyone at once, and spot each team's gaps. */
export default function StrengthsPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [people, setPeople] = useState<Profile[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [ok, setOk] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [members, setMembers] = useState<PositionMember[]>([]);
  const [tab, setTab] = useState<"find" | "all" | "teams">("find");
  const [filters, setFilters] = useState<string[]>([]);
  const [field, setField] = useState(FIELDS[0].key);
  const [q, setQ] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);

  useEffect(() => {
    (async () => {
      const [ppl, t, pos, pm, a] = await Promise.all([
        supabase.from("profiles").select("*").neq("role", "pending").order("full_name"),
        supabase.from("teams").select("*").order("sort"),
        supabase.from("positions").select("*").order("sort"),
        supabase.from("position_members").select("*"),
        loadAll(supabase),
      ]);
      setPeople((ppl.data ?? []) as Profile[]);
      setTeams((t.data ?? []) as Team[]);
      setPositions(pos.data ?? []);
      setMembers(pm.data ?? []);
      setRows(a.rows);
      setOk(a.ok);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const everyone: Person[] = useMemo(() => {
    const visTeams = teams.filter((t) => !loc.current || !t.location_id || t.location_id === loc.current);
    return people
      .filter((p) => !loc.current || !p.location_id || p.location_id === loc.current)
      .map((p) => {
        const res: Partial<Record<Kind, Data>> = {};
        for (const r of rows) if (r.profile_id === p.id) res[r.kind] = r.data;
        const tIds = new Set(members.filter((m) => m.profile_id === p.id).map((m) => positions.find((x) => x.id === m.position_id)?.team_id));
        return { p, res, tags: new Set(tags(res)), teams: visTeams.filter((t) => tIds.has(t.id)).map((t) => t.id) };
      });
  }, [people, rows, members, positions, teams, loc.current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me.isLeader) return <p className="text-muted">Only leaders can see everyone&apos;s strengths. <Link href="/gifts" className="text-accent">Fill in your own →</Link></p>;

  const filled = (x: Person) => KINDS.filter((k) => complete(k.kind, x.res[k.kind])).length;
  const withAny = everyone.filter((x) => filled(x) > 0).length;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const matches = everyone.filter((x) => filters.every((f) => x.tags.has(f)) && (!q.trim() || displayName(x.p).toLowerCase().includes(q.trim().toLowerCase())));

  function Card({ x, why }: { x: Person; why?: string }) {
    return (
      <li className="card flex gap-3 p-3">
        <Avatar name={displayName(x.p)} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>{displayName(x.p)}</b>
            {x.teams.map((t) => <span key={t} className="rounded-full bg-stone-100 px-2 text-[11px] text-muted">{teamName(t)}</span>)}
            <Link href={`/gifts?person=${x.p.id}`} className="ml-auto text-xs font-semibold text-accent hover:underline">Edit results</Link>
          </div>
          {why && <div className="mt-0.5 text-xs font-semibold text-emerald-700">{why}</div>}
          <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {KINDS.map(({ kind, short }) => {
              const s = summary(kind, x.res[kind]);
              const fr = kind === "working_genius" ? ((x.res[kind]?.frustration as string[]) ?? []) : [];
              return (
                <div key={kind} className="flex gap-1.5">
                  <dt className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">{short}</dt>
                  <dd className={s ? "" : "italic text-stone-400"}>
                    {s || "—"}
                    {fr.length > 0 && <span className="text-red-700"> · drains: {fr.join(", ")}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </li>
    );
  }

  function exportCsv() {
    const head = ["Name", "Email", "Teams", ...KINDS.map((k) => k.name), "WG competencies", "WG frustrations"];
    const lines = everyone.map((x) => [
      displayName(x.p), x.p.email ?? "", x.teams.map(teamName).join("; "),
      ...KINDS.map((k) => summary(k.kind, x.res[k.kind])),
      ((x.res.working_genius?.competency as string[]) ?? []).join(" + "), ((x.res.working_genius?.frustration as string[]) ?? []).join(" + "),
    ]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "strengths-and-gifts.csv";
    a.click();
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end gap-3 border-b border-line pb-4">
        <div className="flex-1">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Strengths &amp; gifts</h1>
          <p className="text-sm text-muted">Everyone&apos;s Enneagram, Working Genius, spiritual gifts and more, in one place.</p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => {
            navigator.clipboard?.writeText(`${window.location.origin}/gifts`);
            alert(`Link copied: ${window.location.origin}/gifts\n\nSend it to your team (or new volunteers) so they can fill in their results.`);
          }}
        >
          🔗 Copy link for your team
        </button>
        <Link href="/gifts" className="btn">My results</Link>
      </header>

      {!ok && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Run the database update <b>016_assessments.sql</b> (also in ALL_UPDATES.sql) in Supabase to switch this on, then reload.
        </p>
      )}

      {/* How complete is it? */}
      <section className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <div className="card p-3">
          <div className="text-2xl font-extrabold">{withAny}<span className="text-base font-semibold text-muted">/{everyone.length}</span></div>
          <div className="text-xs text-muted">people with results</div>
        </div>
        {KINDS.map((k) => (
          <div key={k.kind} className="card p-3">
            <div className="text-2xl font-extrabold">{everyone.filter((x) => complete(k.kind, x.res[k.kind])).length}</div>
            <div className="text-xs text-muted">{k.name}</div>
          </div>
        ))}
      </section>

      <div className="flex gap-1 border-b border-line">
        {([["find", "Find people"], ["all", "Everyone"], ["teams", "Teams"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
        ))}
      </div>

      {tab === "find" && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((pr) => (
              <button key={pr.label} className="rounded-full border border-line bg-white px-3 py-1 text-sm hover:border-accent" onClick={() => setFilters(pr.tags)}>{pr.label}</button>
            ))}
          </div>
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <span className="text-sm font-semibold">Show people with</span>
            <select className="input w-auto py-1 text-sm" value={field} onChange={(e) => setField(e.target.value)}>
              {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select
              className="input w-auto py-1 text-sm"
              value=""
              onChange={(e) => e.target.value && setFilters((fs) => [...new Set([...fs, `${field}:${e.target.value}`])])}
            >
              <option value="">Choose…</option>
              {FIELDS.find((f) => f.key === field)!.values.map((v) => <option key={v.v} value={v.v}>{v.label}</option>)}
            </select>
            {filters.map((f) => (
              <span key={f} className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-white">
                {tagLabel(f)}
                <button onClick={() => setFilters(filters.filter((x) => x !== f))} aria-label="Remove">✕</button>
              </span>
            ))}
            {filters.length > 0 && <button className="text-xs text-muted hover:underline" onClick={() => setFilters([])}>Clear</button>}
            <input className="input ml-auto w-44 py-1 text-sm" placeholder="Name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <p className="text-sm text-muted">
            {filters.length ? <><b className="text-ink">{matches.length}</b> {matches.length === 1 ? "person matches" : "people match"}</> : "Pick a quick search above, or build your own."}
          </p>
          {filters.length > 0 && <ul className="grid gap-2 lg:grid-cols-2">{matches.map((x) => <Card key={x.p.id} x={x} />)}</ul>}
        </section>
      )}

      {tab === "all" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input className="input w-56 py-1 text-sm" placeholder="Search names…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Only people missing results
            </label>
            <span className="flex-1" />
            <button className="btn-secondary" onClick={exportCsv}>⬇ Download spreadsheet</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-stone-50 text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="sticky left-0 bg-stone-50 px-3 py-2">Name</th>
                  {KINDS.map((k) => <th key={k.kind} className="px-3 py-2">{k.short}</th>)}
                </tr>
              </thead>
              <tbody>
                {everyone
                  .filter((x) => (!missingOnly || filled(x) < KINDS.length) && (!q.trim() || displayName(x.p).toLowerCase().includes(q.trim().toLowerCase())))
                  .map((x) => (
                    <tr key={x.p.id} className="border-b border-line align-top last:border-0">
                      <td className="sticky left-0 bg-white px-3 py-2">
                        <Link href={`/gifts?person=${x.p.id}`} className="font-semibold hover:text-accent">{displayName(x.p)}</Link>
                        <div className="text-[11px] text-muted">{x.teams.map(teamName).join(", ")}</div>
                      </td>
                      {KINDS.map(({ kind }) => {
                        const s = summary(kind, x.res[kind]);
                        return <td key={kind} className={`px-3 py-2 ${s ? "" : "italic text-stone-300"}`}>{s || "missing"}</td>;
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "teams" && (
        <section className="grid gap-4 lg:grid-cols-2">
          {teams
            .filter((t) => !loc.current || !t.location_id || t.location_id === loc.current)
            .map((t) => {
              const on = everyone.filter((x) => x.teams.includes(t.id));
              const wg = on.filter((x) => complete("working_genius", x.res.working_genius));
              const count = (k: "genius" | "frustration", g: string) => wg.filter((x) => ((x.res.working_genius?.[k] as string[]) ?? []).includes(g)).length;
              const gaps = wg.length >= 2 ? GENIUS.filter((g) => count("genius", g.key) === 0) : [];
              const giftCount = new Map<string, number>();
              on.forEach((x) => ((x.res.spiritual_gifts?.top as string[]) ?? []).slice(0, 3).forEach((g) => giftCount.set(g, (giftCount.get(g) ?? 0) + 1)));
              const topGifts = [...giftCount].sort((a, b) => b[1] - a[1]).slice(0, 5);
              const enn = new Map<number, number>();
              on.forEach((x) => { const n = x.res.enneagram?.type as number | undefined; if (n) enn.set(n, (enn.get(n) ?? 0) + 1); });
              const fit = TEAM_FIT.find((f) => f.test.test(t.name));
              const ideas = fit
                ? everyone
                    .filter((x) => !x.teams.includes(t.id))
                    .map((x) => {
                      const gifts = ((x.res.spiritual_gifts?.top as string[]) ?? []).slice(0, 3).filter((g) => fit.gifts.includes(g));
                      const gen = ((x.res.working_genius?.genius as string[]) ?? []).filter((g) => fit.genius.includes(g) || gaps.some((y) => y.key === g));
                      return { x, why: [...gifts, ...gen.map((g) => `${g} genius`)], score: gifts.length * 2 + gen.length };
                    })
                    .filter((r) => r.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5)
                : [];
              const max = Math.max(1, ...GENIUS.map((g) => count("genius", g.key)));
              return (
                <div key={t.id} className="card space-y-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="h2 flex-1">{t.name}</h2>
                    <span className="text-xs text-muted">{on.filter((x) => filled(x) > 0).length} of {on.length} have results</span>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Working Genius on this team</div>
                    {wg.length === 0 ? (
                      <p className="text-sm italic text-stone-400">No one on this team has entered Working Genius yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {GENIUS.map((g) => {
                          const n = count("genius", g.key);
                          const f = count("frustration", g.key);
                          return (
                            <div key={g.key} className="flex items-center gap-2 text-xs">
                              <span className="w-24 font-semibold">{g.key}</span>
                              <span className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                                <span className={`block h-full rounded-full ${n ? "bg-accent" : ""}`} style={{ width: `${(n / max) * 100}%` }} />
                              </span>
                              <span className="w-28 text-right">{n ? `${n} genius` : <b className="text-bad">no one</b>}{f ? <span className="text-red-700"> · {f} drained</span> : ""}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {gaps.length > 0 && (
                      <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-900">
                        <b>Gap:</b> no one here has {gaps.map((g) => g.key).join(" or ")} as a genius ({gaps.map((g) => g.gist).join("; ")}). Worth recruiting for.
                      </p>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Top spiritual gifts</div>
                      {topGifts.length ? (
                        <ul className="text-sm">{topGifts.map(([g, n]) => <li key={g}>{g} <span className="text-muted">×{n}</span></li>)}</ul>
                      ) : <p className="text-sm italic text-stone-400">None entered yet</p>}
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Enneagram mix</div>
                      {enn.size ? (
                        <div className="flex flex-wrap gap-1">
                          {[...enn].sort((a, b) => a[0] - b[0]).map(([n, c]) => (
                            <span key={n} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs" title={ENNEAGRAM[n - 1].name}>{n} {ENNEAGRAM[n - 1].name}{c > 1 ? ` ×${c}` : ""}</span>
                          ))}
                        </div>
                      ) : <p className="text-sm italic text-stone-400">None entered yet</p>}
                    </div>
                  </div>
                  {fit && (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Recruiting ideas: good fits not on this team yet</div>
                      {ideas.length ? (
                        <ul className="space-y-1 text-sm">
                          {ideas.map(({ x, why }) => (
                            <li key={x.p.id} className="flex items-center gap-2">
                              <Avatar name={displayName(x.p)} size="sm" />
                              <span className="font-medium">{displayName(x.p)}</span>
                              <span className="truncate text-xs text-emerald-700">{why.join(" · ")}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm italic text-stone-400">No matches yet. More people filling in their results will help.</p>}
                    </div>
                  )}
                </div>
              );
            })}
        </section>
      )}
    </div>
  );
}
