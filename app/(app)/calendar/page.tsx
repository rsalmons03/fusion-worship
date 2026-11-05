"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import StatusChip from "@/components/StatusChip";
import { fmtDate, fmtTime, planLabel, todayISO } from "@/lib/format";
import type { AssignmentStatus, Blockout, Plan, Profile } from "@/lib/types";

type PTime = { id: string; plan_id: string; kind: "service" | "rehearsal" | "other"; label: string | null; day: string; starts: string | null; ends: string | null };
type Mine = { id: string; plan_id: string; status: AssignmentStatus; positions: { name: string } | null; plans: { service_date: string } | null };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const today = todayISO();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(today);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [times, setTimes] = useState<PTime[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);

  // The grid shows whole weeks, so it can start in the previous month and end in the next.
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - start.getDay());
    const out: string[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(iso(d));
    }
    // Drop a trailing week that's entirely next month.
    return out.slice(0, out[35].slice(0, 7) !== iso(month).slice(0, 7) ? 35 : 42);
  }, [month]);
  const from = days[0];
  const to = days[days.length - 1];

  const load = useCallback(async () => {
    let pq = supabase.from("plans").select("*").gte("service_date", from).lte("service_date", to).order("service_date");
    if (loc.current) pq = pq.eq("location_id", loc.current);
    const [p, m, b, ppl] = await Promise.all([
      pq,
      supabase.from("assignments").select("id,plan_id,status,positions(name),plans!inner(service_date)").eq("profile_id", me.id).gte("plans.service_date", from).lte("plans.service_date", to),
      supabase.from("blockouts").select("*").lte("starts_on", to).gte("ends_on", from),
      me.isLeader ? supabase.from("profiles").select("id,full_name,email").neq("role", "pending") : Promise.resolve({ data: [] as Profile[] }),
    ]);
    const ps = (p.data ?? []) as Plan[];
    setPlans(ps);
    setMine((m.data ?? []) as unknown as Mine[]);
    setBlockouts(((b.data ?? []) as Blockout[]).filter((x) => me.isLeader || x.profile_id === me.id));
    setPeople((ppl.data ?? []) as Profile[]);
    if (ps.length) {
      const t = await supabase.from("plan_times").select("*").in("plan_id", ps.map((x) => x.id));
      setTimes(t.error ? [] : ((t.data ?? []) as PTime[]));
    } else setTimes([]);
  }, [from, to, loc.current, me.id, me.isLeader]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const on = (d: string) => ({
    plans: plans.filter((p) => p.service_date === d),
    times: times.filter((t) => t.day === d),
    mine: mine.filter((a) => a.plans?.service_date === d),
    out: blockouts.filter((b) => b.starts_on <= d && b.ends_on >= d),
  });
  const name = (id: string) => {
    const p = people.find((x) => x.id === id);
    return id === me.id ? "You" : p?.full_name || p?.email || "Someone";
  };
  const planName = (id: string) => {
    const p = plans.find((x) => x.id === id);
    return p ? planLabel(p) : "Service";
  };

  const sel = on(selected);
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const thisMonth = iso(month).slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="h1 flex-1">Calendar</h1>
        <button className="btn-ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today); }}>Today</button>
      </div>

      <div className="card p-0">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-accent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
          <div className="flex-1 text-center font-display text-lg font-bold">{monthLabel}</div>
          <button className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-accent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-bold uppercase text-muted">
          {DOW.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const e = on(d);
            const inMonth = d.slice(0, 7) === thisMonth;
            const isSel = d === selected;
            return (
              <button
                key={d}
                onClick={() => setSelected(d)}
                className={`flex min-h-[3.75rem] flex-col items-center gap-0.5 border-b border-r border-line p-1 text-sm sm:min-h-[5.5rem] sm:items-start ${inMonth ? "" : "bg-stone-50 text-stone-400"} ${isSel ? "bg-accent-soft" : ""}`}
              >
                <span className={`grid h-7 w-7 place-items-center rounded-full ${d === today ? "bg-accent font-bold text-white" : ""}`}>{Number(d.slice(8))}</span>
                <span className="flex flex-wrap justify-center gap-0.5 sm:hidden">
                  {e.plans.length > 0 && <i className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  {e.times.some((t) => t.kind !== "service") && <i className="h-1.5 w-1.5 rounded-full bg-stone-700" />}
                  {e.mine.length > 0 && <i className="h-1.5 w-1.5 rounded-full bg-[#1d9bf0]" />}
                  {e.out.length > 0 && <i className="h-1.5 w-1.5 rounded-full bg-bad" />}
                </span>
                <span className="hidden w-full space-y-0.5 text-left text-[11px] leading-tight sm:block">
                  {e.plans.map((p) => <span key={p.id} className="block truncate rounded-sm bg-accent px-1 text-white">{planLabel(p)}</span>)}
                  {e.times.filter((t) => t.kind !== "service").map((t) => <span key={t.id} className="block truncate rounded-sm bg-stone-700 px-1 text-white">{t.label || (t.kind === "rehearsal" ? "Rehearsal" : "Other")}</span>)}
                  {e.mine.length > 0 && <span className="block truncate rounded-sm bg-[#1d9bf0] px-1 text-white">You: {e.mine[0].positions?.name}</span>}
                  {e.out.length > 0 && <span className="block truncate text-bad">{e.out.length} out</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 px-3 py-2 text-[11px] text-muted">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />Service</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-stone-700" />Rehearsal / other</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1d9bf0]" />You&apos;re serving</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-bad" />Blocked out</span>
        </div>
      </div>

      {/* Selected day */}
      <section className="card space-y-3">
        <h2 className="h2">{fmtDate(selected, { weekday: "long", month: "long" })}</h2>
        {!sel.plans.length && !sel.times.length && !sel.mine.length && !sel.out.length && <p className="text-sm text-muted">Nothing on this day.</p>}
        {sel.plans.map((p) => (
          <Link key={p.id} href={`/plans/${p.id}`} className="flex items-center gap-3 rounded-md border border-line p-3 hover:border-accent">
            <span className="h-10 w-1 rounded-full bg-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{planLabel(p)}</span>
              <span className="block text-sm text-muted">
                {[fmtTime(p.start_time), p.location_id && loc.name(p.location_id)].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="text-muted">›</span>
          </Link>
        ))}
        {sel.times.map((t) => (
          <Link key={t.id} href={`/plans/${t.plan_id}`} className="flex items-center gap-3 rounded-md border border-line p-3 hover:border-accent">
            <span className={`h-10 w-1 rounded-full ${t.kind === "service" ? "bg-accent" : "bg-stone-700"}`} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t.label || (t.kind === "service" ? "Service" : t.kind === "rehearsal" ? "Rehearsal" : "Other")}</span>
              <span className="block text-sm text-muted">{[fmtTime(t.starts), fmtTime(t.ends)].filter(Boolean).join(" – ")} · {planName(t.plan_id)}</span>
            </span>
          </Link>
        ))}
        {sel.mine.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-md bg-sky-50 p-3">
            <span className="h-10 w-1 rounded-full bg-[#1d9bf0]" />
            <span className="flex-1 text-sm">You&apos;re on <b>{a.positions?.name}</b> for {planName(a.plan_id)}</span>
            <StatusChip status={a.status} />
          </div>
        ))}
        {sel.out.length > 0 && (
          <div className="rounded-md bg-red-50 p-3 text-sm">
            <b className="text-bad">Blocked out:</b> {sel.out.map((b) => `${name(b.profile_id)}${b.reason ? ` (${b.reason})` : ""}`).join(", ")}
          </div>
        )}
        <Link href="/me" className="btn-secondary">+ Add my block-out dates</Link>
      </section>
    </div>
  );
}
