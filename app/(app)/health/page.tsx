"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import Verified from "@/components/Verified";
import { fmtDate, todayISO } from "@/lib/format";
import { healthFor, monthsSince, RULES, type Health, type HistRow } from "@/lib/health";
import type { AssignmentStatus, PositionMember, Profile } from "@/lib/types";

type Row = {
  profile_id: string;
  status: AssignmentStatus;
  attendance?: "present" | "no_show" | null;
  plans: { service_date: string; location_id: string | null } | null;
};
type Person = Profile & { h: Health; months: number };

export default function HealthPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [people, setPeople] = useState<Profile[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [noAttendance, setNoAttendance] = useState(false);
  const [loading, setLoading] = useState(true);
  const today = todayISO();

  const load = useCallback(async () => {
    const [ppl, pm] = await Promise.all([
      supabase.from("profiles").select("*").neq("role", "pending").order("full_name"),
      supabase.from("position_members").select("*"),
    ]);
    let a = await supabase.from("assignments").select("profile_id,status,attendance,plans(service_date,location_id)");
    if (a.error) {
      setNoAttendance(true);
      a = (await supabase.from("assignments").select("profile_id,status,plans(service_date,location_id)")) as typeof a;
    }
    setPeople((ppl.data ?? []) as Profile[]);
    setRoster(pm.data ?? []);
    setRows((a.data ?? []) as unknown as Row[]);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const all: Person[] = useMemo(() => {
    const byPerson = new Map<string, HistRow[]>();
    for (const r of rows) {
      if (!r.plans) continue;
      if (loc.current && r.plans.location_id && r.plans.location_id !== loc.current) continue;
      const list = byPerson.get(r.profile_id) ?? [];
      list.push({ profile_id: r.profile_id, status: r.status, attendance: r.attendance, date: r.plans.service_date });
      byPerson.set(r.profile_id, list);
    }
    return people
      .filter((p) => !loc.current || !p.location_id || p.location_id === loc.current)
      .map((p) => ({ ...p, h: healthFor(byPerson.get(p.id) ?? [], today), months: monthsSince(p.member_since || p.created_at, today) }));
  }, [people, rows, loc.current, today]);

  const onTeam = new Set(roster.map((r) => r.profile_id));
  const needsBreak = all.filter((p) => p.h.streak >= RULES.breakAfterWeeks).sort((a, b) => b.h.streak - a.h.streak);
  const concern = all.filter(
    (p) => p.h.noShows90 >= RULES.concernNoShows90 || (p.h.acceptRate !== null && p.h.accepted + p.h.declined + p.h.noAnswer >= 3 && p.h.acceptRate < RULES.concernAcceptRate)
  );
  const ready = all.filter(
    (p) => !p.verified && p.months >= RULES.readyMonths && p.h.served >= RULES.readyServed && (p.h.acceptRate ?? 0) >= RULES.readyAcceptRate && p.h.noShows === 0
  );
  const quiet = all.filter((p) => onTeam.has(p.id) && !p.h.nextServing && (!p.h.lastServed || dayDiff(p.h.lastServed, today) > RULES.quietDays));

  async function toggleVerified(p: Profile) {
    const { error } = await supabase.from("profiles").update({ verified: !p.verified }).eq("id", p.id);
    if (error) return alert(error.message);
    setPeople((xs) => xs.map((x) => (x.id === p.id ? { ...x, verified: !p.verified } : x)));
  }

  if (!me.isLeader) return <p className="text-muted">Only leaders can see team health.</p>;

  const stat = (n: number, label: string, tone: string) => (
    <div className="card p-3">
      <div className={`font-display text-2xl font-extrabold ${tone}`}>{n}</div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Team health</h1>
        <p className="text-sm text-muted">
          Who needs a break, who&apos;s missing, and who&apos;s earned the <Verified on /> check{loc.current ? ` at ${loc.name(loc.current)}` : ""}.
        </p>
      </div>
      {noAttendance && (
        <p className="card border-amber-300 bg-amber-50 text-sm">No-show tracking needs the database update <b>009_attendance.sql</b>. Everything else below still works.</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat(needsBreak.length, "Need a break", "text-accent")}
        {stat(concern.length, "Attendance concerns", "text-bad")}
        {stat(ready.length, "Ready for ✓", "text-[#1d9bf0]")}
        {stat(quiet.length, "Not served lately", "text-muted")}
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}

      <Section
        icon="🔥"
        title="Needs a break"
        hint={`Scheduled ${RULES.breakAfterWeeks}+ weeks in a row (counting what's already planned).`}
        list={needsBreak}
        empty="No one is on a long streak."
        detail={(p) => `${p.h.streak} weeks in a row since ${fmtDate(p.h.streakFrom!, { weekday: undefined, year: undefined })}`}
      />
      <Section
        icon="⚠️"
        title="Attendance concerns"
        hint={`${RULES.concernNoShows90}+ no-shows in 90 days, or accepts under ${Math.round(RULES.concernAcceptRate * 100)}% of requests. Time for a conversation.`}
        list={concern}
        empty="No concerns right now."
        detail={(p) =>
          [
            p.h.noShows90 ? `${p.h.noShows90} no-show${p.h.noShows90 === 1 ? "" : "s"} (90 days)` : "",
            p.h.acceptRate !== null ? `accepts ${Math.round(p.h.acceptRate * 100)}%` : "",
            p.h.noAnswer ? `${p.h.noAnswer} never answered` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        action={(p) =>
          p.verified ? (
            <button className="btn-secondary py-1 text-xs" onClick={() => toggleVerified(p)} disabled={!me.isAdmin} title={me.isAdmin ? "" : "Admins only"}>
              Remove ✓
            </button>
          ) : null
        }
      />
      <Section
        icon="✅"
        title="Ready for the confirmed check"
        hint={`With the church ${RULES.readyMonths}+ months, served ${RULES.readyServed}+ times, accepts ${Math.round(RULES.readyAcceptRate * 100)}%+, no no-shows.`}
        list={ready}
        empty="No one new is ready yet."
        detail={(p) => `${p.months} months · served ${p.h.served} · accepts ${Math.round((p.h.acceptRate ?? 0) * 100)}%`}
        action={(p) =>
          me.isAdmin ? (
            <button className="rounded-sm bg-[#1d9bf0] px-2 py-1 text-xs font-bold text-white" onClick={() => toggleVerified(p)}>
              Give ✓
            </button>
          ) : null
        }
      />
      <Section
        icon="💤"
        title="Not served lately"
        hint={`On a team but not scheduled in ${RULES.quietDays}+ days. Check in or schedule them.`}
        list={quiet}
        empty="Everyone on a team has served recently."
        detail={(p) => (p.h.lastServed ? `Last served ${fmtDate(p.h.lastServed, { weekday: undefined })}` : "Hasn't served yet")}
      />

      {/* Everyone */}
      <section className="card overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3">
          <h2 className="h2">Everyone</h2>
        </div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-2 py-2">With us</th>
              <th className="px-2 py-2">Served</th>
              <th className="px-2 py-2">Accepts</th>
              <th className="px-2 py-2">No-shows</th>
              <th className="px-2 py-2">Streak</th>
              <th className="px-2 py-2">Next</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {all.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">
                  {p.full_name || p.email} <Verified on={p.verified} />
                </td>
                <td className="px-2 py-2 text-muted">{p.months ? `${p.months} mo` : "new"}</td>
                <td className="px-2 py-2">{p.h.served}</td>
                <td className="px-2 py-2">{p.h.acceptRate === null ? "—" : `${Math.round(p.h.acceptRate * 100)}%`}</td>
                <td className={`px-2 py-2 ${p.h.noShows ? "font-bold text-bad" : ""}`}>{p.h.noShows}</td>
                <td className={`px-2 py-2 ${p.h.streak >= RULES.breakAfterWeeks ? "font-bold text-accent" : ""}`}>{p.h.streak ? `${p.h.streak} wk` : "—"}</td>
                <td className="px-2 py-2 text-muted">{p.h.nextServing ? fmtDate(p.h.nextServing, { weekday: undefined, year: undefined }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">
        No-shows come from marking attendance on each plan&apos;s Teams tab after the service. &quot;With us&quot; uses each person&apos;s Member since date (set on People), or when they signed up.
      </p>
    </div>
  );
}

function dayDiff(a: string, b: string) {
  return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000);
}

function Section({
  icon,
  title,
  hint,
  list,
  empty,
  detail,
  action,
}: {
  icon: string;
  title: string;
  hint: string;
  list: Person[];
  empty: string;
  detail: (p: Person) => string;
  action?: (p: Person) => React.ReactNode;
}) {
  return (
    <section className="card p-0">
      <div className="border-b border-line px-4 py-3">
        <h2 className="h2">{icon} {title} <span className="text-muted">({list.length})</span></h2>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {p.full_name || p.email} <Verified on={p.verified} />
                </div>
                <div className="text-xs text-muted">{detail(p)}</div>
              </div>
              {p.phone && <a href={`sms:${p.phone}`} className="btn-ghost text-xs text-accent">Text</a>}
              {action?.(p)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
