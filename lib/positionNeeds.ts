// Whether a position is needed on a given service (the Scheduler's "Needed / Not needed" per day).
import type { SupabaseClient } from "@supabase/supabase-js";

export type NeedStatus = "needed" | "optional" | "tracks" | "not_needed";

export const NEED_OPTIONS: { value: NeedStatus; label: string; short: string; hint: string }[] = [
  { value: "needed", label: "Needed", short: "Needed", hint: "Someone has to be booked" },
  { value: "optional", label: "Nice to have", short: "Nice to have", hint: "Book someone if they're free" },
  { value: "tracks", label: "Covered by tracks", short: "🎚 Tracks", hint: "Fusion Tracks plays this part" },
  { value: "not_needed", label: "Not needed this day", short: "Not needed", hint: "Leave it empty" },
];
export const needLabel = (s: NeedStatus) => NEED_OPTIONS.find((o) => o.value === s)!;
/** Statuses that still count as an open spot. */
export const isOpen = (s: NeedStatus) => s === "needed" || s === "optional";

export type NeedMap = Map<string, NeedStatus>; // `${planId}|${positionId}` → status (missing = needed)
export const needKey = (planId: string, positionId: string) => `${planId}|${positionId}`;

/** Loads the saved statuses for these services. `ok` is false when the database update hasn't been run. */
export async function loadNeeds(supabase: SupabaseClient, planIds: string[]): Promise<{ map: NeedMap; ok: boolean }> {
  const map: NeedMap = new Map();
  if (!planIds.length) return { map, ok: true };
  const { data, error } = await supabase.from("plan_position_needs").select("plan_id,position_id,status").in("plan_id", planIds);
  if (error) return { map, ok: false };
  for (const r of data ?? []) map.set(needKey(r.plan_id, r.position_id), r.status as NeedStatus);
  return { map, ok: true };
}

export async function saveNeed(supabase: SupabaseClient, planId: string, positionId: string, status: NeedStatus) {
  if (status === "needed") return supabase.from("plan_position_needs").delete().eq("plan_id", planId).eq("position_id", positionId);
  return supabase.from("plan_position_needs").upsert({ plan_id: planId, position_id: positionId, status, updated_at: new Date().toISOString() });
}
