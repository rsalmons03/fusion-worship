"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import Verified from "@/components/Verified";
import PersonEditor from "@/components/PersonEditor";
import type { Position, PositionMember, Profile, Role, Team } from "@/lib/types";

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Everything, including people" },
  { value: "leader", label: "Leader", hint: "Edit plans, songs, teams, schedules" },
  { value: "member", label: "Member", hint: "View, respond to requests" },
  { value: "pending", label: "Pending", hint: "No access" },
];

export default function PeoplePage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [people, setPeople] = useState<Profile[]>([]);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "member" as Role, location_id: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [members, setMembers] = useState<PositionMember[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [ppl, t, pos, pm] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("teams").select("*").order("sort"),
      supabase.from("positions").select("*").order("sort"),
      supabase.from("position_members").select("*"),
    ]);
    setPeople((ppl.data ?? []) as Profile[]);
    setTeams((t.data ?? []) as Team[]);
    setPositions(pos.data ?? []);
    setMembers(pm.data ?? []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  if (!me.isAdmin) return <p className="text-muted">Only admins can manage people.</p>;

  async function setRole(p: Profile, role: Role) {
    if (p.id === me.id && role !== "admin" && !confirm("Remove your own admin access?")) return;
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    if (error) alert(error.message);
    load();
  }

  async function setMemberSince(p: Profile, date: string) {
    const { error } = await supabase.from("profiles").update({ member_since: date }).eq("id", p.id);
    if (error) return alert(/member_since/.test(error.message) ? "This needs the database update 009_attendance.sql. " + error.message : error.message);
    load();
  }

  async function toggleVerified(p: Profile) {
    const { error } = await supabase.from("profiles").update({ verified: !p.verified }).eq("id", p.id);
    if (error) return alert(/verified/.test(error.message) ? "This needs the database update 008_verified.sql. " + error.message : error.message);
    load();
  }

  async function setLocation(p: Profile, location_id: string | null) {
    const { error } = await supabase.from("profiles").update({ location_id }).eq("id", p.id);
    if (error) alert(error.message);
    load();
  }

  async function setPassword(p: Profile) {
    const pw = prompt(`New password for ${p.full_name || p.email} (8+ characters). Tell them this password; they can change it under My Profile.`);
    if (!pw) return;
    if (pw.length < 8) return alert("Use at least 8 characters.");
    const res = await fetch("/api/people", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, password: pw }),
    });
    const body = await res.json().catch(() => ({}));
    alert(res.ok ? "Password set." : body.error ?? "Could not set password");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loc.locations.length ? form : { ...form, location_id: undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? "Could not add person");
    setMsg(
      !body.hasEmail
        ? `Added ${form.name}. They can be scheduled now. Add an email and password later (Edit) if they need to sign in.`
        : body.setPassword
        ? `Added ${form.email}. They can sign in at ${window.location.origin}/login with that email and the starting password.`
        : `Added ${form.email}. Use Edit → Set password when they're ready to sign in.`
    );
    setForm({ email: "", name: "", password: "", role: "member", location_id: "" });
    load();
  }

  const pending = people.filter((p) => p.role === "pending");

  return (
    <div className="space-y-6">
      <h1 className="h1">People</h1>

      {pending.length > 0 && (
        <section className="card border-amber-300 bg-amber-50">
          <h2 className="h2 mb-2">Waiting for approval</h2>
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1">{p.full_name || "(no name)"} · {p.email}</span>
                <button className="btn" onClick={() => setRole(p, "member")}>Approve as member</button>
                <button className="btn-secondary" onClick={() => setRole(p, "leader")}>Approve as leader</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto_auto] lg:items-end">
        <label className="block"><span className="label">Email (optional)</span><input type="email" className="input" placeholder="Only if they'll sign in" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="block"><span className="label">Name</span><input className="input" required={!form.email.trim()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        {form.email.trim() && (
          <label className="block"><span className="label">Starting password</span><input className="input" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8+ characters (optional)" autoComplete="off" /></label>
        )}
        <label className="block"><span className="label">Role</span>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.filter((r) => r.value !== "pending").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {loc.locations.length > 0 && (
          <label className="block"><span className="label">Location</span>
            <select className="input" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
              <option value="">All locations</option>
              {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
        <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add person"}</button>
        {msg && <p className="text-sm text-muted sm:col-span-2 lg:col-span-6">{msg}</p>}
      </form>

      <div className="flex items-center gap-2">
        <h2 className="h2 flex-1">Everyone ({people.filter((p) => p.role !== "pending").length})</h2>
        <input className="input w-48" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="space-y-3">
        {people
          .filter((p) => !q.trim() || `${p.full_name} ${p.email} ${p.phone ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
          .map((p) => {
            const mine = members.filter((m) => m.profile_id === p.id).map((m) => positions.find((x) => x.id === m.position_id)).filter(Boolean) as Position[];
            const isOpen = editing === p.id;
            return (
              <li key={p.id} className="card">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-semibold">
                      {p.full_name || "(no name)"} <Verified on={p.verified} />
                      {p.role === "pending" && <span className="ml-1 rounded-sm bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">Pending</span>}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {p.email || <span className="italic">No email · can&apos;t sign in yet</span>}
                      {p.phone && ` · ${p.phone}`}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {mine.length ? (
                        mine.map((x) => (
                          <span key={x.id} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                            {x.name}
                            <span className="font-normal text-muted"> · {teams.find((t) => t.id === x.team_id)?.name}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted">No positions yet</span>
                      )}
                    </div>
                  </div>
                  <button className={isOpen ? "btn" : "btn-secondary"} onClick={() => setEditing(isOpen ? null : p.id)}>
                    {isOpen ? "Done" : "Edit"}
                  </button>
                </div>
                {isOpen && (
                  <PersonEditor
                    p={p}
                    teams={teams}
                    positions={positions}
                    members={members}
                    locations={loc.locations}
                    onChanged={load}
                    setRole={(role) => setRole(p, role)}
                    setLocation={(l) => setLocation(p, l)}
                    setMemberSince={(d) => setMemberSince(p, d)}
                    toggleVerified={() => toggleVerified(p)}
                    setPassword={() => setPassword(p)}
                  />
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
