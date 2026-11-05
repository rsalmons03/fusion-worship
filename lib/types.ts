export type Role = "admin" | "leader" | "member" | "pending";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  location_id: string | null;
};

export type Location = { id: string; name: string; sort: number };

export type Song = {
  id: string;
  title: string;
  author: string | null;
  ccli: string | null;
  default_key: string | null;
  bpm: number | null;
  meter: string | null;
  themes: string | null;
  chordpro: string;
  reference_url: string | null;
  multitracks_url?: string | null;
  tutorials?: Tutorial[];
  notes: string | null;
  archived: boolean;
};

export type ServiceType = { id: string; name: string; default_time: string | null };

export type Plan = {
  id: string;
  service_type_id: string | null;
  service_date: string;
  start_time: string | null;
  title: string | null;
  series: string | null;
  notes: string | null;
  location_id: string | null;
};

export type ItemKind = "song" | "header" | "item";

export type PlanItem = {
  id: string;
  plan_id: string;
  position: number;
  kind: ItemKind;
  title: string;
  song_id: string | null;
  song_key: string | null;
  duration_min: number | null;
  description: string | null;
};

export type Team = { id: string; name: string; sort: number; location_id: string | null };
export type Position = { id: string; team_id: string; name: string; sort: number };
export type PositionMember = { position_id: string; profile_id: string };

export type AssignmentStatus = "unsent" | "pending" | "accepted" | "declined";
export type Assignment = {
  id: string;
  plan_id: string;
  position_id: string;
  profile_id: string;
  status: AssignmentStatus;
  notified_at: string | null;
  responded_at: string | null;
};

export type Blockout = {
  id: string;
  profile_id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

export type Tutorial = { part: string; title: string; url: string };
