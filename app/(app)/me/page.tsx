"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import StatusChip from "@/components/StatusChip";
import { AppVersion } from "@/components/Nav";
import { fmtDate, todayISO } from "@/lib/format";
import type { Assignment, Blockout } from "@/lib/types";

type Hist = Assignment & { plans: { service_date: string }; positions: { name: string } };

export default function MePage() {
  const me = useProfile();
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(me.full_name);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [saved, setSaved] = useState(false);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [bo, setBo] = useState({ starts_on: todayISO(), ends_on: todayISO(), reason: "" });
  const [history, setHistory] = useState<Hist[]>([]);
  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  const load = useCallback(async () => {
    const [b, h] = await Promise.all([
      supabase.from("blockouts").select("*").eq("profile_id", me.id).gte("ends_on", todayISO()).order("starts_on"),
      supabase.from("assignments").select("*, plans(service_date), positions(name)").eq("profile_id", me.id),
    ]);
    setBlockouts(b.data ?? []);
    setHistory(((h.data ?? []) as Hist[]).sort((x, y) => y.plans.service_date.localeCompare(x.plans.service_date)));
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null }).eq("id", me.id);
    setSaved(true);
    router.refresh();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    if (pw.length < 8) return setPwMsg("Use at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwMsg(error ? error.message : "Password updated.");
    if (!error) setPw("");
  }

  async function addBlockout(e: React.FormEvent) {
    e.preventDefault();
    if (bo.ends_on < bo.starts_on) return alert("End date must be on or after the start date");
    const { error } = await supabase.from("blockouts").insert({ ...bo, reason: bo.reason || null, profile_id: me.id });
    if (error) return alert(error.message);
    setBo({ starts_on: todayISO(), ends_on: todayISO(), reason: "" });
    load();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <section className="card">
          <h2 className="h2 mb-3">My profile</h2>
          <form onSubmit={saveProfile} className="space-y-3">
            <label className="block"><span className="label">Name</span><input className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></label>
            <label className="block"><span className="label">Phone</span><input className="input" value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} /></label>
            <p className="text-sm text-muted">Email: {me.email} · Role: {me.role}</p>
            <button className="btn">{saved ? "Saved ✓" : "Save"}</button>
          </form>
        </section>

        <AppVersion />
        <section className="card">
          <h2 className="h2 mb-3">Change password</h2>
          <form onSubmit={changePassword} className="flex flex-wrap gap-2">
            <input type="password" className="input flex-1" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <button className="btn">Save</button>
          </form>
          {pwMsg && <p className="mt-2 text-sm text-muted">{pwMsg}</p>}
        </section>

        <section className="card">
          <h2 className="h2 mb-1">Block-out dates</h2>
          <p className="mb-3 text-sm text-muted">Let leaders know when you&apos;re away. You&apos;ll be flagged if someone tries to schedule you.</p>
          <form onSubmit={addBlockout} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
            <label className="block"><span className="label">From</span><input type="date" className="input" value={bo.starts_on} onChange={(e) => setBo({ ...bo, starts_on: e.target.value, ends_on: bo.ends_on < e.target.value ? e.target.value : bo.ends_on })} /></label>
            <label className="block"><span className="label">To</span><input type="date" className="input" value={bo.ends_on} onChange={(e) => setBo({ ...bo, ends_on: e.target.value })} /></label>
            <label className="block"><span className="label">Reason (optional)</span><input className="input" value={bo.reason} onChange={(e) => setBo({ ...bo, reason: e.target.value })} /></label>
            <button className="btn">Add</button>
          </form>
          <ul className="mt-3 divide-y divide-line text-sm">
            {blockouts.map((b) => (
              <li key={b.id} className="flex items-center gap-2 py-2">
                <span className="flex-1">
                  {fmtDate(b.starts_on, { weekday: undefined })}
                  {b.ends_on !== b.starts_on && ` – ${fmtDate(b.ends_on, { weekday: undefined })}`}
                  {b.reason && <span className="text-muted"> · {b.reason}</span>}
                </span>
                <button className="btn-ghost" onClick={async () => { await supabase.from("blockouts").delete().eq("id", b.id); load(); }}>✕</button>
              </li>
            ))}
            {blockouts.length === 0 && <li className="py-2 text-muted">No upcoming block-outs.</li>}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 className="h2 mb-3">My serving history</h2>
        <ul className="divide-y divide-line text-sm">
          {history.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <Link href={`/plans/${a.plan_id}`} className="flex-1 hover:text-accent">
                {fmtDate(a.plans.service_date)} <span className="text-muted">· {a.positions.name}</span>
              </Link>
              <StatusChip status={a.status} />
            </li>
          ))}
          {history.length === 0 && <li className="py-2 text-muted">You haven&apos;t been scheduled yet.</li>}
        </ul>
      </section>
    </div>
  );
}
