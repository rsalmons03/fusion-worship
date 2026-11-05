// Song rotation rules: 4 songs per service, and no song again within 3 weeks (same location).
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, daysBetween } from "./recur";

export const SONG_GAP_DAYS = 21;
export const SONGS_PER_SERVICE = 4;

export type SongUse = { songId: string; planId: string; date: string };

/** An empty song placeholder in the order of service: "Song 1", "Song 4 Tag", "Song 2 – Praise"… (not the closing song). */
export function isSongSlot(it: { kind: string; title: string }) {
  return it.kind === "item" && /^song\s*\d/i.test(it.title.trim());
}

/** Songs used in services at a location between two dates. */
export async function songUses(supabase: SupabaseClient, from: string, to: string, locationId: string | null): Promise<SongUse[]> {
  let q = supabase
    .from("plan_items")
    .select("song_id, plan_id, plans!inner(service_date, location_id)")
    .eq("kind", "song")
    .not("song_id", "is", null)
    .gte("plans.service_date", from)
    .lte("plans.service_date", to);
  if (locationId) q = q.eq("plans.location_id", locationId);
  const { data } = await q;
  return ((data ?? []) as unknown as { song_id: string; plan_id: string; plans: { service_date: string } | null }[]).filter((r) => r.plans).map((r) => ({
    songId: r.song_id,
    planId: r.plan_id,
    date: r.plans!.service_date,
  }));
}

/** The nearest other use of a song that's closer than the gap, or null if it's fine. */
export function tooSoon(uses: SongUse[], songId: string, date: string, planId: string) {
  const close = uses
    .filter((u) => u.songId === songId && u.planId !== planId && Math.abs(daysBetween(u.date, date)) < SONG_GAP_DAYS)
    .sort((a, b) => Math.abs(daysBetween(a.date, date)) - Math.abs(daysBetween(b.date, date)));
  return close[0] ?? null;
}

export function describeGap(u: SongUse, date: string) {
  const d = daysBetween(u.date, date); // >0: used before
  const weeks = Math.round(Math.abs(d) / 7);
  const when = weeks === 0 ? "the same week" : `${weeks} week${weeks === 1 ? "" : "s"} ${d > 0 ? "earlier" : "later"}`;
  return { weeks, when };
}

export const gapWindow = (date: string) => ({ from: addDays(date, -SONG_GAP_DAYS + 1), to: addDays(date, SONG_GAP_DAYS - 1) });

/**
 * Picks songs for a service's empty song slots: not used within the gap, not already in this service,
 * least recently used first (across everything known), so the library rotates.
 */
export function pickSongs({
  library,
  uses,
  date,
  planId,
  inPlan,
  count,
}: {
  library: { id: string }[];
  uses: SongUse[];
  date: string;
  planId: string;
  inPlan: string[];
  count: number;
}): string[] {
  const lastUsed = (id: string) =>
    uses
      .filter((u) => u.songId === id && u.planId !== planId)
      .map((u) => u.date)
      .sort()
      .at(-1) ?? "";
  const ok = library
    .filter((s) => !inPlan.includes(s.id) && !tooSoon(uses, s.id, date, planId))
    .sort((a, b) => lastUsed(a.id).localeCompare(lastUsed(b.id)));
  return ok.slice(0, count).map((s) => s.id);
}
