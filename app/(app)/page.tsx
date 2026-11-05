"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import StatusChip from "@/components/StatusChip";
import { fmtDate, fmtTime, planLabel, todayISO } from "@/lib/format";
import type { Assignment, Plan } from "@/lib/types";

type MyAssignment = Assignment & { plans: Plan; positions: { name: string; teams: { name: string } } };

export default function Home() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [mine, setMine] = useState<MyAssignment[]>([]);
  const [plans, setPlans] = useState<(Plan & { plan_items: { count: number }[] })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const today = todayISO();
    const [a, p] = await Promise.all([
      supabase
        .from("assignments")
        .select("*, plans!inner(*), positions(name, teams(name))")
        .eq("profile_id", me.id)
        .neq("status", "unsent")
        .gte("plans.service_date", today),
      (loc.current
        ? supabase.from("plans").select("*, plan_items(count)").eq("location_id", loc.current)
        : supabase.from("plans").select("*, plan_items(count)")
      ).gte("service_date", today).order("service_date").limit(8),
    ]);
    const rows = ((a.data ?? []) as MyAssignment[]).sort((x, y) => x.plans.service_date.localeCompare(y.plans.service_date));
    setMine(rows);
    setPlans((p.data ?? []) as never);
    setLoading(false);
  }, [me.id, loc.current]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  async function respond(id: string, status: "accepted" | "declined") {
    await supabase.from("assignments").update({ status }).eq("id", id);
    load();
  }

  const needsAnswer = mine.filter((a) => a.status === "pending");

  return (
    <div className="space-y-6">
      <h1 className="h1">Welcome{me.full_name ? `, ${me.full_name.split(" ")[0]}` : ""}</h1>

      {needsAnswer.length > 0 && (
        <section className="card border-amber-300 bg-amber-50">
          <h2 className="h2 mb-3">Can you serve?</h2>
          <ul className="space-y-3">
            {needsAnswer.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.positions.name} · {a.positions.teams.name}</div>
                  <div className="text-sm text-muted">{fmtDate(a.plans.service_date)} {fmtTime(a.plans.start_time)}</div>
                </div>
                <button className="btn" onClick={() => respond(a.id, "accepted")}>Accept</button>
                <button className="btn-secondary" onClick={() => respond(a.id, "declined")}>Decline</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <h2 className="h2 mb-3">My schedule</h2>
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : mine.length === 0 ? (
            <p className="text-sm text-muted">You&apos;re not scheduled for any upcoming services.</p>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/plans/${a.plan_id}`} className="font-medium hover:text-accent">
                      {fmtDate(a.plans.service_date)}
                    </Link>
                    <div className="text-sm text-muted">{a.positions.name}{a.plans.location_id && ` · ${loc.name(a.plans.location_id)}`}</div>
                  </div>
                  <StatusChip status={a.status} />
                  {a.status === "accepted" && (
                    <Link href={`/live/${a.plan_id}`} className="btn-ghost">Stage view</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="h2">Upcoming services</h2>
            <Link href="/plans" className="btn-ghost">All plans →</Link>
          </div>
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted">
              No upcoming plans. {me.isLeader && <Link href="/plans" className="text-accent">Create one</Link>}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {plans.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <Link href={`/plans/${p.id}`} className="min-w-0 flex-1 hover:text-accent">
                    <div className="font-medium">{planLabel(p)}</div>
                    <div className="text-sm text-muted">
                      {fmtDate(p.service_date)} {fmtTime(p.start_time)} {!loc.current && p.location_id && `· ${loc.name(p.location_id)}`} {p.series && `· ${p.series}`}
                    </div>
                  </Link>
                  <span className="text-xs text-muted">{p.plan_items?.[0]?.count ?? 0} items</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
