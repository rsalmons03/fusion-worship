"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Location, Position, PositionMember, Profile, Role, Team } from "@/lib/types";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin: everything" },
  { value: "leader", label: "Leader: plans, songs, teams" },
  { value: "member", label: "Member: view & respond" },
  { value: "pending", label: "Pending: no access" },
];

/** Admin editor for one person: details, access, and which positions they play/serve. */
export default function PersonEditor({
  p,
  teams,
  positions,
  members,
  locations,
  onChanged,
  setRole,
  setLocation,
  setMemberSince,
  toggleVerified,
  setPassword,
}: {
  p: Profile;
  teams: Team[];
  positions: Position[];
  members: PositionMember[];
  locations: Location[];
  onChanged: () => void;
  setRole: (r: Role) => void;
  setLocation: (l: string | null) => void;
  setMemberSince: (d: string) => void;
  toggleVerified: () => void;
  setPassword: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({ full_name: p.full_name ?? "", email: p.email ?? "", phone: p.phone ?? "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newPos, setNewPos] = useState({ team: teams[0]?.id ?? "", name: "" });
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => void saveRef.current(), []);
  const mine = new Set(members.filter((m) => m.profile_id === p.id).map((m) => m.position_id));

  // Last values that are known to be saved, so we only send real changes.
  const lastSaved = useRef({ full_name: p.full_name ?? "", email: (p.email ?? "").toLowerCase(), phone: p.phone ?? "" });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const next = { full_name: form.full_name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() };
    const prev = lastSaved.current;
    const patch: Record<string, string> = {};
    if (next.full_name !== prev.full_name) patch.full_name = next.full_name;
    if (next.phone !== prev.phone) patch.phone = next.phone;
    if (next.email && next.email !== prev.email) patch.email = next.email;
    if (!Object.keys(patch).length) return;
    // Count it as saved straight away so a second trigger (leaving the box + closing) doesn't send it twice.
    lastSaved.current = { ...prev, ...patch };
    const fail = (msg: string) => {
      lastSaved.current = prev;
      setSaving(false);
      alert(`Couldn't save ${p.full_name || "this person"}: ${msg}`);
    };
    setSaving(true);
    setSaved(false);
    // Saved on the server (which checks you're an admin) and confirmed before showing "Saved".
    const res = await fetch("/api/people", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, ...patch }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !patch.email) {
      // Server couldn't do it (e.g. its secret key isn't set up): save name/phone directly instead.
      const direct: Record<string, string | null> = {};
      if (patch.full_name !== undefined) direct.full_name = patch.full_name;
      if (patch.phone !== undefined) direct.phone = patch.phone || null;
      const { data, error } = await supabase.from("profiles").update(direct).eq("id", p.id).select("id");
      if (error || !data?.length) return fail(error?.message ?? body.error ?? "no permission to change this person");
    } else if (!res.ok) return fail(body.error ?? res.statusText);
    setSaving(false);
    setSaved(true);
    onChanged();
  }

  async function togglePosition(id: string) {
    const { error } = mine.has(id)
      ? await supabase.from("position_members").delete().eq("position_id", id).eq("profile_id", p.id)
      : await supabase.from("position_members").insert({ position_id: id, profile_id: p.id });
    if (error) alert(error.message);
    onChanged();
  }

  async function addPosition(e: React.FormEvent) {
    e.preventDefault();
    if (!newPos.team || !newPos.name.trim()) return;
    const count = positions.filter((x) => x.team_id === newPos.team).length;
    const { data, error } = await supabase.from("positions").insert({ team_id: newPos.team, name: newPos.name.trim(), sort: count + 1 }).select("id").single();
    if (error || !data) return alert(error?.message ?? "Could not add position");
    await supabase.from("position_members").insert({ position_id: data.id, profile_id: p.id });
    setNewPos({ ...newPos, name: "" });
    onChanged();
  }

  return (
    <div className="mt-4 space-y-5 border-t border-line pt-4">
      {/* Details */}
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Name</span><input className="input" value={form.full_name} onChange={(e) => { setForm({ ...form, full_name: e.target.value }); setSaved(false); }} onBlur={() => save()} /></label>
        <label className="block"><span className="label">Email (sign-in)</span><input type="email" className="input" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setSaved(false); }} onBlur={() => save()} /></label>
        <label className="block"><span className="label">Phone</span><input type="tel" className="input" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setSaved(false); }} onBlur={() => save()} /></label>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
          {saved && <span className="text-sm text-ok">Saved ✓</span>}
          {!saved && !saving && <span className="text-xs text-muted">Changes also save when you leave a box.</span>}
        </div>
      </form>

      {/* Positions */}
      <div>
        <div className="label">Positions (what they play / do)</div>
        <p className="mb-2 text-xs text-muted">Tap to add or remove. These put them on the roster and the scheduling lists.</p>
        {teams.length === 0 && <p className="text-sm text-muted">No teams yet. Create one on the Teams page first.</p>}
        <div className="space-y-2">
          {teams.map((t) => {
            const ps = positions.filter((x) => x.team_id === t.id);
            if (!ps.length) return null;
            return (
              <div key={t.id}>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{t.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {ps.map((x) => {
                    const on = mine.has(x.id);
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => togglePosition(x.id)}
                        className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-white" : "border-line bg-white hover:border-accent"}`}
                      >
                        {on ? "✓ " : "+ "}
                        {x.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {teams.length > 0 && (
          <form onSubmit={addPosition} className="mt-3 flex flex-wrap gap-2">
            <select className="input w-auto" value={newPos.team} onChange={(e) => setNewPos({ ...newPos, team: e.target.value })} aria-label="Team">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input className="input min-w-[10rem] flex-1" placeholder="New position (e.g. Drums, Click/Tracks)" value={newPos.name} onChange={(e) => setNewPos({ ...newPos, name: e.target.value })} />
            <button className="btn-secondary">+ Add</button>
          </form>
        )}
      </div>

      {/* Access */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Access</span>
          <select className="input" value={p.role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {locations.length > 0 && (
          <label className="block"><span className="label">Location</span>
            <select className="input" value={p.location_id ?? ""} onChange={(e) => setLocation(e.target.value || null)}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="label">Member since</span>
          <input type="date" className="input" defaultValue={(p.member_since || p.created_at || "").slice(0, 10)} onBlur={(e) => e.target.value && e.target.value !== (p.member_since ?? "") && setMemberSince(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleVerified}
          className={`rounded-sm px-3 py-2 text-sm font-bold ${p.verified ? "bg-[#1d9bf0] text-white" : "border border-line text-muted"}`}
        >
          {p.verified ? "✓ Confirmed member" : "Mark as confirmed member"}
        </button>
        <button type="button" className="btn-secondary" onClick={setPassword}>Set password</button>
      </div>
    </div>
  );
}
