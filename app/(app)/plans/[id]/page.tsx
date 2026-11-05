"use client";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import StatusChip from "@/components/StatusChip";
import Verified from "@/components/Verified";
import Avatar, { displayName } from "@/components/Avatar";
import SongListen from "@/components/SongListen";
import PlanTimes from "@/components/plan/PlanTimes";
import PlanFiles from "@/components/plan/PlanFiles";
import { applyTemplate, itemsToTemplate, loadTemplates } from "@/lib/templates";
import { addSeconds, fmtLen, lenPatch, parseLen, secOf } from "@/lib/duration";
import { KEYS } from "@/lib/chordpro";
import { fmtDate, fmtTime, planLabel, todayISO } from "@/lib/format";
import type {
  Assignment,
  Blockout,
  ItemKind,
  Plan,
  PlanItem,
  Position,
  PositionMember,
  Profile,
  ServiceType,
  Song,
  Team,
  OrderTemplate,
} from "@/lib/types";

type SongLite = Pick<Song, "id" | "title" | "author" | "default_key">;

export default function PlanPage() {
  const params = useParams<{ id: string }>();
  const planId = params.id;
  const me = useProfile();
  const loc = useLocations();
  const canEditAny = me.isLeader;
  const router = useRouter();
  const supabase = createClient();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [songs, setSongs] = useState<SongLite[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const TABS = ["Order", "Teams", "Times", "Notes", "Files"] as const;
  type Tab = (typeof TABS)[number];
  const [tab, setTab] = useState<Tab>("Order");
  const [showDetails, setShowDetails] = useState(false);
  const [editOrder, setEditOrder] = useState(false);
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  useEffect(() => {
    if (editOrder) loadTemplates(supabase).then(setTemplates);
  }, [editOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [planTimes, setPlanTimes] = useState<{ id: string; kind: string; label: string | null; day: string; starts: string | null; ends: string | null }[]>([]);
  const [neighbors, setNeighbors] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from("plan_items").select("*, songs(reference_url)").eq("plan_id", planId).order("position");
    setItems((data ?? []) as PlanItem[]);
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAssignments = useCallback(async () => {
    const { data } = await supabase.from("assignments").select("*").eq("plan_id", planId);
    setAssignments((data ?? []) as Assignment[]);
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
      if (!p) return setNotFound(true);
      setPlan(p as Plan);
      const [s, st, t, pos, pm, ppl, bo] = await Promise.all([
        supabase.from("songs").select("id,title,author,default_key").eq("archived", false).order("title"),
        supabase.from("service_types").select("*").order("name"),
        supabase.from("teams").select("*").order("sort"),
        supabase.from("positions").select("*").order("sort"),
        supabase.from("position_members").select("*"),
        supabase.from("profiles").select("*").neq("role", "pending").order("full_name"),
        supabase.from("blockouts").select("*").lte("starts_on", p.service_date).gte("ends_on", p.service_date),
      ]);
      setSongs((s.data ?? []) as SongLite[]);
      setTypes(st.data ?? []);
      setTeams(t.data ?? []);
      setPositions(pos.data ?? []);
      setRoster(pm.data ?? []);
      setPeople((ppl.data ?? []) as Profile[]);
      setBlockouts(bo.data ?? []);
    })();
    loadItems();
    loadAssignments();
  }, [planId, loadItems, loadAssignments]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from("plan_times").select("*").eq("plan_id", planId).order("day").order("starts").then(({ data, error }) => !error && setPlanTimes(data ?? []));
  }, [planId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Previous / next service (same location) for the ‹ › arrows.
  useEffect(() => {
    if (!plan) return;
    const base = () => {
      let q = supabase.from("plans").select("id");
      if (plan.location_id) q = q.eq("location_id", plan.location_id);
      return q;
    };
    Promise.all([
      base().lt("service_date", plan.service_date).order("service_date", { ascending: false }).limit(1),
      base().gt("service_date", plan.service_date).order("service_date").limit(1),
    ]).then(([a, b]) => setNeighbors({ prev: a.data?.[0]?.id ?? null, next: b.data?.[0]?.id ?? null }));
  }, [plan?.id, plan?.service_date, plan?.location_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markAttendance(id: string, attendance: "present" | "no_show" | null) {
    setAssignments((xs) => xs.map((x) => (x.id === id ? { ...x, attendance } : x)));
    const { error } = await supabase.from("assignments").update({ attendance }).eq("id", id);
    if (error) {
      alert(/attendance/.test(error.message) ? "Attendance needs the database update 009_attendance.sql. " + error.message : error.message);
      loadAssignments();
    }
  }

  async function loadTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    let mode: "replace" | "append" = "replace";
    if (items.length) {
      const replace = confirm(`Replace this plan's ${items.length} items with "${t.name}"?\n\nOK = replace · Cancel = add to the end`);
      mode = replace ? "replace" : "append";
    }
    const err = await applyTemplate(supabase, t, planId, mode);
    if (err) return alert(err);
    if (!plan?.start_time && t.start_time) savePlan({ start_time: t.start_time });
    loadItems();
  }

  async function saveAsTemplate() {
    if (!plan) return;
    const existing = templates.filter((t) => !t.location_id || t.location_id === plan.location_id);
    const name = prompt(
      `Save this order as a template.\nType a new name, or an existing one to overwrite it:${existing.length ? "\n• " + existing.map((t) => t.name).join("\n• ") : ""}`,
      existing.find((t) => t.is_default)?.name ?? `${loc.name(plan.location_id) || "Standard"} standard`
    );
    if (!name?.trim()) return;
    const rows = itemsToTemplate(items);
    const same = existing.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
    const { error } = same
      ? await supabase.from("order_templates").update({ items: rows, start_time: plan.start_time, updated_at: new Date().toISOString() }).eq("id", same.id)
      : await supabase.from("order_templates").insert({ name: name.trim(), location_id: plan.location_id, items: rows, start_time: plan.start_time, is_default: !existing.some((t) => t.is_default) });
    if (error) return alert(/order_templates/.test(error.message) ? "Templates need the database update 010_templates.sql. " + error.message : error.message);
    alert(same ? `Template "${same.name}" updated.` : `Saved as template "${name.trim()}".`);
    loadTemplates(supabase).then(setTemplates);
  }

  async function respond(id: string, status: "accepted" | "declined") {
    const { error } = await supabase.from("assignments").update({ status }).eq("id", id);
    if (error) alert(error.message);
    loadAssignments();
  }

  async function savePlan(patch: Partial<Plan>) {
    if (!plan) return;
    setPlan({ ...plan, ...patch });
    await supabase.from("plans").update(patch).eq("id", plan.id);
  }

  async function deletePlan() {
    if (!confirm("Delete this plan, its order of service and its schedule? This cannot be undone.")) return;
    await supabase.from("plans").delete().eq("id", planId);
    router.push("/plans");
  }

  // ── Order of service ──
  async function addItem(kind: ItemKind, song?: SongLite) {
    const position = (items.at(-1)?.position ?? 0) + 1;
    await supabase.from("plan_items").insert({
      plan_id: planId,
      position,
      kind,
      title: song?.title ?? (kind === "header" ? "New section" : "New item"),
      song_id: song?.id ?? null,
      song_key: song?.default_key ?? null,
      duration_min: kind === "song" ? 4 : kind === "item" ? 5 : null,
    });
    loadItems();
  }

  async function saveItem(id: string, patch: Partial<PlanItem>) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("plan_items").update(patch).eq("id", id);
    if (error && /duration_sec/.test(error.message)) {
      // Database without seconds yet (update 011): save whole minutes only.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { duration_sec, ...rest } = patch;
      await supabase.from("plan_items").update(rest).eq("id", id);
    } else if (error) alert(error.message);
  }

  async function removeItem(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    await supabase.from("plan_items").delete().eq("id", id);
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    const renumbered = next.map((x, i) => ({ ...x, position: i + 1 }));
    setItems(renumbered);
    await Promise.all(
      renumbered
        .filter((x, i) => x.id !== items[i].id || x.position !== items[i].position)
        .map((x) => supabase.from("plan_items").update({ position: x.position }).eq("id", x.id))
    );
  }

  const times = useMemo(() => {
    let t = plan?.start_time ?? null;
    return items.map((it) => {
      const at = t;
      const sec = secOf(it);
      if (t && sec) t = addSeconds(t, sec);
      return at;
    });
  }, [items, plan?.start_time]);
  const totalSec = items.reduce((n, x) => n + (secOf(x) ?? 0), 0);
  // Length of each section (from its header to the next one).
  const sectionSec = (i: number) => {
    let n = 0;
    for (let j = i + 1; j < items.length && items[j].kind !== "header"; j++) n += secOf(items[j]) ?? 0;
    return n;
  };

  // ── Scheduling ──
  const personName = (id: string) => displayName(people.find((x) => x.id === id));
  const blocked = new Set(blockouts.map((b) => b.profile_id));

  async function assign(positionId: string, profileId: string) {
    const { error } = await supabase.from("assignments").insert({ plan_id: planId, position_id: positionId, profile_id: profileId });
    if (error) alert(error.message);
    loadAssignments();
  }

  async function unassign(id: string) {
    setAssignments((xs) => xs.filter((x) => x.id !== id));
    await supabase.from("assignments").delete().eq("id", id);
  }

  async function sendRequests() {
    setSending(true);
    const res = await fetch("/api/assignments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) alert(body.error ?? "Could not send requests");
    else
      alert(
        body.inApp
          ? `Asked ${body.sent} ${body.sent === 1 ? "person" : "people"}. They'll see Accept / Decline when they sign in.`
          : `Sent ${body.sent} request${body.sent === 1 ? "" : "s"}.${body.failed ? ` ${body.failed} failed: ${body.errors.join("; ")}` : ""}`
      );
    loadAssignments();
  }

  const unsent = assignments.filter((a) => a.status === "unsent").length;

  if (notFound) return <p>Plan not found. <Link className="text-accent" href="/plans">Back to plans</Link></p>;
  if (!plan) return <p className="text-muted">Loading…</p>;
  const canEdit = canEditAny && (loc.canSwitch || plan.location_id === loc.current);

  const planTeams = teams.filter((t) => !t.location_id || !plan.location_id || t.location_id === plan.location_id);

  const myAssignments = assignments.filter((a) => a.profile_id === me.id);
  const isPast = plan.service_date <= todayISO();
  const posName = (id: string) => {
    const p = positions.find((x) => x.id === id);
    const t = teams.find((x) => x.id === p?.team_id);
    return { pos: p?.name ?? "", team: t?.name ?? "" };
  };
  const myTeamIds = new Set(myAssignments.map((a) => positions.find((p) => p.id === a.position_id)?.team_id));
  const orderedTeams = [...planTeams].sort((a, b) => Number(myTeamIds.has(b.id)) - Number(myTeamIds.has(a.id)));
  const songItems = items.filter((i) => i.kind === "song" && i.song_id).map((i) => ({ id: i.song_id!, title: i.title }));

  const teamAssignments = (teamId: string) => assignments.filter((a) => positions.some((p) => p.id === a.position_id && p.team_id === teamId));
  const statusOf = (a: Assignment) => (a.attendance === "no_show" ? "no_show" : a.status);

  const myRoles = myAssignments.length > 0 && (
    <div className="space-y-2">
      {myAssignments.map((a) => {
        const { pos, team } = posName(a.position_id);
        return (
          <div key={a.id} className="rounded-lg border border-line bg-white p-3 shadow-sm">
            <div className="flex items-center gap-3">
              <Avatar name={displayName(me)} status={a.status} />
              <div className="min-w-0 flex-1 text-sm leading-tight">
                <div className="font-semibold">{pos}</div>
                <div className="text-muted">{team}</div>
              </div>
              {a.status !== "pending" && a.status !== "unsent" && <StatusChip status={a.status} />}
            </div>
            {(a.status === "pending" || a.status === "unsent") && (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button className="btn py-1.5 text-xs" onClick={() => respond(a.id, "accepted")}>Accept</button>
                <button className="btn-secondary py-1.5 text-xs" onClick={() => respond(a.id, "declined")}>Decline</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-line pb-4">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <Link href="/plans" className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink print:hidden">
            {loc.name(plan.location_id) || "Plans"} · Services
          </Link>
          <h1 className="mt-0.5 font-display text-3xl font-extrabold tracking-tight">{planLabel(plan)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="flex overflow-hidden rounded-full border border-line bg-white print:hidden">
              <button className="px-3 py-1 text-muted hover:bg-stone-50 disabled:opacity-30" disabled={!neighbors.prev} onClick={() => neighbors.prev && router.push(`/plans/${neighbors.prev}`)} aria-label="Previous service">‹</button>
              <button className="border-l border-line px-3 py-1 text-muted hover:bg-stone-50 disabled:opacity-30" disabled={!neighbors.next} onClick={() => neighbors.next && router.push(`/plans/${neighbors.next}`)} aria-label="Next service">›</button>
            </span>
            <span className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold">
              <span className="sm:hidden">{fmtDate(plan.service_date, { weekday: "short", month: "short" })}</span>
              <span className="hidden sm:inline">{fmtDate(plan.service_date, { weekday: "long", month: "long" })}</span>
            </span>
            {plan.start_time && <span className="text-sm text-muted">{fmtTime(plan.start_time)}</span>}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto print:hidden">
          <Link href={`/plans/${plan.id}/player`} className="btn flex-1 sm:flex-none">▶ Rehearse</Link>
          <button className="btn-secondary" onClick={() => window.print()} aria-label="Print">🖨</button>
          {canEdit && (
            <button className="btn-secondary" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>
              {showDetails ? "Done" : "⚙ Details"}
            </button>
          )}
        </div>
      </header>

      {canEdit && showDetails && (
        <section className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:hidden">
          {loc.locations.length > 0 && (
            <Field label="Location">
              <select className="input" value={plan.location_id ?? ""} disabled={!loc.canSwitch} onChange={(e) => savePlan({ location_id: e.target.value || null })}>
                <option value="">—</option>
                {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Title">
            <input className="input" defaultValue={plan.title ?? ""} placeholder="e.g. Easter Sunday" onBlur={(e) => savePlan({ title: e.target.value || null })} />
          </Field>
          <Field label="Series">
            <input className="input" defaultValue={plan.series ?? ""} onBlur={(e) => savePlan({ series: e.target.value || null })} />
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={plan.service_date} onChange={(e) => e.target.value && savePlan({ service_date: e.target.value })} />
          </Field>
          <Field label="Start time">
            <input type="time" className="input" value={plan.start_time?.slice(0, 5) ?? ""} onChange={(e) => savePlan({ start_time: e.target.value || null })} />
          </Field>
          <Field label="Service type">
            <select className="input" value={plan.service_type_id ?? ""} onChange={(e) => savePlan({ service_type_id: e.target.value || null })}>
              <option value="">—</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button className="btn-secondary text-bad" onClick={deletePlan}>Delete this plan</button>
          </div>
        </section>
      )}


      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
        {/* Side panel (computers) */}
        <aside className="hidden space-y-6 lg:block print:hidden">
          {myRoles && (
            <section>
              <h2 className="label mb-2">Your role</h2>
              {myRoles}
            </section>
          )}
          <section>
            <button className="label mb-2 hover:text-ink" onClick={() => setTab("Times")}>🕘 Times</button>
            {planTimes.length === 0 ? (
              <p className="text-sm text-muted">{plan.start_time ? `Service ${fmtTime(plan.start_time)}` : "No times yet"}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {planTimes.map((t) => (
                  <li key={t.id} className="flex gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.kind === "service" ? "bg-accent" : t.kind === "rehearsal" ? "bg-stone-700" : "bg-stone-400"}`} />
                    <span>
                      <span className="font-medium">{t.label || (t.kind === "service" ? "Service" : t.kind === "rehearsal" ? "Rehearsal" : "Other")}</span>
                      <span className="block text-xs text-muted">
                        {fmtDate(t.day, { year: undefined })} · {[fmtTime(t.starts), fmtTime(t.ends)].filter(Boolean).join("–")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <button className="label mb-2 hover:text-ink" onClick={() => setTab("Teams")}>👥 Teams</button>
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              {orderedTeams.map((team) => {
                const list = teamAssignments(team.id);
                if (!list.length) return null;
                return (
                  <div key={team.id} className="border-b border-line last:border-0">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 text-sm font-bold">{team.name}</span>
                      <TeamCounts list={list} small />
                    </div>
                    {positions.filter((p) => p.team_id === team.id).map((pos) => {
                      const here = assignments.filter((a) => a.position_id === pos.id);
                      if (!here.length) return null;
                      return (
                        <div key={pos.id}>
                          <div className="bg-stone-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{pos.name}</div>
                          {here.map((a) => (
                            <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                              <Avatar name={personName(a.profile_id)} status={statusOf(a)} size="sm" />
                              <span className="truncate">{personName(a.profile_id)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!assignments.length && <p className="px-3 py-2 text-sm text-muted">No one scheduled yet.</p>}
            </div>
          </section>
        </aside>

        {/* Main */}
        <div className="min-w-0 space-y-5">
          {myRoles && <div className="lg:hidden">{myRoles}</div>}

          {/* Tabs */}
          <div className="sticky top-[57px] z-10 -mx-4 flex overflow-x-auto border-b border-line bg-paper px-4 lg:mx-0 lg:px-0 print:hidden">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === t ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Order" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <Link href={`/plans/${plan.id}/player`} className="btn-secondary">▶ Play</Link>
                <Link href={`/live/${plan.id}`} className="btn-secondary">📡 Live</Link>
                <span className="text-sm text-muted">{items.filter((i) => i.kind !== "header").length} items{totalSec > 0 && ` · ${fmtLen(totalSec)}`}</span>
                {canEdit && (
                  <button className={`ml-auto ${editOrder ? "btn" : "btn-secondary"}`} onClick={() => setEditOrder(!editOrder)}>
                    {editOrder ? "✓ Done editing" : "✏ Edit order"}
                  </button>
                )}
              </div>

              <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] border-b border-line bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-muted">
                  <span>Length</span>
                  <span>Title</span>
                </div>
                {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">Nothing here yet.{canEdit && " Tap ✏ Edit order to add songs and items."}</p>}
                {editOrder ? (
                  <ul>
                    {items.map((it, i) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        time={times[i]}
                        canEdit
                        first={i === 0}
                        last={i === items.length - 1}
                        onSave={(patch) => saveItem(it.id, patch)}
                        onRemove={() => removeItem(it.id)}
                        onMove={(d) => move(i, d)}
                        songs={songs}
                      />
                    ))}
                  </ul>
                ) : (
                  <ul>
                    {items.map((it, i) =>
                      it.kind === "header" ? (
                        <li key={it.id} className="flex border-b border-line bg-stone-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink">
                          <span className="flex-1">{it.title}</span>
                          {sectionSec(i) > 0 && <span className="font-semibold tabular-nums text-muted">{fmtLen(sectionSec(i))}</span>}
                        </li>
                      ) : (
                        <ViewRow key={it.id} item={it} start={times[i]} length={fmtLen(secOf(it) ?? 0)} />
                      )
                    )}
                  </ul>
                )}
                {editOrder && <AddBar songs={songs} onAdd={addItem} />}
                {editOrder && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-stone-50 px-4 py-3 print:hidden">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Templates</span>
                    <select className="input w-auto py-1.5 text-sm" value="" onChange={(e) => e.target.value && loadTemplate(e.target.value)}>
                      <option value="">Load a template…</option>
                      {templates
                        .filter((t) => !t.location_id || t.location_id === plan.location_id)
                        .map((t) => <option key={t.id} value={t.id}>{t.is_default ? "★ " : ""}{t.name}</option>)}
                    </select>
                    <button className="btn-secondary py-1.5 text-sm" onClick={saveAsTemplate} disabled={!items.length}>Save as template</button>
                    <Link href="/templates" className="text-sm text-accent">Manage templates</Link>
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === "Teams" && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <TeamCounts list={assignments} big />
                {canEdit && (
                  <button className="btn ml-auto print:hidden" disabled={!unsent || sending} onClick={sendRequests} title="Ask everyone marked 'Not sent' to confirm">
                    {sending ? "Sending…" : `Send requests${unsent ? ` (${unsent})` : ""}`}
                  </button>
                )}
              </div>
              {isPast && canEdit && <p className="text-sm text-muted print:hidden">After the service: tap <b>Here</b> or <b>No-show</b> for each person. No-shows count toward Team health.</p>}
              {planTeams.length === 0 && <p className="text-sm text-muted">No teams yet. <Link href="/teams" className="text-accent">Set up teams</Link></p>}
              {people.some((p) => !p.full_name?.trim()) && canEdit && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Some people don&apos;t have a name yet, so a name is made from their email. <Link href="/people" className="font-semibold underline">Add names on People</Link>.
                </p>
              )}
              <div className="grid gap-4 xl:grid-cols-2">
                {orderedTeams.map((team) => (
                  <div key={team.id} className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
                      <h3 className="flex-1 font-display text-lg font-bold">
                        {team.name}
                        {myTeamIds.has(team.id) && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-[10px] font-bold uppercase text-accent">My team</span>}
                      </h3>
                      <TeamCounts list={teamAssignments(team.id)} />
                    </div>
                    {positions.filter((p) => p.team_id === team.id).map((pos) => {
                      const here = assignments.filter((a) => a.position_id === pos.id);
                      const rosterIds = new Set(roster.filter((r) => r.position_id === pos.id).map((r) => r.profile_id));
                      const taken = new Set(here.map((a) => a.profile_id));
                      const choices = people.filter((p) => !taken.has(p.id)).sort((x, y) => Number(!!y.verified) - Number(!!x.verified));
                      const adding = addingTo === pos.id;
                      return (
                        <div key={pos.id} className="border-b border-line last:border-0">
                          <div className="flex items-center gap-2 bg-stone-50 px-4 py-1.5">
                            <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">{pos.name}</span>
                            {canEdit && (
                              <button className="text-xs font-semibold text-accent hover:underline print:hidden" onClick={() => setAddingTo(adding ? null : pos.id)}>
                                {adding ? "Cancel" : "+ Add"}
                              </button>
                            )}
                          </div>
                          {here.map((a) => (
                            <div key={a.id} className="group flex items-center gap-3 px-4 py-2">
                              <Avatar name={personName(a.profile_id)} status={statusOf(a)} />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {personName(a.profile_id)} <Verified on={people.find((x) => x.id === a.profile_id)?.verified} />
                                {blocked.has(a.profile_id) && <span className="ml-1 text-xs font-normal text-bad">blocked out</span>}
                              </span>
                              {isPast && canEdit && a.status === "accepted" ? (
                                <span className="flex overflow-hidden rounded-full border border-line text-xs font-semibold print:hidden">
                                  <button className={`px-2.5 py-0.5 ${a.attendance === "present" ? "bg-ok text-white" : "text-muted"}`} onClick={() => markAttendance(a.id, a.attendance === "present" ? null : "present")}>Here</button>
                                  <button className={`border-l border-line px-2.5 py-0.5 ${a.attendance === "no_show" ? "bg-bad text-white" : "text-muted"}`} onClick={() => markAttendance(a.id, a.attendance === "no_show" ? null : "no_show")}>No-show</button>
                                </span>
                              ) : a.attendance === "no_show" ? (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">No-show</span>
                              ) : (
                                <StatusChip status={a.status} />
                              )}
                              {canEdit && (
                                <button className="text-muted opacity-60 hover:text-bad hover:opacity-100 print:hidden" onClick={() => unassign(a.id)} aria-label={`Remove ${personName(a.profile_id)}`}>✕</button>
                              )}
                            </div>
                          ))}
                          {!here.length && !adding && <p className="px-4 py-2 text-sm italic text-stone-400">Needs someone</p>}
                          {adding && (
                            <div className="px-4 py-2 print:hidden">
                              <select
                                autoFocus
                                className="input py-1.5 text-sm"
                                value=""
                                onChange={(e) => {
                                  if (!e.target.value) return;
                                  assign(pos.id, e.target.value);
                                  setAddingTo(null);
                                }}
                              >
                                <option value="">Choose who to schedule…</option>
                                <optgroup label={`Plays ${pos.name}`}>
                                  {choices.filter((p) => rosterIds.has(p.id)).map((p) => (
                                    <option key={p.id} value={p.id}>{p.verified ? "✓ " : ""}{displayName(p)}{blocked.has(p.id) ? " (blocked out)" : ""}</option>
                                  ))}
                                </optgroup>
                                <optgroup label="Everyone else">
                                  {choices.filter((p) => !rosterIds.has(p.id)).map((p) => (
                                    <option key={p.id} value={p.id}>{p.verified ? "✓ " : ""}{displayName(p)}{blocked.has(p.id) ? " (blocked out)" : ""}</option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "Times" && <PlanTimes planId={plan.id} serviceDate={plan.service_date} canEdit={canEdit} locationId={plan.location_id} />}

      {tab === "Notes" && (
        <div className="space-y-4">
          {canEdit ? (
            <div className="card">
              <div className="label">Notes for the team</div>
              <textarea className="input mt-1" rows={6} defaultValue={plan.notes ?? ""} placeholder="Dress code, parking, anything the team should know…" onBlur={(e) => savePlan({ notes: e.target.value || null })} />
              <p className="mt-1 text-xs text-muted">Saves when you tap outside the box.</p>
            </div>
          ) : plan.notes ? (
            <div className="card whitespace-pre-wrap">{plan.notes}</div>
          ) : (
            <p className="text-sm text-muted">No notes for this service.</p>
          )}
          {items.some((i) => i.description) && (
            <div className="card">
              <div className="label mb-2">Item notes</div>
              <ul className="space-y-2 text-sm">
                {items.filter((i) => i.description).map((i) => (
                  <li key={i.id}><b>{i.title}:</b> <span className="whitespace-pre-wrap text-muted">{i.description}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

          {tab === "Files" && <PlanFiles planId={plan.id} songs={songItems} />}
        </div>
      </div>
    </div>
  );
}

/** Read-only order-of-service row: length, title, notes, song key and a listen button. */
function ViewRow({ item, start, length }: { item: PlanItem; start: string | null; length: string }) {
  const [listening, setListening] = useState(false);
  return (
    <li className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 border-b border-line px-4 py-3 last:border-0">
      <div className="text-sm tabular-nums">
        <div className="font-semibold">{length}</div>
        {start && <div className="text-xs text-muted">{fmtTime(start)}</div>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {item.kind === "song" ? (
            <>
              <Link href={`/songs/${item.song_id}`} className="font-semibold hover:text-accent">{item.title}</Link>
              {item.song_key && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">{item.song_key}</span>}
            </>
          ) : (
            <span className="text-sm font-semibold uppercase tracking-wide">{item.title}</span>
          )}
        </div>
        {item.description && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">{item.description}</p>}
        {item.song_id && (
          <button className="mt-1 text-xs font-semibold text-accent hover:underline print:hidden" onClick={() => setListening(!listening)}>
            {listening ? "▾ Hide player" : "▶ Listen"}
          </button>
        )}
        {item.song_id && listening && (
          <div className="pt-2 print:hidden">
            <SongListen songId={item.song_id} referenceUrl={(item as PlanItem & { songs?: { reference_url: string | null } | null }).songs?.reference_url} showEmptyNote />
          </div>
        )}
      </div>
    </li>
  );
}

function TeamCounts({ list, big = false, small = false }: { list: Assignment[]; big?: boolean; small?: boolean }) {
  const n = (s: string) => list.filter((a) => a.status === s).length;
  const cls = big ? "text-base" : small ? "text-xs gap-2" : "text-sm";
  return (
    <span className={`flex items-center gap-3 font-sans font-semibold ${cls}`}>
      <span className="text-ok" title="Confirmed">✓ {n("accepted")}</span>
      <span className="text-bad" title="Declined">✕ {n("declined")}</span>
      <span className="text-amber-600" title="Waiting / not asked">? {n("pending") + n("unsent")}</span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function ItemRow({
  item,
  time,
  canEdit,
  first,
  last,
  onSave,
  onRemove,
  onMove,
  songs = [],
}: {
  item: PlanItem;
  time: string | null;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onSave: (p: Partial<PlanItem>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  songs?: SongLite[];
}) {
  const [listening, setListening] = useState(false);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const isSlot = item.kind === "item" && /^(song\b|closing song|worship song)/i.test(item.title.trim());
  const found = q.trim() ? songs.filter((s) => `${s.title} ${s.author ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  const pick = (s: SongLite) => {
    onSave({ kind: "song", song_id: s.id, title: s.title, song_key: s.default_key });
    setPicking(false);
    setQ("");
  };
  if (item.kind === "header") {
    return (
      <li className="flex items-center gap-2 border-b border-line bg-stone-50 px-4 py-2">
        {canEdit ? (
          <input className="flex-1 bg-transparent text-xs font-bold uppercase tracking-wider outline-none" defaultValue={item.title} onBlur={(e) => e.target.value !== item.title && onSave({ title: e.target.value })} />
        ) : (
          <span className="flex-1 text-xs font-bold uppercase tracking-wider">{item.title}</span>
        )}
        {canEdit && <Controls first={first} last={last} onMove={onMove} onRemove={onRemove} />}
      </li>
    );
  }
  return (
    <li className="flex gap-3 border-b border-line px-4 py-3">
      <div className="w-16 shrink-0 pt-1 text-right font-mono text-xs text-muted">{time ? fmtTime(time) : ""}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.kind === "song" && <span className="text-accent" title="Song">♪</span>}
          {canEdit && item.kind !== "song" ? (
            <input className="min-w-0 flex-1 bg-transparent font-medium outline-none" defaultValue={item.title} onBlur={(e) => e.target.value !== item.title && onSave({ title: e.target.value })} />
          ) : item.song_id ? (
            <Link href={`/songs/${item.song_id}`} className="font-medium hover:text-accent">{item.title}</Link>
          ) : (
            <span className="font-medium">{item.title}</span>
          )}
          {item.kind === "song" &&
            (canEdit ? (
              <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={item.song_key ?? ""} onChange={(e) => onSave({ song_key: e.target.value || null })}>
                <option value="">Key</option>
                {[...new Set([...(item.song_key ? [item.song_key] : []), ...KEYS, ...KEYS.map((k) => k + "m")])].map((k) => <option key={k}>{k}</option>)}
              </select>
            ) : (
              item.song_key && <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">{item.song_key}</span>
            ))}
        </div>
        {canEdit ? (
          <textarea
            className="w-full resize-none bg-transparent text-sm text-muted outline-none placeholder:text-stone-300"
            rows={Math.max(1, (item.description ?? "").split("\n").length)}
            placeholder="Notes (who's leading, transitions, cues)…"
            defaultValue={item.description ?? ""}
            onInput={(e) => {
              const el = e.currentTarget;
              el.rows = Math.max(1, el.value.split("\n").length);
            }}
            onBlur={(e) => e.target.value !== (item.description ?? "") && onSave({ description: e.target.value || null })}
          />
        ) : (
          item.description && <p className="whitespace-pre-wrap text-sm text-muted">{item.description}</p>
        )}
        {canEdit && (isSlot || item.kind === "song") && (
          <div className="print:hidden">
            {!picking ? (
              <button className={`${isSlot ? "btn py-1 text-xs" : "btn-ghost -ml-2 text-xs"}`} onClick={() => setPicking(true)}>
                ♪ {isSlot ? "Pick song" : "Change song"}
              </button>
            ) : (
              <div className="relative max-w-sm">
                <input autoFocus className="input py-1.5 text-sm" placeholder="Search the song library…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setPicking(false)} />
                {found.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-white shadow-lg">
                    {found.map((s) => (
                      <li key={s.id}>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent-soft" onClick={() => pick(s)}>
                          <span className="flex-1">{s.title} <span className="text-muted">{s.author}</span></span>
                          {s.default_key && <span className="text-xs text-muted">{s.default_key}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="mt-1 text-xs text-muted" onClick={() => setPicking(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}
        {item.song_id && (
          <button className="btn-ghost -ml-2 text-xs print:hidden" onClick={() => setListening(!listening)}>
            {listening ? "▾ Hide player" : "▶ Listen"}
          </button>
        )}
        {item.song_id && listening && (
          <div className="pt-1 print:hidden">
            <SongListen songId={item.song_id} referenceUrl={(item as PlanItem & { songs?: { reference_url: string | null } | null }).songs?.reference_url} showEmptyNote />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {canEdit ? (
          <input
            className="w-16 rounded border border-line px-1 py-0.5 text-right text-xs tabular-nums"
            title="Length (m:ss)"
            placeholder="m:ss"
            defaultValue={fmtLen(secOf(item))}
            onBlur={(e) => {
              const sec = parseLen(e.target.value);
              if (e.target.value.trim() && sec == null) return alert("Use minutes:seconds, like 4:56 or 15");
              if (sec !== secOf(item)) onSave(lenPatch(sec));
              e.target.value = fmtLen(sec);
            }}
          />
        ) : (
          secOf(item) != null && <span className="text-xs text-muted">{fmtLen(secOf(item))}</span>
        )}
        {canEdit && <Controls first={first} last={last} onMove={onMove} onRemove={onRemove} />}
      </div>
    </li>
  );
}

function Controls({ first, last, onMove, onRemove }: { first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <span className="flex print:hidden">
      <button className="btn-ghost px-1" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
      <button className="btn-ghost px-1" disabled={last} onClick={() => onMove(1)} aria-label="Move down">↓</button>
      <button className="btn-ghost px-1" onClick={onRemove} aria-label="Remove">✕</button>
    </span>
  );
}

function AddBar({ songs, onAdd }: { songs: SongLite[]; onAdd: (k: ItemKind, s?: SongLite) => void }) {
  const [q, setQ] = useState("");
  const matches = q.trim()
    ? songs.filter((s) => `${s.title} ${s.author ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : [];
  return (
    <div className="space-y-2 p-4 print:hidden">
      <div className="relative">
        <input className="input" placeholder="Add a song — type to search the library…" value={q} onChange={(e) => setQ(e.target.value)} />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-white shadow-lg">
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent-soft"
                  onClick={() => {
                    onAdd("song", s);
                    setQ("");
                  }}
                >
                  <span className="flex-1">{s.title}<span className="ml-2 text-muted">{s.author}</span></span>
                  {s.default_key && <span className="text-xs text-muted">{s.default_key}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim() && matches.length === 0 && (
          <p className="mt-1 text-xs text-muted">No match. <Link className="text-accent" href="/songs/new">Add it to the library</Link></p>
        )}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => onAdd("item")}>+ Item</button>
        <button className="btn-secondary" onClick={() => onAdd("header")}>+ Section header</button>
      </div>
    </div>
  );
}
