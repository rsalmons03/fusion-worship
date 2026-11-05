"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import type { Profile, Role } from "@/lib/types";

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Everything, including people" },
  { value: "leader", label: "Leader", hint: "Edit plans, songs, teams, schedules" },
  { value: "member", label: "Member", hint: "View, respond to requests" },
  { value: "pending", label: "Pending", hint: "No access" },
];

export default function PeoplePage() {
  const me = useProfile();
  const supabase = createClient();
  const [people, setPeople] = useState<Profile[]>([]);
  const [form, setForm] = useState({ email: "", name: "", role: "member" as Role });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id,email,full_name,phone,role").order("full_name");
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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? "Could not add person");
    setMsg(body.emailed ? `Added ${form.email} and emailed them a sign-in link.` : `Added ${form.email}. ${body.note ?? ""}`);
    setForm({ email: "", name: "", role: "member" });
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

      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="block"><span className="label">Email</span><input type="email" required className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="block"><span className="label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block"><span className="label">Role</span>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.filter((r) => r.value !== "pending").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add person"}</button>
        {msg && <p className="text-sm text-muted sm:col-span-4">{msg}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="hidden px-4 py-2 sm:table-cell">Phone</th><th className="px-4 py-2">Role</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {people.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">{p.full_name || "—"}</td>
                <td className="px-4 py-2 text-muted">{p.email}</td>
                <td className="hidden px-4 py-2 text-muted sm:table-cell">{p.phone}</td>
                <td className="px-4 py-2">
                  <select className="input w-auto py-1" value={p.role} onChange={(e) => setRole(p, e.target.value as Role)} title={ROLES.find((r) => r.value === p.role)?.hint}>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
