"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import { fmtDate } from "@/lib/format";
import Link from "next/link";
import Tutorials, { PARTS } from "@/components/Tutorials";
import type { Position, PositionMember, Profile, Team, Tutorial } from "@/lib/types";

type Training = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  team_id: string | null;
  location_id: string | null;
  required: boolean;
};
type Completion = { training_id: string; profile_id: string; completed_at: string };

const BLANK = { title: "", url: "", description: "", team_id: "", location_id: "", required: false };

export default function TrainingsPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [done, setDone] = useState<Completion[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [form, setForm] = useState({ ...BLANK, location_id: loc.current ?? "" });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [songTuts, setSongTuts] = useState<{ id: string; title: string; tutorials: Tutorial[] }[]>([]);
  const [part, setPart] = useState("");

  const load = useCallback(async () => {
    const [t, c, tm, pos, pm, ppl] = await Promise.all([
      supabase.from("trainings").select("*").order("required", { ascending: false }).order("title"),
      supabase.from("training_completions").select("*"),
      supabase.from("teams").select("*").order("sort"),
      supabase.from("positions").select("*"),
      supabase.from("position_members").select("*"),
      supabase.from("profiles").select("id,email,full_name,phone,role,location_id").neq("role", "pending").order("full_name"),
    ]);
    const st = await supabase.from("songs").select("id,title,tutorials").eq("archived", false).order("title");
    if (!st.error) setSongTuts(((st.data ?? []) as { id: string; title: string; tutorials: Tutorial[] | null }[]).filter((x) => x.tutorials?.length).map((x) => ({ ...x, tutorials: x.tutorials ?? [] })));
    if (t.error) return setMissing(true);
    setTrainings((t.data ?? []) as Training[]);
    setDone((c.data ?? []) as Completion[]);
    setTeams((tm.data ?? []) as Team[]);
    setPositions(pos.data ?? []);
    setRoster(pm.data ?? []);
    setPeople((ppl.data ?? []) as Profile[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  // Who a training is for: the team's roster, or everyone (at that location).
  const audience = useCallback(
    (t: Training) => {
      const atLoc = (p: Profile) => !t.location_id || !p.location_id || p.location_id === t.location_id;
      if (!t.team_id) return people.filter(atLoc);
      const posIds = new Set(positions.filter((p) => p.team_id === t.team_id).map((p) => p.id));
      const ids = new Set(roster.filter((r) => posIds.has(r.position_id)).map((r) => r.profile_id));
      return people.filter((p) => ids.has(p.id) && atLoc(p));
    },
    [people, positions, roster]
  );

  const shown = useMemo(() => {
    const atCurrent = (t: Training) => !loc.current || !t.location_id || t.location_id === loc.current;
    const list = trainings.filter(atCurrent);
    if (me.isLeader) return list;
    return list.filter((t) => audience(t).some((p) => p.id === me.id));
  }, [trainings, loc.current, me.isLeader, me.id, audience]);

  const isDone = (tid: string, pid: string) => done.some((d) => d.training_id === tid && d.profile_id === pid);

  async function toggleMine(t: Training) {
    if (isDone(t.id, me.id)) {
      await supabase.from("training_completions").delete().eq("training_id", t.id).eq("profile_id", me.id);
    } else {
      await supabase.from("training_completions").insert({ training_id: t.id, profile_id: me.id });
    }
    load();
  }

  async function toggleFor(t: Training, pid: string) {
    if (isDone(t.id, pid)) await supabase.from("training_completions").delete().eq("training_id", t.id).eq("profile_id", pid);
    else await supabase.from("training_completions").insert({ training_id: t.id, profile_id: pid });
    load();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("trainings").insert({
      title: form.title.trim(),
      url: form.url.trim() || null,
      description: form.description.trim() || null,
      team_id: form.team_id || null,
      location_id: (loc.canSwitch ? form.location_id : loc.current) || null,
      required: form.required,
    });
    if (error) return alert(error.message);
    setForm({ ...BLANK, location_id: loc.current ?? "" });
    setAdding(false);
    load();
  }

  async function remove(t: Training) {
    if (!confirm(`Delete training "${t.title}"?`)) return;
    const { error } = await supabase.from("trainings").delete().eq("id", t.id);
    if (error) alert(error.message);
    load();
  }

  const songParts = PARTS.filter((p) => songTuts.some((s) => s.tutorials.some((t) => (t.part || "Other") === p)));
  const songSection = songTuts.length > 0 && (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="h2 flex-1">Song tutorials</h2>
        {["", ...songParts].map((p) => (
          <button
            key={p || "all"}
            onClick={() => setPart(p)}
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${part === p ? "bg-accent text-white" : "bg-stone-100 text-muted"}`}
          >
            {p || "All"}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {songTuts
          .map((s) => ({ ...s, tutorials: s.tutorials.filter((t) => !part || (t.part || "Other") === part) }))
          .filter((s) => s.tutorials.length)
          .map((s) => (
            <div key={s.id} className="card">
              <Link href={`/songs/${s.id}`} className="mb-2 block font-display font-bold hover:text-accent">{s.title}</Link>
              <Tutorials items={s.tutorials} />
            </div>
          ))}
      </div>
    </section>
  );

  if (missing) return <p className="text-muted">Trainings aren&apos;t set up yet. Run the database update (003_charts_trainings.sql) in Supabase.</p>;

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name;
  const myOutstanding = shown.filter((t) => t.required && audience(t).some((p) => p.id === me.id) && !isDone(t.id, me.id)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="h1">Trainings</h1>
          <p className="text-sm text-muted">
            {myOutstanding ? `You have ${myOutstanding} required training${myOutstanding === 1 ? "" : "s"} to finish.` : "Videos and guides for serving on the team."}
          </p>
        </div>
        {me.isLeader && !adding && <button className="btn" onClick={() => setAdding(true)}>+ Add training</button>}
      </div>

      {adding && (
        <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Title</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. In-ear monitor setup" /></label>
          <label className="block"><span className="label">Video or document link</span><input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="YouTube, Google Drive, Vimeo…" /></label>
          <label className="block"><span className="label">For</span>
            <select className="input" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
              <option value="">Everyone</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.location_id ? ` (${loc.name(t.location_id)})` : ""}</option>)}
            </select>
          </label>
          {loc.locations.length > 0 && loc.canSwitch && (
            <label className="block"><span className="label">Location</span>
              <select className="input" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                <option value="">All locations</option>
                {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          <label className="block sm:col-span-2"><span className="label">Notes / instructions</span><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Required</label>
          <div className="flex gap-2 sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn">Save training</button>
          </div>
        </form>
      )}

      {shown.length === 0 && <p className="text-sm text-muted">No general trainings yet.{songTuts.length ? " Song tutorials are below." : ""}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((t) => {
          const who = audience(t);
          const count = who.filter((p) => isDone(t.id, p.id)).length;
          const forMe = who.some((p) => p.id === me.id);
          const mine = isDone(t.id, me.id);
          return (
            <section key={t.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="h2 flex-1">{t.title}</h2>
                {t.required && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Required</span>}
                <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                  {teamName(t.team_id) ?? "Everyone"}{t.location_id ? ` · ${loc.name(t.location_id)}` : ""}
                </span>
              </div>
              {t.description && <p className="whitespace-pre-wrap text-sm text-muted">{t.description}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="btn-secondary">▶ Open</a>}
                {forMe && (
                  <button className={mine ? "btn-secondary text-ok" : "btn"} onClick={() => toggleMine(t)}>
                    {mine ? "✓ Completed" : "Mark complete"}
                  </button>
                )}
                {me.isLeader && (
                  <>
                    <button className="btn-ghost ml-auto" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                      {count}/{who.length} done {openId === t.id ? "▴" : "▾"}
                    </button>
                    <button className="btn-ghost text-bad" onClick={() => remove(t)}>Delete</button>
                  </>
                )}
              </div>
              {me.isLeader && openId === t.id && (
                <ul className="divide-y divide-line border-t border-line pt-1 text-sm">
                  {who.length === 0 && <li className="py-2 text-muted">No one on this team yet.</li>}
                  {who.map((p) => {
                    const c = done.find((d) => d.training_id === t.id && d.profile_id === p.id);
                    return (
                      <li key={p.id} className="flex items-center gap-2 py-1.5">
                        <span className="flex-1">{p.full_name || p.email}</span>
                        <span className={`text-xs ${c ? "text-ok" : "text-muted"}`}>{c ? `✓ ${fmtDate(c.completed_at.slice(0, 10), { weekday: undefined, year: undefined })}` : "Not yet"}</span>
                        <button className="btn-ghost text-xs" onClick={() => toggleFor(t, p.id)}>{c ? "Undo" : "Mark done"}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {songSection}
    </div>
  );
}
