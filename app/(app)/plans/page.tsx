"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import { fmtDate, fmtTime, nextSundayISO, planLabel, todayISO } from "@/lib/format";
import type { Plan, ServiceType } from "@/lib/types";

type Row = Plan & { service_types: { name: string } | null; plan_items: { count: number }[] };

export default function PlansPage() {
  const me = useProfile();
  const loc = useLocations();
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [recent, setRecent] = useState<Plan[]>([]);
  const [past, setPast] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: nextSundayISO(), type: "", copyFrom: "", location: loc.current ?? loc.locations[0]?.id ?? "" });
  useEffect(() => {
    if (loc.current) setForm((f) => ({ ...f, location: loc.current! }));
  }, [loc.current]);

  useEffect(() => {
    const today = todayISO();
    let q = supabase.from("plans").select("*, service_types(name), plan_items(count)");
    if (loc.current) q = q.eq("location_id", loc.current);
    (past ? q.lt("service_date", today).order("service_date", { ascending: false }).limit(50) : q.gte("service_date", today).order("service_date"))
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, [past, loc.current]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from("plans").select("*").order("service_date", { ascending: false }).limit(20).then(({ data }) => setRecent(data ?? []));
    supabase.from("service_types").select("*").order("name").then(({ data }) => {
      setTypes(data ?? []);
      if (data?.[0]) setForm((f) => ({ ...f, type: f.type || data[0].id }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const st = types.find((t) => t.id === form.type);
    const { data: plan, error } = await supabase
      .from("plans")
      .insert({ service_date: form.date, service_type_id: st?.id ?? null, start_time: st?.default_time ?? null, ...(loc.locations.length ? { location_id: form.location || null } : {}) })
      .select()
      .single();
    if (error || !plan) {
      alert(error?.message ?? "Could not create plan");
      setCreating(false);
      return;
    }
    if (form.copyFrom) {
      const { data: items } = await supabase.from("plan_items").select("*").eq("plan_id", form.copyFrom).order("position");
      if (items?.length) {
        await supabase.from("plan_items").insert(
          items.map(({ id: _id, plan_id: _p, ...rest }) => ({ ...rest, plan_id: plan.id }))
        );
      }
    }
    router.push(`/plans/${plan.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Plans</h1>
        <div className="ml-auto flex rounded-md border border-line bg-white p-0.5 text-sm">
          <button className={`rounded px-3 py-1 ${!past ? "bg-accent-soft text-accent" : "text-muted"}`} onClick={() => setPast(false)}>Upcoming</button>
          <button className={`rounded px-3 py-1 ${past ? "bg-accent-soft text-accent" : "text-muted"}`} onClick={() => setPast(true)}>Past</button>
        </div>
      </div>

      {me.isLeader && (
        <form onSubmit={create} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
          {loc.locations.length > 0 && (
            <div>
              <label className="label">Location</label>
              <select className="input" required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} disabled={!loc.canSwitch}>
                {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Service date</label>
            <input type="date" className="input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Service type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Copy order of service from</label>
            <select className="input" value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}>
              <option value="">— Blank plan —</option>
              {recent.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.service_date)} {r.title ? `· ${r.title}` : ""}</option>)}
            </select>
          </div>
          <button className="btn" disabled={creating}>{creating ? "Creating…" : "New plan"}</button>
        </form>
      )}

      <div className="card divide-y divide-line p-0">
        {rows.length === 0 && <p className="p-4 text-sm text-muted">No {past ? "past" : "upcoming"} plans.</p>}
        {rows.map((p) => (
          <Link key={p.id} href={`/plans/${p.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-stone-50">
            <div className="w-14 shrink-0 text-center">
              <div className="text-xs uppercase text-muted">{fmtDate(p.service_date, { month: "short", day: undefined, weekday: undefined, year: undefined })}</div>
              <div className="text-xl font-semibold">{fmtDate(p.service_date, { day: "numeric", month: undefined, weekday: undefined, year: undefined })}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {planLabel(p)}
                {!loc.current && p.location_id && <LocationTag name={loc.name(p.location_id)} />}
              </div>
              <div className="text-sm text-muted">
                {p.service_types?.name} {fmtTime(p.start_time)} {p.series && `· ${p.series}`}
              </div>
            </div>
            <span className="text-xs text-muted">{p.plan_items?.[0]?.count ?? 0} items</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function LocationTag({ name }: { name: string }) {
  return <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-accent">{name}</span>;
}
