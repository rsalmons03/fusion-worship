"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import type { Position, PositionMember, Profile, Team } from "@/lib/types";

export default function TeamsPage() {
  const me = useProfile();
  const loc = useLocations();
  const canEdit = me.isLeader;
  const supabase = createClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [openPos, setOpenPos] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState("");
  const [newTeamLoc, setNewTeamLoc] = useState<string>("");
  useEffect(() => setNewTeamLoc(loc.current ?? ""), [loc.current]);

  const load = useCallback(async () => {
    const [t, p, r, ppl] = await Promise.all([
      supabase.from("teams").select("*").order("sort"),
      supabase.from("positions").select("*").order("sort"),
      supabase.from("position_members").select("*"),
      supabase.from("profiles").select("*").neq("role", "pending").order("full_name"),
    ]);
    setTeams(t.data ?? []);
    setPositions(p.data ?? []);
    setRoster(r.data ?? []);
    setPeople((ppl.data ?? []) as Profile[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const name = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p?.full_name || p?.email || "?";
  };

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeam.trim()) return;
    const { error } = await supabase.from("teams").insert({ name: newTeam.trim(), sort: teams.length + 1, ...(loc.locations.length ? { location_id: newTeamLoc || null } : {}) });
    if (error) return alert(error.message);
    setNewTeam("");
    load();
  }

  async function renameTeam(t: Team) {
    const n = prompt("Team name", t.name);
    if (n?.trim()) {
      await supabase.from("teams").update({ name: n.trim() }).eq("id", t.id);
      load();
    }
  }

  async function moveTeam(t: Team, location_id: string | null) {
    const { error } = await supabase.from("teams").update({ location_id }).eq("id", t.id);
    if (error) alert(error.message);
    load();
  }

  async function deleteTeam(t: Team) {
    if (!confirm(`Delete ${t.name} and all its positions? Existing schedules for these positions are removed too.`)) return;
    await supabase.from("teams").delete().eq("id", t.id);
    load();
  }

  async function addPosition(teamId: string) {
    const n = prompt("Position name (e.g. Bass, Sound, Greeter)");
    if (!n?.trim()) return;
    const count = positions.filter((p) => p.team_id === teamId).length;
    await supabase.from("positions").insert({ team_id: teamId, name: n.trim(), sort: count + 1 });
    load();
  }

  async function deletePosition(p: Position) {
    if (!confirm(`Delete position ${p.name}?`)) return;
    await supabase.from("positions").delete().eq("id", p.id);
    load();
  }

  async function toggle(positionId: string, profileId: string, on: boolean) {
    if (on) {
      setRoster((r) => r.filter((x) => !(x.position_id === positionId && x.profile_id === profileId)));
      await supabase.from("position_members").delete().eq("position_id", positionId).eq("profile_id", profileId);
    } else {
      setRoster((r) => [...r, { position_id: positionId, profile_id: profileId }]);
      await supabase.from("position_members").insert({ position_id: positionId, profile_id: profileId });
    }
  }

  const canEditTeam = (t: Team) => canEdit && (loc.canSwitch || t.location_id === loc.current);
  const shown = teams.filter((t) => !loc.current || !t.location_id || t.location_id === loc.current);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Teams</h1>
        <p className="text-sm text-muted">
          Each position has a roster of people who can fill it. Rosters show first when you schedule a plan.
          {loc.locations.length > 0 && " Shared teams serve every location."}
        </p>
      </div>
      {canEdit && (
        <form onSubmit={addTeam} className="flex max-w-xl flex-wrap gap-2 sm:flex-nowrap">
          <input className="input" placeholder="New team name (e.g. Kids, Hospitality)" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
          {loc.locations.length > 0 && (
            <select className="input sm:w-44" value={newTeamLoc} onChange={(e) => setNewTeamLoc(e.target.value)} aria-label="Team location">
              {loc.canSwitch && <option value="">Shared (all locations)</option>}
              {loc.locations.filter((l) => loc.canSwitch || l.id === loc.current).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <button className="btn shrink-0">Add team</button>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((t) => (
          <section key={t.id} className="card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="h2 flex-1">{t.name}</h2>
              {loc.locations.length > 0 &&
                (canEdit && loc.canSwitch ? (
                  <select className="rounded-sm border border-line bg-white px-1.5 py-0.5 text-xs" value={t.location_id ?? ""} onChange={(e) => moveTeam(t, e.target.value || null)} aria-label="Team location">
                    <option value="">Shared</option>
                    {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                ) : (
                  <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-accent">
                    {t.location_id ? loc.name(t.location_id) : "Shared"}
                  </span>
                ))}
              {canEditTeam(t) && (
                <>
                  <button className="btn-ghost" onClick={() => addPosition(t.id)}>+ Position</button>
                  <button className="btn-ghost" onClick={() => renameTeam(t)}>Rename</button>
                  <button className="btn-ghost text-bad" onClick={() => deleteTeam(t)}>Delete</button>
                </>
              )}
            </div>
            <ul className="divide-y divide-line">
              {positions.filter((p) => p.team_id === t.id).map((p) => {
                const members = roster.filter((r) => r.position_id === p.id).map((r) => r.profile_id);
                const isOpen = openPos === p.id;
                return (
                  <li key={p.id} className="py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="flex-1 truncate text-muted">{members.map(name).join(", ") || "No one yet"}</span>
                      {canEdit && <button className="btn-ghost" onClick={() => setOpenPos(isOpen ? null : p.id)}>{isOpen ? "Done" : "Edit"}</button>}
                      {canEdit && isOpen && <button className="btn-ghost text-bad" onClick={() => deletePosition(p)}>✕</button>}
                    </div>
                    {isOpen && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {people.map((person) => {
                          const on = members.includes(person.id);
                          return (
                            <button
                              key={person.id}
                              onClick={() => toggle(p.id, person.id, on)}
                              className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent text-white" : "border-line bg-white hover:border-accent"}`}
                            >
                              {person.verified ? "✓ " : ""}{person.full_name || person.email}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
