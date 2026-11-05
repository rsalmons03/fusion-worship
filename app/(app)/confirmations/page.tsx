"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import StatusChip from "@/components/StatusChip";
import Verified from "@/components/Verified";
import { fmtDate, fmtTime, planLabel, todayISO } from "@/lib/format";
import type { AssignmentStatus, Plan } from "@/lib/types";

type Row = {
  id: string;
  status: AssignmentStatus;
  responded_at: string | null;
  profile_id: string;
  profiles: { full_name: string; email: string | null; phone: string | null; verified?: boolean } | null;
  positions: { name: string; teams: { name: string } | null } | null;
};
type PlanRow = Plan & { assignments: Row[] };

const ORDER: AssignmentStatus[] = ["declined", "pending", "unsent", "accepted"];

export default function ConfirmationsPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase
      .from("plans")
      .select("*, assignments(id, status, responded_at, profile_id, profiles(*), positions(name, teams(name)))")
      .gte("service_date", todayISO())
      .order("service_date")
      .limit(30);
    if (loc.current) q = q.eq("location_id", loc.current);
    const { data } = await q;
    setPlans((data ?? []) as unknown as PlanRow[]);
    setLoading(false);
  }, [loc.current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  async function send(planId: string) {
    setSending(planId);
    const res = await fetch("/api/assignments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(null);
    if (!res.ok) alert(body.error ?? "Could not send requests");
    load();
  }

  async function setStatus(id: string, status: AssignmentStatus) {
    const { error } = await supabase.from("assignments").update({ status, responded_at: new Date().toISOString() }).eq("id", id);
    if (error) alert(error.message);
    load();
  }

  if (!me.isLeader) return <p className="text-muted">Only leaders can see confirmations. Your own requests are on the Home page.</p>;

  const totals = { accepted: 0, pending: 0, declined: 0, unsent: 0 } as Record<AssignmentStatus, number>;
  plans.forEach((p) => p.assignments.forEach((a) => totals[a.status]++));
  const shown = onlyOpen ? plans.filter((p) => p.assignments.some((a) => a.status !== "accepted")) : plans;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="h1">Confirmations</h1>
          <p className="text-sm text-muted">Who has confirmed they&apos;re serving at upcoming services{loc.current ? ` at ${loc.name(loc.current)}` : ""}.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only services that need attention
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Confirmed" value={totals.accepted} tone="text-ok" />
        <Stat label="Waiting" value={totals.pending} tone="text-warn" />
        <Stat label="Declined" value={totals.declined} tone="text-bad" />
        <Stat label="Not asked yet" value={totals.unsent} tone="text-muted" />
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {!loading && shown.length === 0 && (
        <p className="text-sm text-muted">{plans.length ? "Everyone is confirmed. 🎉" : "No upcoming services."}</p>
      )}

      {shown.map((p) => {
        const rows = [...p.assignments].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
        const c = (s: AssignmentStatus) => p.assignments.filter((a) => a.status === s).length;
        return (
          <section key={p.id} className="card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link href={`/plans/${p.id}`} className="min-w-0 flex-1 hover:text-accent">
                <div className="font-display font-bold">{planLabel(p)}</div>
                <div className="text-sm text-muted">
                  {!loc.current && p.location_id && `${loc.name(p.location_id)} · `}
                  {fmtDate(p.service_date, { weekday: "long", month: "long" })} {fmtTime(p.start_time)}
                </div>
              </Link>
              <span className="text-sm">
                <b className="text-ok">{c("accepted")}</b>/{p.assignments.length} confirmed
              </span>
              {c("unsent") > 0 && (
                <button className="btn" disabled={sending === p.id} onClick={() => send(p.id)}>
                  {sending === p.id ? "Sending…" : `Ask ${c("unsent")} to confirm`}
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">No one scheduled yet. <Link href={`/plans/${p.id}`} className="text-accent">Schedule the team</Link></p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {rows.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{a.profiles?.full_name || a.profiles?.email}</span> <Verified on={a.profiles?.verified} />
                      <span className="text-muted"> · {a.positions?.name}{a.positions?.teams?.name ? ` (${a.positions.teams.name})` : ""}</span>
                      {a.profiles?.phone && (
                        <a href={`sms:${a.profiles.phone}`} className="ml-2 text-xs text-accent">Text</a>
                      )}
                    </div>
                    <StatusChip status={a.status} />
                    <select
                      aria-label="Change status"
                      className="rounded-sm border border-line bg-white px-1 py-0.5 text-xs"
                      value=""
                      onChange={(e) => e.target.value && setStatus(a.id, e.target.value as AssignmentStatus)}
                    >
                      <option value="">Mark…</option>
                      <option value="accepted">Confirmed</option>
                      <option value="declined">Declined</option>
                      <option value="pending">Waiting</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card p-3">
      <div className={`font-display text-2xl font-extrabold ${tone}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
