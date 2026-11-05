// Repeating dates and copying a plan's times / order to other dates.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Repeat = "none" | "weekly" | "biweekly" | "monthly";

const toDate = (iso: string) => new Date(iso + "T12:00:00Z");
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function daysBetween(a: string, b: string) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** The same weekday in the same week-of-month (e.g. "1st Sunday"), or the last one if that week doesn't exist. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  let day = 1 + offset + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  while (day > daysInMonth) day -= 7;
  return toISO(new Date(Date.UTC(year, month, day, 12)));
}

/** All dates from `start` (included) to `until` (included) for a repeat rule. At most 60. */
export function repeatDates(start: string, rule: Repeat, until: string): string[] {
  if (rule === "none" || !until || until < start) return [start];
  const out: string[] = [];
  if (rule === "monthly") {
    const s = toDate(start);
    const weekday = s.getUTCDay();
    const nth = Math.ceil(s.getUTCDate() / 7);
    for (let i = 0; out.length < 60; i++) {
      const m = s.getUTCMonth() + i;
      const d = nthWeekdayOfMonth(s.getUTCFullYear() + Math.floor(m / 12), m % 12, weekday, nth);
      if (d > until) break;
      out.push(d);
    }
    return out;
  }
  const step = rule === "weekly" ? 7 : 14;
  for (let d = start; d <= until && out.length < 60; d = addDays(d, step)) out.push(d);
  return out;
}

export function describeRepeat(start: string, rule: Repeat) {
  const d = toDate(start);
  const wd = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  if (rule === "weekly") return `Every ${wd}`;
  if (rule === "biweekly") return `Every other ${wd}`;
  if (rule === "monthly") return `The ${["1st", "2nd", "3rd", "4th", "last"][Math.ceil(d.getUTCDate() / 7) - 1]} ${wd} of every month`;
  return "Doesn't repeat";
}

type TimeRow = { kind: string; label: string | null; day: string; starts: string | null; ends: string | null };

/** Copies times from one plan to another, keeping each time the same number of days from the service. */
export async function copyTimes(supabase: SupabaseClient, fromPlanId: string, fromDate: string, toPlanId: string, toDate: string, replace = false) {
  const { data, error } = await supabase.from("plan_times").select("kind,label,day,starts,ends").eq("plan_id", fromPlanId);
  if (error) return error.message;
  const rows = (data ?? []) as TimeRow[];
  if (!rows.length) return null;
  if (replace) await supabase.from("plan_times").delete().eq("plan_id", toPlanId);
  const shift = daysBetween(fromDate, toDate);
  const { error: e2 } = await supabase.from("plan_times").insert(rows.map((r) => ({ ...r, plan_id: toPlanId, day: addDays(r.day, shift) })));
  return e2?.message ?? null;
}

/** Copies the order of service (songs, items, headers, notes). No people. */
export async function copyItems(supabase: SupabaseClient, fromPlanId: string, toPlanId: string) {
  const { data } = await supabase.from("plan_items").select("*").eq("plan_id", fromPlanId).order("position");
  if (!data?.length) return null;
  const { error } = await supabase.from("plan_items").insert(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    data.map(({ id, plan_id, songs, ...rest }) => ({ ...rest, plan_id: toPlanId }))
  );
  return error?.message ?? null;
}
