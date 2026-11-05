"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import Avatar, { displayName } from "@/components/Avatar";
import Verified from "@/components/Verified";
import { fmtDate, todayISO } from "@/lib/format";
import { fairFill, runIfBooked, type Booking } from "@/lib/fairfill";
import { addDays, copyTimes } from "@/lib/recur";
import { applyTemplate, loadTemplates } from "@/lib/templates";
import { isSongSlot, pickSongs, songUses, SONG_GAP_DAYS } from "@/lib/songgap";
import type { Assignment, Blockout, Plan, Position, PositionMember, Profile, Team } from "@/lib/types";

/** Bulk scheduling: a grid of positions × upcoming services, with fair auto-fill. */
export default function SchedulePage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [weeks, setWeeks] = useState(8);
  const [teamId, setTeamId] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [proposed, setProposed] = useState<Booking[]>([]);
  const [cell, setCell] = useState<{ planId: string; positionId: string } | null>(null);
  const [backToBack, setBackToBack] = useState(true);
  const [maxRow, setMaxRow] = useState(2);
  const datesFor = (pid: string, extra: Booking[] = []) => [...existingBookings(), ...proposed, ...extra].filter((b) => b.profileId === pid).map((b) => b.date);
  const [busy, setBusy] = useState("");
  const [serviceDay, setServiceDay] = useState(0); // 0 = Sunday

  const today = todayISO();
  const until = addDays(today, weeks * 7);

  const load = useCallback(async () => {
    let pq = supabase.from("plans").select("*").gte("service_date", today).lte("service_date", until).order("service_date");
    if (loc.current) pq = pq.eq("location_id", loc.current);
    const [p, t, pos, pm, ppl, bo] = await Promise.all([
      pq,
      supabase.from("teams").select("*").order("sort"),
      supabase.from("positions").select("*").order("sort"),
      supabase.from("position_members").select("*"),
      supabase.from("profiles").select("*").neq("role", "pending").order("full_name"),
      supabase.from("blockouts").select("*").gte("ends_on", today),
    ]);
    const ps = (p.data ?? []) as Plan[];
    setPlans(ps);
    const ts = ((t.data ?? []) as Team[]).filter((x) => !loc.current || !x.location_id || x.location_id === loc.current);
    setTeams(ts);
    setTeamId((cur) => (cur && ts.some((x) => x.id === cur) ? cur : ts[0]?.id ?? ""));
    setPositions(pos.data ?? []);
    setRoster(pm.data ?? []);
    setPeople((ppl.data ?? []) as Profile[]);
    setBlockouts(bo.data ?? []);
    if (ps.length) {
      const a = await supabase.from("assignments").select("*").in("plan_id", ps.map((x) => x.id));
      setAssignments((a.data ?? []) as Assignment[]);
    } else setAssignments([]);
  }, [weeks, loc.current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    setProposed([]);
  }, [load]);

  const teamPositions = positions.filter((p) => p.team_id === teamId);

  // Every service day in the range, whether or not a service exists yet.
  const dow = (d: string) => new Date(d + "T12:00:00").getDay();
  const expected = useMemo(() => {
    const out: string[] = [];
    let d = today;
    while (dow(d) !== serviceDay) d = addDays(d, 1);
    for (; d <= until; d = addDays(d, 7)) out.push(d);
    return out;
  }, [today, until, serviceDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = expected.filter((d) => !plans.some((p) => p.service_date === d));
  const dupes = [...new Set(plans.map((p) => p.service_date))].filter((d) => plans.filter((p) => p.service_date === d).length > 1);
  const offDay = plans.filter((p) => dow(p.service_date) !== serviceDay);
  const columns = [...plans.map((p) => ({ date: p.service_date, plan: p as Plan | null })), ...missing.map((d) => ({ date: d, plan: null as Plan | null }))].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

  async function createServices(dates: string[]) {
    if (!loc.current) return alert("Pick the location at the top first (e.g. Newfield), so the services are made for the right campus.");
    if (!dates.length) return;
    if (dates.length > 1 && !confirm(`Create ${dates.length} services for ${loc.name(loc.current)}? (${dates.map((d) => fmtDate(d, { weekday: undefined, year: undefined })).join(", ")})`)) return;
    // Start each from the location's standard template, with the title and times of the latest service there.
    const templates = await loadTemplates(supabase);
    const tpl = templates.find((t) => t.is_default && t.location_id === loc.current) ?? templates.find((t) => t.is_default && !t.location_id);
    const { data: last } = await supabase.from("plans").select("*").eq("location_id", loc.current).order("service_date", { ascending: false }).limit(1);
    const model = (last?.[0] ?? null) as Plan | null;
    const problems: string[] = [];
    for (const [i, date] of dates.entries()) {
      setBusy(`Creating ${i + 1} of ${dates.length}…`);
      const { data: plan, error } = await supabase
        .from("plans")
        .insert({ service_date: date, location_id: loc.current, title: model?.title ?? null, start_time: tpl?.start_time ?? model?.start_time ?? null, service_type_id: model?.service_type_id ?? null })
        .select()
        .single();
      if (error || !plan) {
        problems.push(`${date}: ${error?.message ?? "could not create"}`);
        continue;
      }
      if (tpl) {
        const err = await applyTemplate(supabase, tpl, plan.id, "append");
        if (err) problems.push(`${date} order: ${err}`);
      }
      if (model) await copyTimes(supabase, model.id, model.service_date, plan.id, date);
    }
    setBusy("");
    if (problems.length) alert("Some had problems:\n" + problems.join("\n"));
    load();
  }

  // Fill every service's empty "Song 1–4" slots, in date order, never repeating a song within 3 weeks.
  async function fillAllSongs() {
    if (!plans.length) return;
    const ids = plans.map((p) => p.id);
    const { data: its } = await supabase.from("plan_items").select("id,plan_id,kind,title,song_id").in("plan_id", ids);
    const items = (its ?? []) as { id: string; plan_id: string; kind: string; title: string; song_id: string | null }[];
    const slotsTotal = items.filter(isSongSlot).length;
    if (!slotsTotal) return alert('No empty song slots ("Song 1"…"Song 4") in these services. New services made from the standard template have them.');
    if (!confirm(`Pick songs for ${slotsTotal} empty song slot${slotsTotal === 1 ? "" : "s"} across ${plans.length} services?\n\nNo song repeats within 3 weeks; least recently played first. You can change any of them on the plan.`)) return;
    const { data: lib } = await supabase.from("songs").select("id,title,default_key").eq("archived", false);
    const library = (lib ?? []) as { id: string; title: string; default_key: string | null }[];
    const first = plans[0].service_date;
    const last = plans[plans.length - 1].service_date;
    const uses = await songUses(supabase, addDays(first, -SONG_GAP_DAYS * 4), addDays(last, SONG_GAP_DAYS), loc.current);
    let filled = 0;
    let short = 0;
    for (const [i, pl] of [...plans].sort((a, b) => a.service_date.localeCompare(b.service_date)).entries()) {
      setBusy(`Picking songs… ${i + 1}/${plans.length}`);
      const mine = items.filter((x) => x.plan_id === pl.id);
      const slots = mine.filter(isSongSlot);
      if (!slots.length) continue;
      const picks = pickSongs({ library, uses, date: pl.service_date, planId: pl.id, inPlan: mine.filter((x) => x.song_id).map((x) => x.song_id!), count: slots.length });
      short += slots.length - picks.length;
      for (const [j, sid] of picks.entries()) {
        const song = library.find((x) => x.id === sid)!;
        await supabase.from("plan_items").update({ kind: "song", song_id: song.id, title: song.title, song_key: song.default_key }).eq("id", slots[j].id);
        uses.push({ songId: song.id, planId: pl.id, date: pl.service_date });
        filled++;
      }
    }
    setBusy("");
    alert(`Picked ${filled} songs.${short ? ` ${short} slot${short === 1 ? "" : "s"} left empty: not enough songs are free under the 3-week rule. Add more songs to the library.` : ""}`);
  }

  async function deletePlan(pl: Plan) {
    const n = assignments.filter((a) => a.plan_id === pl.id).length;
    if (!confirm(`Delete the ${fmtDate(pl.service_date, { year: undefined })} service${pl.title ? ` "${pl.title}"` : ""}?${n ? ` ${n} people are booked on it.` : ""} This can't be undone.`)) return;
    const { error } = await supabase.from("plans").delete().eq("id", pl.id);
    if (error) return alert(error.message);
    load();
  }
  const planDate = (id: string) => plans.find((p) => p.id === id)?.service_date ?? "";
  const isBlocked = (pid: string, date: string) => blockouts.some((b) => b.profile_id === pid && b.starts_on <= date && b.ends_on >= date);
  const isVerified = (pid: string) => !!people.find((p) => p.id === pid)?.verified;
  const rosterFor = (posId: string) => roster.filter((r) => r.position_id === posId).map((r) => r.profile_id);
  const weightFor = (posId: string, pid: string) => roster.find((r) => r.position_id === posId && r.profile_id === pid)?.weight ?? 1;
  const levelTag = (posId: string, pid: string) => {
    const w = weightFor(posId, pid);
    return w >= 1 ? "" : w === 0 ? " (if needed)" : " (½)";
  };
  const name = (pid: string) => displayName(people.find((p) => p.id === pid));
  const at = (planId: string, positionId: string) => assignments.filter((a) => a.plan_id === planId && a.position_id === positionId);
  const prop = (planId: string, positionId: string) => proposed.filter((a) => a.planId === planId && a.positionId === positionId);

  const existingBookings = (): Booking[] =>
    assignments.map((a) => ({ planId: a.plan_id, positionId: a.position_id, profileId: a.profile_id, date: planDate(a.plan_id) }));

  function autoFill(only?: string[]) {
    const slots = plans.flatMap((pl) =>
      teamPositions
        .filter((pos) => !only || only.includes(pos.id))
        .flatMap((pos) => {
          const open = (pos.needed ?? 1) - at(pl.id, pos.id).length - prop(pl.id, pos.id).length;
          return Array.from({ length: Math.max(0, open) }, () => ({ planId: pl.id, date: pl.service_date, positionId: pos.id }));
        })
    );
    const candidates = Object.fromEntries(teamPositions.map((p) => [p.id, rosterFor(p.id)]));
    const filled = fairFill({ slots, candidates, existing: [...existingBookings(), ...proposed], blocked: isBlocked, verified: isVerified, avoidBackToBack: backToBack, maxInARow: maxRow, canDouble: (id) => !!positions.find((p) => p.id === id)?.can_double, weight: weightFor });
    setProposed([...proposed, ...filled]);
    const missing = slots.length - filled.length;
    if (!filled.length) alert(slots.length ? "No one on the roster for these positions is available. Add players to positions on People or Teams." : "Everything is already filled.");
    else if (missing) alert(`Suggested ${filled.length}. ${missing} spot${missing === 1 ? "" : "s"} still need someone (no one available).`);
  }

  function bookEveryWeek(positionId: string, profileId: string) {
    const add: Booking[] = [];
    let skipped = 0;
    let rested = 0;
    for (const pl of plans) {
      if (at(pl.id, positionId).some((a) => a.profile_id === profileId) || prop(pl.id, positionId).some((a) => a.profileId === profileId)) continue;
      const need = positions.find((p) => p.id === positionId)?.needed ?? 1;
      if (at(pl.id, positionId).length + prop(pl.id, positionId).length >= need) continue; // already full
      if (isBlocked(profileId, pl.service_date)) {
        skipped++;
        continue;
      }
      if (maxRow && runIfBooked(datesFor(profileId, add), pl.service_date) > maxRow) {
        rested++;
        continue;
      }
      add.push({ planId: pl.id, date: pl.service_date, positionId, profileId });
    }
    setProposed([...proposed, ...add]);
    const notes = [
      rested ? `${rested} week${rested === 1 ? "" : "s"} left open so ${name(profileId)} isn't on more than ${maxRow} weeks in a row. Use ⚖ Fill fairly to cover them.` : "",
      skipped ? `${skipped} week${skipped === 1 ? "" : "s"} skipped: blocked out.` : "",
    ].filter(Boolean);
    if (notes.length) alert(notes.join("\n"));
  }

  async function saveProposed() {
    if (!proposed.length) return;
    setBusy("Saving…");
    const { error } = await supabase.from("assignments").insert(proposed.map((b) => ({ plan_id: b.planId, position_id: b.positionId, profile_id: b.profileId })));
    setBusy("");
    if (error) return alert(error.message);
    setProposed([]);
    load();
  }

  async function bookOne(planId: string, positionId: string, profileId: string) {
    if (maxRow && runIfBooked(datesFor(profileId), planDate(planId)) > maxRow && !confirm(`${name(profileId)} would be on more than ${maxRow} weeks in a row. Book anyway?`)) return setCell(null);
    const { error } = await supabase.from("assignments").insert({ plan_id: planId, position_id: positionId, profile_id: profileId });
    if (error) return alert(error.message);
    setCell(null);
    load();
  }

  async function removeOne(id: string) {
    await supabase.from("assignments").delete().eq("id", id);
    load();
  }

  async function askAll() {
    const planIds = [...new Set(assignments.filter((a) => a.status === "unsent").map((a) => a.plan_id))];
    if (!planIds.length) return alert("Everyone booked has already been asked.");
    if (!confirm(`Ask everyone not yet asked to confirm, across ${planIds.length} service${planIds.length === 1 ? "" : "s"}?`)) return;
    let sent = 0;
    for (const [i, id] of planIds.entries()) {
      setBusy(`Asking… ${i + 1}/${planIds.length}`);
      const res = await fetch("/api/assignments/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: id }) });
      const body = await res.json().catch(() => ({}));
      sent += body.sent ?? 0;
    }
    setBusy("");
    alert(`Asked ${sent} ${sent === 1 ? "person" : "people"} to confirm.`);
    load();
  }

  // Fairness tally for this team in the range (booked + suggested).
  const tally = useMemo(() => {
    const ids = new Set(teamPositions.map((p) => p.id));
    // Count services, not roles: three jobs on one Sunday is still one service.
    const seen = new Map<string, Set<string>>();
    for (const b of [...existingBookings(), ...proposed]) {
      if (!ids.has(b.positionId)) continue;
      const set = seen.get(b.profileId) ?? new Set<string>();
      set.add(b.planId);
      seen.set(b.profileId, set);
    }
    const m = new Map([...seen].map(([pid, set]) => [pid, set.size]));
    const everyone = new Set([...teamPositions.flatMap((p) => rosterFor(p.id)), ...m.keys()]);
    return [...everyone].map((pid) => ({ pid, n: m.get(pid) ?? 0 })).sort((a, b) => b.n - a.n || name(a.pid).localeCompare(name(b.pid)));
  }, [assignments, proposed, teamId, positions, roster, people]); // eslint-disable-line react-hooks/exhaustive-deps


  // Related positions share one block in the grid: all vocals, all guitars.
  const BLOCKS = [
    { key: "vocals", label: "Vocals", test: (p: Position) => /vocal|bgv|vox|singer/i.test(p.name), first: /lead/i },
    { key: "guitars", label: "Guitars", test: (p: Position) => /guitar|acoustic|electric|\bag\b|\beg\b/i.test(p.name) && !/bass/i.test(p.name), first: /acoustic|\bag\b/i },
  ];
  const shortLabel = (p: Position) =>
    /lead/i.test(p.name) ? "Lead" : /backup|bgv|background/i.test(p.name) ? "Backup" : /acoustic|\bag\b/i.test(p.name) ? "Acoustic" : /electric|\beg\b/i.test(p.name) ? "Electric" : p.name;
  const groups: { key: string; label: string; positions: Position[] }[] = [];
  for (const pos of teamPositions) {
    const block = BLOCKS.find((b) => b.test(pos));
    if (!block) {
      groups.push({ key: pos.id, label: pos.name, positions: [pos] });
      continue;
    }
    if (groups.some((g) => g.key === block.key)) continue;
    const members = teamPositions.filter(block.test).sort((a, b) => Number(block.first.test(b.name)) - Number(block.first.test(a.name)));
    groups.push({ key: block.key, label: members.length > 1 ? block.label : members[0].name, positions: members });
  }

  const posName = (id: string) => positions.find((p) => p.id === id)?.name ?? "";
  const rolesOn = (planId: string, pid: string) => [
    ...assignments.filter((a) => a.plan_id === planId && a.profile_id === pid).map((a) => a.position_id),
    ...proposed.filter((b) => b.planId === planId && b.profileId === pid).map((b) => b.positionId),
  ];
  const Multi = ({ planId, pid }: { planId: string; pid: string }) => {
    const roles = rolesOn(planId, pid);
    return roles.length > 1 ? (
      <span className="shrink-0 rounded-full bg-violet-100 px-1.5 text-[10px] font-bold text-violet-800" title={roles.map(posName).join(" · ")}>
        ×{roles.length}
      </span>
    ) : null;
  };

  function renderCell(pl: Plan, pos: Position) {
    const here = at(pl.id, pos.id);
    const sug = prop(pl.id, pos.id);
    const open = cell?.planId === pl.id && cell.positionId === pos.id;
    const players = rosterFor(pos.id);
    return (
      <div className="space-y-1">
        {here.map((a) => (
          <div key={a.id} className="group flex items-center gap-1.5">
            <Avatar name={name(a.profile_id)} status={a.status} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{name(a.profile_id)}</span>
            <Multi planId={pl.id} pid={a.profile_id} />
            <button className="text-xs text-muted opacity-0 hover:text-bad group-hover:opacity-100" onClick={() => removeOne(a.id)} aria-label="Remove">✕</button>
          </div>
        ))}
        {sug.map((b) => (
          <div key={b.profileId} className="flex items-center gap-1.5 rounded border border-dashed border-accent bg-accent-soft/50 px-1 py-0.5">
            <Avatar name={name(b.profileId)} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{name(b.profileId)}</span>
            <Multi planId={pl.id} pid={b.profileId} />
            <button className="text-xs text-muted hover:text-bad" onClick={() => setProposed(proposed.filter((x) => x !== b))} aria-label="Remove suggestion">✕</button>
          </div>
        ))}
        {!open ? (
          <button
            className={`w-full rounded px-1 py-0.5 text-left text-[12px] ${here.length || sug.length ? "text-muted opacity-60 hover:opacity-100" : "italic text-stone-400 hover:bg-stone-50"}`}
            onClick={() => setCell({ planId: pl.id, positionId: pos.id })}
          >
            {(() => {
              const left = (pos.needed ?? 1) - here.length - sug.length;
              if (!here.length && !sug.length) return (pos.needed ?? 1) > 1 ? `Needs ${pos.needed}` : "Needs someone";
              return left > 0 ? `+ ${left} more needed` : "+ add";
            })()}
          </button>
        ) : (
          <select
            autoFocus
            className="w-full rounded border border-accent bg-white px-1 py-1 text-[12px]"
            value=""
            onBlur={() => setCell(null)}
            onChange={(e) => e.target.value && bookOne(pl.id, pos.id, e.target.value)}
          >
            <option value="">Choose…</option>
            <optgroup label={`Plays ${pos.name}`}>
              {people.filter((p) => players.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.verified ? "✓ " : ""}{displayName(p)}{levelTag(pos.id, p.id)}{isBlocked(p.id, pl.service_date) ? " (blocked out)" : ""}</option>
              ))}
            </optgroup>
            <optgroup label="Everyone else">
              {people.filter((p) => !players.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{displayName(p)}{isBlocked(p.id, pl.service_date) ? " (blocked out)" : ""}</option>
              ))}
            </optgroup>
          </select>
        )}
      </div>
    );
  }

  if (!me.isLeader) return <p className="text-muted">Only leaders can schedule.</p>;

  const unsent = assignments.filter((a) => a.status === "unsent" && teamPositions.some((p) => p.id === a.position_id)).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end gap-3 border-b border-line pb-4">
        <div className="flex-1">
          <Link href="/plans" className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">Plans</Link>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Scheduler</h1>
          <p className="text-sm text-muted">Book weeks ahead at once{loc.current ? ` for ${loc.name(loc.current)}` : ""}. People aren&apos;t booked until you tap Save.</p>
        </div>
        <label className="block">
          <span className="label">Team</span>
          <select className="input w-auto" value={teamId} onChange={(e) => { setTeamId(e.target.value); setProposed([]); }}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Look ahead</span>
          <select className="input w-auto" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[4, 8, 13, 26].map((w) => <option key={w} value={w}>{w === 13 ? "3 months" : w === 26 ? "6 months" : `${w} weeks`}</option>)}
          </select>
        </label>
      </header>

      {!loc.current && loc.locations.length > 1 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Tip: pick a location at the top (e.g. Newfield) so you only see that location&apos;s services.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          Services on
          <select className="rounded border border-line bg-white px-1 py-0.5 text-sm text-ink" value={serviceDay} onChange={(e) => setServiceDay(Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        {plans.length > 0 && (
          <button className="btn-secondary" disabled={!!busy} onClick={fillAllSongs} title="4 songs per service, no song again within 3 weeks">
            ♪ Fill songs for all services
          </button>
        )}
        {missing.length > 0 && (
          <button className="btn-secondary" disabled={!!busy} onClick={() => createServices(missing)}>
            {busy || `+ Create ${missing.length} missing service${missing.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      {(dupes.length > 0 || offDay.length > 0) && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {dupes.map((d) => (
            <p key={d}>
              ⚠ <b>{fmtDate(d, { year: undefined })}</b> has {plans.filter((p) => p.service_date === d).length} services. Delete the extra one with 🗑 at the top of its column.
            </p>
          ))}
          {offDay.map((p) => (
            <p key={p.id}>
              ⚠ <b>{fmtDate(p.service_date, { year: undefined })}</b> isn&apos;t on a {DAYS[serviceDay].slice(0, -1)}. If it was made by mistake, delete it with 🗑 at the top of its column.
            </p>
          ))}
        </div>
      )}

      {columns.length === 0 ? (
        <p className="card text-sm text-muted">
          No services in the next {weeks} weeks. <Link href="/plans" className="text-accent">Create them on Plans</Link> (choose &quot;Repeats every week&quot; to make them all at once).
        </p>
      ) : (
        <>
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => autoFill()}>⚖ Fill empty spots fairly</button>
            <label className="flex items-center gap-2 text-sm text-muted">
              Max weeks in a row
              <select className="rounded border border-line bg-white px-1 py-0.5 text-sm text-ink" value={maxRow} onChange={(e) => setMaxRow(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                <option value={0}>No limit</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={backToBack} onChange={(e) => setBackToBack(e.target.checked)} /> Prefer a week off between
            </label>
            <span className="flex-1" />
            {unsent > 0 && !proposed.length && (
              <button className="btn-secondary" disabled={!!busy} onClick={askAll}>{busy || `Ask ${unsent} to confirm`}</button>
            )}
          </div>

          {proposed.length > 0 && (
            <div className="sticky top-[57px] z-20 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft px-4 py-3 shadow-sm">
              <span className="flex-1 text-sm">
                <b>{proposed.length} suggested booking{proposed.length === 1 ? "" : "s"}</b> (dashed). Review, then save.
              </span>
              <button className="btn-secondary" onClick={() => setProposed([])}>Discard</button>
              <button className="btn" disabled={!!busy} onClick={saveProposed}>{busy || `Save ${proposed.length}`}</button>
            </div>
          )}

          {/* Grid */}
          <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="sticky left-0 z-10 min-w-[11rem] bg-white px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted">Position</th>
                  {columns.map(({ date, plan: pl }) => {
                    const warn = pl && (dow(date) !== serviceDay || dupes.includes(date));
                    return (
                      <th key={pl?.id ?? `missing-${date}`} className={`min-w-[9.5rem] border-l border-line px-2 py-2 text-left ${pl ? "" : "bg-stone-50"} ${warn ? "bg-amber-50" : ""}`}>
                        <div className="flex items-start gap-1">
                          <div className="flex-1">
                            <span className={`block text-[11px] font-bold uppercase ${warn ? "text-amber-700" : "text-muted"}`}>
                              {fmtDate(date, { weekday: "short", month: undefined, day: undefined, year: undefined })}
                              {warn && " ⚠"}
                            </span>
                            {pl ? (
                              <Link href={`/plans/${pl.id}`} className="font-display font-bold hover:text-accent">{fmtDate(date, { weekday: undefined, year: undefined })}</Link>
                            ) : (
                              <span className="font-display font-bold text-muted">{fmtDate(date, { weekday: undefined, year: undefined })}</span>
                            )}
                          </div>
                          {pl && warn && (
                            <button className="text-xs text-muted hover:text-bad" onClick={() => deletePlan(pl)} title="Delete this service" aria-label="Delete this service">🗑</button>
                          )}
                        </div>
                        {!pl && (
                          <button className="mt-1 text-[11px] font-semibold text-accent hover:underline" disabled={!!busy} onClick={() => createServices([date])}>+ Create service</button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} className="border-b border-line align-top last:border-0">
                    <th className="sticky left-0 z-10 bg-stone-50 px-3 py-2 text-left font-normal">
                      <div className="text-xs font-bold uppercase tracking-wide">{g.label}</div>
                      {g.positions.map((pos) => (
                        <div key={pos.id} className="text-[11px] text-muted">
                          {g.positions.length > 1 && <b className="font-semibold">{shortLabel(pos)}: </b>}
                          {rosterFor(pos.id).length} {rosterFor(pos.id).length === 1 ? "person" : "people"}
                          {(pos.needed ?? 1) > 1 && ` · needs ${pos.needed}`}
                          {g.positions.length === 1 && pos.can_double && " · can double up"}
                        </div>
                      ))}
                      <div className="mt-1 flex flex-col items-start gap-0.5">
                        <button className="text-[11px] font-semibold text-accent hover:underline" onClick={() => autoFill(g.positions.map((p) => p.id))}>⚖ Fill fairly</button>
                        <select
                          className="max-w-[10rem] rounded border border-line bg-white px-1 py-0.5 text-[11px]"
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const [posId, pid] = e.target.value.split("|");
                            bookEveryWeek(posId, pid);
                          }}
                        >
                          <option value="">Book as often as allowed…</option>
                          {g.positions.map((pos) => (
                            <optgroup key={pos.id} label={pos.name}>
                              {people
                                .filter((p) => rosterFor(pos.id).includes(p.id))
                                .map((p) => <option key={p.id} value={`${pos.id}|${p.id}`}>{p.verified ? "✓ " : ""}{displayName(p)}{levelTag(pos.id, p.id)}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </th>
                    {columns.map(({ date, plan: pl }) =>
                      !pl ? (
                        <td key={`missing-${date}`} className="border-l border-line bg-stone-50 px-2 py-1.5 text-[11px] italic text-stone-400">No service yet</td>
                      ) : (
                        <td key={pl.id} className="border-l border-line px-2 py-1.5">
                          <div className={g.positions.length > 1 ? "space-y-2" : ""}>
                            {g.positions.map((pos) => (
                              <div key={pos.id}>
                                {g.positions.length > 1 && <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{shortLabel(pos)}</div>}
                                {renderCell(pl, pos)}
                              </div>
                            ))}
                          </div>
                        </td>
                      )
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-line bg-stone-50 align-top">
                  <th className="sticky left-0 z-10 bg-stone-100 px-3 py-2 text-left font-normal">
                    <div className="text-xs font-bold uppercase tracking-wide">Who&apos;s serving</div>
                    <div className="text-[11px] text-muted">Each person once, with all their roles that day</div>
                  </th>
                  {columns.map(({ date, plan: pl }) => {
                    if (!pl) return <td key={`missing-${date}`} className="border-l border-line" />;
                    const ids = [...new Set([...assignments.filter((a) => a.plan_id === pl.id).map((a) => a.profile_id), ...proposed.filter((b) => b.planId === pl.id).map((b) => b.profileId)])];
                    const rows = ids
                      .map((pid) => ({ pid, roles: rolesOn(pl.id, pid) }))
                      .sort((a, b) => b.roles.length - a.roles.length || name(a.pid).localeCompare(name(b.pid)));
                    return (
                      <td key={pl.id} className="border-l border-line px-2 py-2">
                        <div className="mb-1 text-[11px] font-semibold text-muted">{ids.length} {ids.length === 1 ? "person" : "people"}</div>
                        <ul className="space-y-1">
                          {rows.map(({ pid, roles }) => (
                            <li key={pid} className={`rounded px-1 py-0.5 text-[12px] leading-tight ${roles.length > 1 ? "bg-violet-50" : ""}`}>
                              <span className="font-medium">{name(pid)}</span>
                              <span className="block text-[11px] text-muted">{roles.map(posName).join(" · ")}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Fairness */}
          <section className="card">
            <h2 className="h2 mb-1">How many services each person has</h2>
            <p className="mb-3 text-xs text-muted">Services in the next {weeks} weeks on this team, including suggestions (several roles on one Sunday count once).</p>
            <div className="flex flex-wrap gap-2">
              {tally.map(({ pid, n }) => (
                <span key={pid} className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-3 text-sm">
                  <Avatar name={name(pid)} size="sm" />
                  {name(pid)} <Verified on={isVerified(pid)} />
                  <b className={n === 0 ? "text-muted" : "text-accent"}>{n}</b>
                </span>
              ))}
              {!tally.length && <span className="text-sm text-muted">No one on this team&apos;s positions yet. Add players on People → Edit.</span>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
