"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import Verified from "@/components/Verified";
import { fmtDate, nextSundayISO, todayISO } from "@/lib/format";
import type { AssignmentStatus, Blockout, Position, PositionMember, Profile, Team } from "@/lib/types";

type Hist = { profile_id: string; status: AssignmentStatus; position_id: string; plan_id: string; plans: { service_date: string; location_id: string | null } | null };
type Avail =
  | { kind: "free" }
  | { kind: "blocked"; reason: string | null }
  | { kind: "scheduled"; status: AssignmentStatus; position: string };

const initials = (p: Profile) =>
  (p.full_name || p.email || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function RosterPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [date, setDate] = useState(nextSundayISO());
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [t, pos, pm, ppl, bo, a] = await Promise.all([
      supabase.from("teams").select("*").order("sort"),
      supabase.from("positions").select("*").order("sort"),
      supabase.from("position_members").select("*"),
      supabase.from("profiles").select("*").neq("role", "pending").order("full_name"),
      supabase.from("blockouts").select("*").gte("ends_on", todayISO()),
      supabase.from("assignments").select("profile_id,status,position_id,plan_id,plans(service_date,location_id)"),
    ]);
    setTeams((t.data ?? []) as Team[]);
    setPositions(pos.data ?? []);
    setRoster(pm.data ?? []);
    setPeople((ppl.data ?? []) as Profile[]);
    setBlockouts(bo.data ?? []);
    setHist((a.data ?? []) as unknown as Hist[]);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  // Default the date to the next service that has been planned, if any.
  useEffect(() => {
    let qy = supabase.from("plans").select("service_date").gte("service_date", todayISO()).order("service_date").limit(1);
    if (loc.current) qy = qy.eq("location_id", loc.current);
    qy.then(({ data }) => data?.[0] && setDate(data[0].service_date));
  }, [loc.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const posName = (id: string) => positions.find((p) => p.id === id)?.name ?? "";

  const availability = useCallback(
    (pid: string): Avail => {
      const sched = hist.find((h) => h.profile_id === pid && h.plans?.service_date === date && (!loc.current || !h.plans?.location_id || h.plans.location_id === loc.current));
      if (sched) return { kind: "scheduled", status: sched.status, position: posName(sched.position_id) };
      const b = blockouts.find((x) => x.profile_id === pid && x.starts_on <= date && x.ends_on >= date);
      if (b) return { kind: "blocked", reason: b.reason };
      return { kind: "free" };
    },
    [hist, blockouts, date, loc.current, positions] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Track record over past services: accepted / declined / never answered.
  const record = useMemo(() => {
    const today = todayISO();
    const m = new Map<string, { yes: number; no: number; none: number }>();
    for (const h of hist) {
      if (!h.plans || h.plans.service_date >= today || h.status === "unsent") continue;
      const r = m.get(h.profile_id) ?? { yes: 0, no: 0, none: 0 };
      if (h.status === "accepted") r.yes++;
      else if (h.status === "declined") r.no++;
      else r.none++;
      m.set(h.profile_id, r);
    }
    return m;
  }, [hist]);

  async function toggleVerified(p: Profile) {
    const { error } = await supabase.from("profiles").update({ verified: !p.verified }).eq("id", p.id);
    if (error) return alert(/verified/.test(error.message) ? "This needs the database update 008_verified.sql. " + error.message : error.message);
    setPeople((xs) => xs.map((x) => (x.id === p.id ? { ...x, verified: !p.verified } : x)));
  }

  const matches = (p: Profile) =>
    (!onlyVerified || !!p.verified) &&
    (!loc.current || !p.location_id || p.location_id === loc.current) &&
    (!q.trim() || (p.full_name + " " + (p.email ?? "")).toLowerCase().includes(q.trim().toLowerCase()));

  const shownTeams = teams.filter((t) => !loc.current || !t.location_id || t.location_id === loc.current);
  const membersOf = (positionId: string) =>
    roster
      .filter((r) => r.position_id === positionId)
      .map((r) => people.find((p) => p.id === r.profile_id))
      .filter((p): p is Profile => !!p && matches(p))
      .sort((a, b) => Number(!!b.verified) - Number(!!a.verified) || (a.full_name || "").localeCompare(b.full_name || ""));
  const onAnyRoster = new Set(roster.map((r) => r.profile_id));
  const unassigned = people.filter((p) => !onAnyRoster.has(p.id) && matches(p));
  const verifiedCount = people.filter((p) => p.verified && matches({ ...p, verified: true })).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Roster</h1>
        <p className="text-sm text-muted">
          Everyone by role{loc.current ? ` at ${loc.name(loc.current)}` : ""}. <Verified on /> = confirmed member (reliable).
          {me.isAdmin && " Tap the check button to give or remove it."}
        </p>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Availability for</span>
          <input type="date" className="input w-auto" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="block min-w-[10rem] flex-1">
          <span className="label">Search</span>
          <input className="input" placeholder="Name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} /> Only confirmed <Verified on />
        </label>
      </div>

      {/* Quick counts by role */}
      {!loading && (
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">
            {people.filter(matches).length} people · {verifiedCount} <Verified on className="h-3.5 w-3.5" />
          </span>
          {shownTeams.flatMap((t) =>
            positions
              .filter((p) => p.team_id === t.id)
              .map((p) => {
                const ms = membersOf(p.id);
                const free = ms.filter((m) => availability(m.id).kind === "free").length;
                return (
                  <a key={p.id} href={`#pos-${p.id}`} className="rounded-full border border-line bg-white px-3 py-1 text-xs">
                    <b>{p.name}</b> {ms.length}
                    <span className="text-ok"> · {free} free</span>
                  </a>
                );
              })
          )}
        </div>
      )}

      {loading && <p className="text-sm text-muted">Loading…</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {shownTeams.map((t) => (
          <section key={t.id} className="card p-0">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="h2 flex-1">{t.name}</h2>
              <span className="text-xs font-bold uppercase text-muted">{t.location_id ? loc.name(t.location_id) : "Shared"}</span>
            </div>
            {positions
              .filter((p) => p.team_id === t.id)
              .map((pos) => {
                const ms = membersOf(pos.id);
                return (
                  <div key={pos.id} id={`pos-${pos.id}`} className="scroll-mt-24 border-b border-line last:border-0">
                    <div className="flex items-center gap-2 bg-stone-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                      <span className="flex-1">{pos.name}</span>
                      <span>{ms.length} {ms.length === 1 ? "person" : "people"}</span>
                    </div>
                    {ms.length === 0 && (
                      <p className="px-4 py-2 text-sm text-muted">
                        No one yet. {me.isLeader && <Link href="/teams" className="text-accent">Add people on Teams</Link>}
                      </p>
                    )}
                    <ul className="divide-y divide-line">
                      {ms.map((p) => (
                        <PersonRow key={p.id} p={p} avail={availability(p.id)} rec={record.get(p.id)} canVerify={me.isAdmin} onVerify={() => toggleVerified(p)} locName={loc.current ? "" : loc.name(p.location_id)} />
                      ))}
                    </ul>
                  </div>
                );
              })}
          </section>
        ))}
      </div>

      {unassigned.length > 0 && (
        <section className="card p-0">
          <div className="border-b border-line px-4 py-3">
            <h2 className="h2">Not on a team yet</h2>
            <p className="text-xs text-muted">Add them to a position on the Teams page so they show up when scheduling.</p>
          </div>
          <ul className="divide-y divide-line">
            {unassigned.map((p) => (
              <PersonRow key={p.id} p={p} avail={availability(p.id)} rec={record.get(p.id)} canVerify={me.isAdmin} onVerify={() => toggleVerified(p)} locName={loc.current ? "" : loc.name(p.location_id)} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted">Showing availability for {fmtDate(date, { weekday: "long", month: "long" })}. Block-out dates come from each person&apos;s My Profile page.</p>
    </div>
  );
}

function PersonRow({
  p,
  avail,
  rec,
  canVerify,
  onVerify,
  locName,
}: {
  p: Profile;
  avail: Avail;
  rec?: { yes: number; no: number; none: number };
  canVerify: boolean;
  onVerify: () => void;
  locName: string;
}) {
  const pill =
    avail.kind === "free"
      ? { text: "Free", cls: "bg-green-100 text-green-800" }
      : avail.kind === "blocked"
      ? { text: `Blocked out${avail.reason ? ` · ${avail.reason}` : ""}`, cls: "bg-red-100 text-red-800" }
      : {
          text: `${avail.position} · ${avail.status === "accepted" ? "Confirmed" : avail.status === "declined" ? "Declined" : avail.status === "pending" ? "Waiting" : "Not asked"}`,
          cls: avail.status === "accepted" ? "bg-sky-100 text-sky-800" : avail.status === "declined" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800",
        };
  const total = rec ? rec.yes + rec.no + rec.none : 0;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-200 text-xs font-bold text-stone-700">{initials(p)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 truncate font-medium">
          <span className="truncate">{p.full_name || p.email}</span>
          <Verified on={p.verified} />
          {locName && <span className="ml-1 text-[10px] font-bold uppercase text-muted">{locName}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium ${pill.cls}`}>{pill.text}</span>
          {total > 0 ? (
            <span className="text-muted" title="Past requests: accepted / declined / no answer">
              ✓{rec!.yes} ✕{rec!.no} ?{rec!.none}
            </span>
          ) : (
            <span className="text-muted">No history yet</span>
          )}
          {p.phone && <a href={`sms:${p.phone}`} className="text-accent">Text</a>}
        </div>
      </div>
      {canVerify && (
        <button
          onClick={onVerify}
          className={`shrink-0 rounded-sm px-2 py-1 text-xs font-bold ${p.verified ? "bg-[#1d9bf0] text-white" : "border border-line text-muted"}`}
          title={p.verified ? "Remove confirmed check" : "Mark as confirmed member"}
        >
          {p.verified ? "✓ Confirmed" : "Confirm"}
        </button>
      )}
    </li>
  );
}
