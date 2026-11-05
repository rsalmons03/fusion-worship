"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import type { Position, PositionMember, Profile, Team } from "@/lib/types";

export default function TeamsPage() {
  const me = useProfile();
  const canEdit = me.isLeader;
  const supabase = createClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roster, setRoster] = useState<PositionMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [openPos, setOpenPos] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState("");

  const load = useCallback(async () => {
    const [t, p, r, ppl] = await Promise.all([
      supabase.from("teams").select("*").order("sort"),
      supabase.from("positions").select("*").order("sort"),
      supabase.from("position_members").select("*"),
      supabase.from("profiles").select("id,email,full_name,phone,role").neq("role", "pending").order("full_name"),
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
    await supabase.from("teams").insert({ name: newTeam.trim(), sort: teams.length + 1 });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Teams</h1>
        <p className="text-sm text-muted">Each position has a roster of people who can fill it. Rosters show first when you schedule a plan.</p>
      </div>
      {canEdit && (
        <form onSubmit={addTeam} className="flex max-w-md gap-2">
          <input className="input" placeholder="New team name (e.g. Kids, Hospitality)" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
          <button className="btn shrink-0">Add team</button>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((t) => (
          <section key={t.id} className="card">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="h2 flex-1">{t.name}</h2>
              {canEdit && (
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
                              {person.full_name || person.email}
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
