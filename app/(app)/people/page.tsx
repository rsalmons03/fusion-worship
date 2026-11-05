"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import Verified from "@/components/Verified";
import type { Profile, Role } from "@/lib/types";

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

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("full_name");
    setPeople((data ?? []) as Profile[]);
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
    setMsg(`Added ${form.email}. They can sign in at ${window.location.origin}/login with that email and the starting password.`);
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
        <label className="block"><span className="label">Email</span><input type="email" required className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="block"><span className="label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block"><span className="label">Starting password</span><input className="input" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8+ characters" autoComplete="off" /></label>
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

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="hidden px-4 py-2 sm:table-cell">Phone</th><th className="px-4 py-2">Role</th>{loc.locations.length > 0 && <th className="px-4 py-2">Location</th>}<th className="px-4 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {people.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">
                  <span className="flex items-center gap-1">
                    {p.full_name || "—"} <Verified on={p.verified} />
                  </span>
                  <label className="mt-1 flex items-center gap-1 text-[11px] font-normal text-muted">
                    Member since
                    <input
                      type="date"
                      className="rounded-sm border border-line bg-white px-1 py-0.5 text-[11px]"
                      defaultValue={(p.member_since || p.created_at || "").slice(0, 10)}
                      onBlur={(e) => e.target.value && e.target.value !== (p.member_since ?? "") && setMemberSince(p, e.target.value)}
                    />
                  </label>
                  <button
                    className={`mt-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase ${p.verified ? "bg-[#1d9bf0] text-white" : "border border-line text-muted"}`}
                    onClick={() => toggleVerified(p)}
                  >
                    {p.verified ? "✓ Confirmed member" : "Mark confirmed"}
                  </button>
                </td>
                <td className="px-4 py-2 text-muted">{p.email}</td>
                <td className="hidden px-4 py-2 text-muted sm:table-cell">{p.phone}</td>
                <td className="px-4 py-2">
                  <select className="input w-auto py-1" value={p.role} onChange={(e) => setRole(p, e.target.value as Role)} title={ROLES.find((r) => r.value === p.role)?.hint}>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                {loc.locations.length > 0 && (
                  <td className="px-4 py-2">
                    <select className="input w-auto py-1" value={p.location_id ?? ""} onChange={(e) => setLocation(p, e.target.value || null)}>
                      <option value="">All locations</option>
                      {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </td>
                )}
                <td className="px-4 py-2 text-right"><button className="btn-ghost whitespace-nowrap" onClick={() => setPassword(p)}>Set password</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
