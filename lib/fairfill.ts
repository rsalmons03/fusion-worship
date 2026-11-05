// Fair rotation: fills empty spots so each person who plays a position gets about the same number of services,
// and nobody is booked more than `maxInARow` weeks in a row.
import { weekIndex } from "./health";

/** Longest run of back-to-back weeks that includes `date`, if this person were booked then too. */
export function runIfBooked(dates: string[], date: string) {
  const weeks = new Set([...dates, date].map(weekIndex));
  const w = weekIndex(date);
  let n = 1;
  for (let x = w - 1; weeks.has(x); x--) n++;
  for (let x = w + 1; weeks.has(x); x++) n++;
  return n;
}

export type Slot = { planId: string; date: string; positionId: string };
export type Booking = { planId: string; date: string; positionId: string; profileId: string };

export function fairFill({
  slots,
  candidates,
  existing,
  blocked,
  verified,
  avoidBackToBack = true,
  maxInARow = 2,
}: {
  slots: Slot[]; // empty spots to fill, any order
  candidates: Record<string, string[]>; // positionId → people who play it
  existing: Booking[]; // already booked in the range (counts toward fairness)
  blocked: (profileId: string, date: string) => boolean;
  verified: (profileId: string) => boolean;
  avoidBackToBack?: boolean;
  /** Hard limit on consecutive weeks for one person (0 = no limit). */
  maxInARow?: number;
}): Booking[] {
  const out: Booking[] = [];
  const all = () => [...existing, ...out];
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const dayDiff = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

  for (const s of sorted) {
    const people = candidates[s.positionId] ?? [];
    const options = people
      .filter((p) => !blocked(p, s.date))
      .filter((p) => !maxInARow || runIfBooked(all().filter((b) => b.profileId === p && b.planId !== s.planId).map((b) => b.date), s.date) <= maxInARow)
      .map((p) => {
        const mine = all().filter((b) => b.profileId === p);
        const countHere = mine.filter((b) => b.positionId === s.positionId).length;
        const busySamePlan = mine.some((b) => b.planId === s.planId);
        const near = mine.some((b) => b.planId !== s.planId && dayDiff(b.date, s.date) <= 7);
        const last = mine.map((b) => b.date).sort().at(-1) ?? "";
        return { p, countHere, busySamePlan, near, last };
      })
      .sort(
        (a, b) =>
          Number(a.busySamePlan) - Number(b.busySamePlan) || // don't double-book the same service
          a.countHere - b.countHere || // fewest services on this position first
          (avoidBackToBack ? Number(a.near) - Number(b.near) : 0) || // rest between weeks
          a.last.localeCompare(b.last) || // longest since they last served
          Number(verified(b.p)) - Number(verified(a.p)) // confirmed members first
      );
    const pick = options[0];
    if (pick && !pick.busySamePlan) out.push({ ...s, profileId: pick.p });
  }
  return out;
}
