"use client";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import StatusChip from "@/components/StatusChip";
import SongListen from "@/components/SongListen";
import PlanTimes from "@/components/plan/PlanTimes";
import PlanFiles from "@/components/plan/PlanFiles";
import { KEYS } from "@/lib/chordpro";
import { addMinutes, fmtDate, fmtTime, planLabel } from "@/lib/format";
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
        supabase.from("profiles").select("id,email,full_name,phone,role,location_id").neq("role", "pending").order("full_name"),
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
    await supabase.from("plan_items").update(patch).eq("id", id);
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
      if (t && it.duration_min) t = addMinutes(t, it.duration_min);
      return at;
    });
  }, [items, plan?.start_time]);
  const totalMin = items.reduce((n, x) => n + (x.duration_min ?? 0), 0);

  // ── Scheduling ──
  const personName = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p?.full_name || p?.email || "Unknown";
  };
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
  const posName = (id: string) => {
    const p = positions.find((x) => x.id === id);
    const t = teams.find((x) => x.id === p?.team_id);
    return { pos: p?.name ?? "", team: t?.name ?? "" };
  };
  const myTeamIds = new Set(myAssignments.map((a) => positions.find((p) => p.id === a.position_id)?.team_id));
  const orderedTeams = [...planTeams].sort((a, b) => Number(myTeamIds.has(b.id)) - Number(myTeamIds.has(a.id)));
  const songItems = items.filter((i) => i.kind === "song" && i.song_id).map((i) => ({ id: i.song_id!, title: i.title }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="print:hidden">
        <Link href="/plans" className="text-sm text-muted hover:text-ink">← Plans</Link>
      </div>
      <div>
        <div className="min-w-0">
          <h1 className="h1">{planLabel(plan)}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              className="grid h-8 w-8 place-items-center rounded-full bg-stone-100 text-accent disabled:opacity-30 print:hidden"
              disabled={!neighbors.prev}
              onClick={() => neighbors.prev && router.push(`/plans/${neighbors.prev}`)}
              aria-label="Previous service"
            >
              ‹
            </button>
            <button
              className="grid h-8 w-8 place-items-center rounded-full bg-stone-100 text-accent disabled:opacity-30 print:hidden"
              disabled={!neighbors.next}
              onClick={() => neighbors.next && router.push(`/plans/${neighbors.next}`)}
              aria-label="Next service"
            >
              ›
            </button>
            <span className="font-display text-lg font-bold text-muted">
              {fmtDate(plan.service_date, { weekday: undefined, year: undefined })}
            </span>
            {plan.location_id && <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-xs font-bold uppercase text-accent">{loc.name(plan.location_id)}</span>}
            {canEdit && (
              <button className="btn-ghost ml-auto print:hidden" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>
                {showDetails ? "Done" : "⚙ Edit details"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* My role(s) in this service */}
      {myAssignments.length > 0 && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {myAssignments.map((a) => {
            const { pos, team } = posName(a.position_id);
            const ok = a.status === "accepted";
            const no = a.status === "declined";
            return (
              <div key={a.id} className="flex items-stretch overflow-hidden rounded-md border border-line bg-white">
                <span className={`grid w-10 place-items-center text-lg text-white ${ok ? "bg-ok" : no ? "bg-bad" : "bg-amber-500"}`}>{ok ? "✓" : no ? "✕" : "?"}</span>
                <span className="px-3 py-2 text-sm">
                  <b>{pos}</b> <span className="text-accent">({team})</span>
                </span>
                {(a.status === "pending" || a.status === "unsent") && (
                  <span className="flex items-center gap-1 pr-2">
                    <button className="btn py-1 text-xs" onClick={() => respond(a.id, "accepted")}>Accept</button>
                    <button className="btn-secondary py-1 text-xs" onClick={() => respond(a.id, "declined")}>Decline</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

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

      {/* Tabs */}
      <div className="sticky top-[57px] z-10 -mx-4 flex overflow-x-auto border-b border-line bg-paper px-4 print:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wider ${tab === t ? "border-accent text-ink" : "border-transparent text-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Order" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href={`/plans/${plan.id}/player`} className="btn">▶ Play</Link>
            <button className="btn-secondary" onClick={() => window.print()}>🖨 Print</button>
            <Link href={`/live/${plan.id}`} className="btn-secondary">📡 Live</Link>
            {totalMin > 0 && <span className="ml-auto self-center text-sm text-muted">{totalMin} min</span>}
          </div>
        {/* Order of service */}
        <section className="card p-0">
          <div className="border-b border-line px-4 py-3">
            <h2 className="h2">Order of service</h2>
          </div>
          {items.length === 0 && <p className="px-4 py-6 text-sm text-muted">Nothing here yet.{canEdit && " Add songs and items below."}</p>}
          <ul>
            {items.map((it, i) => (
              <ItemRow
                key={it.id}
                item={it}
                time={times[i]}
                canEdit={canEdit}
                first={i === 0}
                last={i === items.length - 1}
                onSave={(patch) => saveItem(it.id, patch)}
                onRemove={() => removeItem(it.id)}
                onMove={(d) => move(i, d)}
              />
            ))}
          </ul>
          {canEdit && <AddBar songs={songs} onAdd={addItem} />}
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
          {planTeams.length === 0 && <p className="text-sm text-muted">No teams yet. <Link href="/teams" className="text-accent">Set up teams</Link></p>}
          <div className="grid gap-4 md:grid-cols-2">
          {orderedTeams.map((team) => (
            <div key={team.id} className="card">
              {myTeamIds.has(team.id) && orderedTeams[0].id === team.id && <div className="label mb-1 text-accent">My team</div>}
              <h3 className="mb-2 flex flex-wrap items-center gap-x-3 font-display font-bold">
                <span className="flex-1">
                  {team.name}
                  {!team.location_id && <span className="ml-2 text-xs font-normal text-muted">Shared</span>}
                </span>
                <TeamCounts list={assignments.filter((a) => positions.some((p) => p.id === a.position_id && p.team_id === team.id))} />
              </h3>
              <ul className="space-y-2">
                {positions.filter((p) => p.team_id === team.id).map((pos) => {
                  const here = assignments.filter((a) => a.position_id === pos.id);
                  const rosterIds = new Set(roster.filter((r) => r.position_id === pos.id).map((r) => r.profile_id));
                  const taken = new Set(here.map((a) => a.profile_id));
                  const choices = people.filter((p) => !taken.has(p.id));
                  return (
                    <li key={pos.id} className="text-sm">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted">{pos.name}</div>
                      {here.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 py-0.5">
                          <span className="flex-1">{personName(a.profile_id)}{blocked.has(a.profile_id) && <span className="ml-1 text-xs text-bad">(blocked out)</span>}</span>
                          <StatusChip status={a.status} />
                          {canEdit && <button className="btn-ghost px-1 print:hidden" onClick={() => unassign(a.id)} aria-label="Remove">✕</button>}
                        </div>
                      ))}
                      {canEdit && (
                        <select
                          className="input mt-1 py-1 text-xs print:hidden"
                          value=""
                          onChange={(e) => e.target.value && assign(pos.id, e.target.value)}
                        >
                          <option value="">+ Schedule someone…</option>
                          <optgroup label="On this roster">
                            {choices.filter((p) => rosterIds.has(p.id)).map((p) => (
                              <option key={p.id} value={p.id}>{p.full_name || p.email}{blocked.has(p.id) ? " — blocked out" : ""}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Everyone else">
                            {choices.filter((p) => !rosterIds.has(p.id)).map((p) => (
                              <option key={p.id} value={p.id}>{p.full_name || p.email}{blocked.has(p.id) ? " — blocked out" : ""}</option>
                            ))}
                          </optgroup>
                        </select>
                      )}
                      {!canEdit && here.length === 0 && <div className="text-muted">—</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          </div>
        </section>
      )}

      {tab === "Times" && <PlanTimes planId={plan.id} serviceDate={plan.service_date} canEdit={canEdit} />}

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
  );
}

function TeamCounts({ list, big = false }: { list: Assignment[]; big?: boolean }) {
  const n = (s: string) => list.filter((a) => a.status === s).length;
  const cls = big ? "text-base" : "text-sm";
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
}: {
  item: PlanItem;
  time: string | null;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onSave: (p: Partial<PlanItem>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const [listening, setListening] = useState(false);
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
          <input type="number" min={0} className="w-14 rounded border border-line px-1 py-0.5 text-right text-xs" title="Minutes" defaultValue={item.duration_min ?? ""} onBlur={(e) => onSave({ duration_min: e.target.value ? Number(e.target.value) : null })} />
        ) : (
          item.duration_min != null && <span className="text-xs text-muted">{item.duration_min}m</span>
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
