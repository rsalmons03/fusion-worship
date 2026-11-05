"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/format";
import { copyTimes } from "@/lib/recur";

type PlanTime = { id: string; kind: "service" | "rehearsal" | "other"; label: string | null; day: string; starts: string | null; ends: string | null };
const GROUPS: [PlanTime["kind"], string][] = [
  ["service", "Service times"],
  ["rehearsal", "Rehearsal times"],
  ["other", "Other times"],
];

function dayParts(d: string) {
  const dt = new Date(d + "T12:00:00");
  return {
    dow: dt.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    date: dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }),
  };
}

/** Service / rehearsal / call times for a plan. */
export default function PlanTimes({
  planId,
  serviceDate,
  canEdit,
  locationId,
}: {
  planId: string;
  serviceDate: string;
  canEdit: boolean;
  locationId?: string | null;
}) {
  const supabase = createClient();
  const [times, setTimes] = useState<PlanTime[]>([]);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const [targets, setTargets] = useState<{ id: string; service_date: string; title: string | null; picked: boolean }[]>([]);
  const [replace, setReplace] = useState(true);
  const [copyBusy, setCopyBusy] = useState("");
  const [form, setForm] = useState({ kind: "service" as PlanTime["kind"], label: "", day: serviceDate, starts: "09:00", ends: "" });

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("plan_times").select("*").eq("plan_id", planId).order("day").order("starts");
    if (error) return setMissing(true);
    setTimes((data ?? []) as PlanTime[]);
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("plan_times").insert({
      plan_id: planId,
      kind: form.kind,
      label: form.label.trim() || null,
      day: form.day,
      starts: form.starts || null,
      ends: form.ends || null,
    });
    if (error) return alert(error.message);
    setAdding(false);
    setForm({ ...form, label: "", ends: "" });
    load();
  }

  async function openCopy() {
    setCopying(true);
    let q = supabase.from("plans").select("id,service_date,title").gt("service_date", serviceDate).order("service_date").limit(26);
    if (locationId) q = q.eq("location_id", locationId);
    const { data } = await q;
    setTargets(((data ?? []) as { id: string; service_date: string; title: string | null }[]).map((p) => ({ ...p, picked: true })));
  }

  async function doCopy() {
    const picked = targets.filter((t) => t.picked);
    if (!picked.length) return;
    const errors: string[] = [];
    for (const [i, t] of picked.entries()) {
      setCopyBusy(`Copying ${i + 1} of ${picked.length}…`);
      const err = await copyTimes(supabase, planId, serviceDate, t.id, t.service_date, replace);
      if (err) errors.push(`${t.service_date}: ${err}`);
    }
    setCopyBusy("");
    if (errors.length) alert("Some couldn't be copied:\n" + errors.join("\n"));
    else alert(`Times copied to ${picked.length} service${picked.length === 1 ? "" : "s"}.`);
    setCopying(false);
  }

  async function remove(t: PlanTime) {
    if (!confirm("Remove this time?")) return;
    await supabase.from("plan_times").delete().eq("id", t.id);
    load();
  }

  if (missing)
    return <p className="text-sm text-muted">Times need the database update <b>007_plan_times.sql</b>. Run it in Supabase, then reload.</p>;

  return (
    <div className="space-y-5">
      {GROUPS.map(([kind, heading]) => {
        const list = times.filter((t) => t.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind}>
            <h3 className="label mb-2">{heading}</h3>
            <div className="space-y-2">
              {list.map((t) => {
                const { dow, date } = dayParts(t.day);
                const span = [fmtTime(t.starts), fmtTime(t.ends)].filter(Boolean).join(" – ");
                return kind === "service" ? (
                  <div key={t.id} className="card flex items-center gap-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent font-display text-sm font-bold text-white">{dow}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-xl font-bold">{span || "Time TBD"}</div>
                      <div className="text-sm text-accent">{t.label ? `${t.label} · ` : ""}{date}</div>
                    </div>
                    {canEdit && <button className="btn-ghost text-bad" onClick={() => remove(t)} aria-label="Remove">✕</button>}
                  </div>
                ) : (
                  <div key={t.id} className="card flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{t.label || (kind === "rehearsal" ? "Rehearsal" : "Other")}</div>
                      <div className="text-sm">
                        <span className={`mr-2 rounded-sm px-1.5 py-0.5 text-xs font-bold text-white ${kind === "rehearsal" ? "bg-stone-700" : "bg-accent"}`}>{dow}</span>
                        <span className="text-muted">{date}</span> {span}
                      </div>
                    </div>
                    {canEdit && <button className="btn-ghost text-bad" onClick={() => remove(t)} aria-label="Remove">✕</button>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {!times.length && <p className="text-sm text-muted">No times added yet.</p>}
      {canEdit && times.length > 0 && !copying && (
        <button className="btn-secondary w-full" onClick={openCopy}>↻ Copy these times to upcoming services</button>
      )}
      {copying && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="h2 flex-1">Copy times to…</h3>
            <button className="btn-ghost" onClick={() => setCopying(false)}>Cancel</button>
          </div>
          <p className="text-sm text-muted">Each time moves with the service date. A rehearsal 4 days before stays 4 days before.</p>
          {targets.length === 0 ? (
            <p className="text-sm text-muted">No later services yet. Create them on the Plans page (you can make them repeat).</p>
          ) : (
            <>
              <div className="flex gap-3 text-sm">
                <button className="text-accent" onClick={() => setTargets(targets.map((t) => ({ ...t, picked: true })))}>Select all</button>
                <button className="text-muted" onClick={() => setTargets(targets.map((t) => ({ ...t, picked: false })))}>None</button>
              </div>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {targets.map((t) => (
                  <li key={t.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={t.picked} onChange={(e) => setTargets(targets.map((x) => (x.id === t.id ? { ...x, picked: e.target.checked } : x)))} />
                      {fmtDate(t.service_date, { weekday: "short", year: undefined })} {t.title && <span className="text-muted">· {t.title}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace times those services already have
              </label>
              <button className="btn" disabled={!!copyBusy || !targets.some((t) => t.picked)} onClick={doCopy}>
                {copyBusy || `Copy to ${targets.filter((t) => t.picked).length} services`}
              </button>
            </>
          )}
        </div>
      )}
      {canEdit &&
        (adding ? (
          <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Type</span>
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PlanTime["kind"] })}>
                <option value="service">Service</option>
                <option value="rehearsal">Rehearsal</option>
                <option value="other">Other (call time, sound check…)</option>
              </select>
            </label>
            <label className="block"><span className="label">Name (optional)</span><input className="input" placeholder={form.kind === "rehearsal" ? "Rehearsal Night" : form.kind === "other" ? "Call time" : "1st service"} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
            <label className="block"><span className="label">Date</span><input type="date" className="input" required value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label">Starts</span><input type="time" className="input" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></label>
              <label className="block"><span className="label">Ends</span><input type="time" className="input" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} /></label>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button className="btn">Add time</button>
              <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="btn-secondary w-full" onClick={() => setAdding(true)}>+ Add a time</button>
        ))}
    </div>
  );
}
