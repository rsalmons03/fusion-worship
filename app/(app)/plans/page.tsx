"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import { fmtDate, fmtTime, nextSundayISO, planLabel, todayISO } from "@/lib/format";
import type { OrderTemplate, Plan, ServiceType } from "@/lib/types";
import { applyTemplate, loadTemplates } from "@/lib/templates";
import { addDays, copyItems, copyTimes, describeRepeat, repeatDates, type Repeat } from "@/lib/recur";

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
  const [form, setForm] = useState({
    date: nextSundayISO(),
    type: "",
    copyFrom: "",
    location: loc.current ?? loc.locations[0]?.id ?? "",
    repeat: "none" as Repeat,
    until: addDays(nextSundayISO(), 7 * 7),
    copyItems: true,
    copyTimes: true,
  });
  const [progress, setProgress] = useState("");
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  useEffect(() => {
    loadTemplates(supabase).then(setTemplates);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Start from the location's default template unless the leader picks something else.
  const [touchedSource, setTouchedSource] = useState(false);
  useEffect(() => {
    if (touchedSource) return;
    const def =
      templates.find((t) => t.is_default && t.location_id === (form.location || null)) ?? templates.find((t) => t.is_default && !t.location_id);
    setForm((f) => ({ ...f, copyFrom: def ? `t:${def.id}` : "" }));
  }, [templates, form.location, touchedSource]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (loc.current) setForm((f) => ({ ...f, location: loc.current! }));
  }, [loc.current]);

  useEffect(() => {
    const today = todayISO();
    let q = supabase.from("plans").select("*, service_types(name), plan_items(count)");
    if (loc.current) q = q.eq("location_id", loc.current);
    (past ? q.lt("service_date", today).order("service_date", { ascending: false }).limit(50) : q.gte("service_date", today).order("service_date"))
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, [past, loc.current, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from("plans").select("*").order("service_date", { ascending: false }).limit(20).then(({ data }) => setRecent(data ?? []));
    supabase.from("service_types").select("*").order("name").then(({ data }) => {
      setTypes(data ?? []);
      if (data?.[0]) setForm((f) => ({ ...f, type: f.type || data[0].id }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dates = repeatDates(form.date, form.repeat, form.until);
  const template = recent.find((r) => r.id === form.copyFrom);
  const orderTemplate = form.copyFrom.startsWith("t:") ? templates.find((t) => t.id === form.copyFrom.slice(2)) : undefined;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (dates.length > 1 && !confirm(`Create ${dates.length} services: ${describeRepeat(form.date, form.repeat)} until ${fmtDate(form.until, { weekday: undefined })}?`)) return;
    setCreating(true);
    const st = types.find((t) => t.id === form.type);
    const problems: string[] = [];
    let firstId: string | null = null;
    for (const [i, date] of dates.entries()) {
      setProgress(dates.length > 1 ? `Creating ${i + 1} of ${dates.length}…` : "");
      const { data: plan, error } = await supabase
        .from("plans")
        .insert({
          service_date: date,
          service_type_id: st?.id ?? null,
          start_time: template?.start_time ?? orderTemplate?.start_time ?? st?.default_time ?? null,
          title: template?.title ?? null,
          ...(loc.locations.length ? { location_id: form.location || null } : {}),
        })
        .select()
        .single();
      if (error || !plan) {
        problems.push(`${date}: ${error?.message ?? "could not create"}`);
        continue;
      }
      firstId ??= plan.id;
      if (orderTemplate) {
        const err = await applyTemplate(supabase, orderTemplate, plan.id, "append");
        if (err) problems.push(`${date} order: ${err}`);
      }
      if (template && form.copyItems) {
        const err = await copyItems(supabase, template.id, plan.id);
        if (err) problems.push(`${date} order: ${err}`);
      }
      if (template && form.copyTimes) {
        const err = await copyTimes(supabase, template.id, template.service_date, plan.id, date);
        if (err && !/plan_times/.test(err)) problems.push(`${date} times: ${err}`);
      }
    }
    setCreating(false);
    setProgress("");
    if (problems.length) alert("Some services had problems:\n" + problems.join("\n"));
    if (dates.length === 1 && firstId) router.push(`/plans/${firstId}`);
    else {
      setReload((n) => n + 1);
      setPast(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Plans</h1>
        {me.isLeader && <Link href="/templates" className="btn-ghost text-sm">Order templates</Link>}
        <div className="ml-auto flex rounded-md border border-line bg-white p-0.5 text-sm">
          <button className={`rounded px-3 py-1 ${!past ? "bg-accent-soft text-accent" : "text-muted"}`} onClick={() => setPast(false)}>Upcoming</button>
          <button className={`rounded px-3 py-1 ${past ? "bg-accent-soft text-accent" : "text-muted"}`} onClick={() => setPast(true)}>Past</button>
        </div>
      </div>

      {me.isLeader && (
        <form onSubmit={create} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
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
            <label className="label">Repeats</label>
            <select className="input" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as Repeat })}>
              <option value="none">Doesn&apos;t repeat</option>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Every month (same weekday)</option>
            </select>
          </div>
          {form.repeat !== "none" && (
            <div>
              <label className="label">Until</label>
              <input type="date" className="input" min={form.date} value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} />
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="label">Start from</label>
            <select
              className="input"
              value={form.copyFrom}
              onChange={(e) => {
                setTouchedSource(true);
                setForm({ ...form, copyFrom: e.target.value });
              }}
            >
              <option value="">— Blank —</option>
              {templates.length > 0 && (
                <optgroup label="Templates">
                  {templates
                    .filter((t) => !t.location_id || !form.location || t.location_id === form.location)
                    .map((t) => <option key={t.id} value={`t:${t.id}`}>{t.is_default ? "★ " : ""}{t.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Copy an earlier service">
                {recent.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.service_date)} {r.title ? `· ${r.title}` : ""}</option>)}
              </optgroup>
            </select>
            {orderTemplate && (
              <p className="mt-1 text-xs text-muted">
                {orderTemplate.items.filter((x) => x.kind !== "header").length} items from the template. <Link href="/templates" className="text-accent">Edit templates</Link>
              </p>
            )}
            {template && (
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.copyItems} onChange={(e) => setForm({ ...form, copyItems: e.target.checked })} /> Order of service</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.copyTimes} onChange={(e) => setForm({ ...form, copyTimes: e.target.checked })} /> Times (services, rehearsal, call time)</label>
              </div>
            )}
          </div>
          <div className="flex flex-col justify-end gap-1 sm:col-span-2 lg:col-span-4">
            {dates.length > 1 && (
              <p className="text-sm text-muted">
                {describeRepeat(form.date, form.repeat)} → <b>{dates.length} services</b>: {dates.slice(0, 4).map((d) => fmtDate(d, { weekday: undefined, year: undefined })).join(", ")}
                {dates.length > 4 && `, … ${fmtDate(dates[dates.length - 1], { weekday: undefined, year: undefined })}`}. People aren&apos;t copied.
              </p>
            )}
            <button className="btn self-start" disabled={creating}>
              {creating ? progress || "Creating…" : dates.length > 1 ? `Create ${dates.length} services` : "New plan"}
            </button>
          </div>
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
