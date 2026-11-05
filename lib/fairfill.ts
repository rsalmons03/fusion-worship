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
  canDouble = () => false,
  weight = () => 1,
}: {
  slots: Slot[]; // empty spots to fill, any order
  candidates: Record<string, string[]>; // positionId → people who play it
  existing: Booking[]; // already booked in the range (counts toward fairness)
  blocked: (profileId: string, date: string) => boolean;
  verified: (profileId: string) => boolean;
  avoidBackToBack?: boolean;
  /** Hard limit on consecutive weeks for one person (0 = no limit). */
  maxInARow?: number;
  /** Positions someone may do alongside another one in the same service (e.g. vocals). */
  canDouble?: (positionId: string) => boolean;
  /** Share of a position's rotation: 1 main, 0.5 half as often, 0 only if no one else can. */
  weight?: (positionId: string, profileId: string) => number;
}): Booking[] {
  const out: Booking[] = [];
  const all = () => [...existing, ...out];
  const dayDiff = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

  // Who could take this spot right now (not blocked, not over the in-a-row limit, not clashing on that service).
  const eligible = (s: Slot) =>
    (candidates[s.positionId] ?? [])
      .filter((p) => !blocked(p, s.date))
      .filter((p) => !maxInARow || runIfBooked(all().filter((b) => b.profileId === p && b.planId !== s.planId).map((b) => b.date), s.date) <= maxInARow)
      .filter((p) => {
        const mineHere = all().filter((b) => b.profileId === p && b.planId === s.planId);
        return !mineHere.some((b) => b.positionId === s.positionId || !(canDouble(b.positionId) || canDouble(s.positionId)));
      });

  const dates = [...new Set(slots.map((s) => s.date))].sort();
  for (const date of dates) {
    let pending = slots.filter((s) => s.date === date);
    while (pending.length) {
      // Hardest spot first: the one with the fewest people who could take it.
      const ranked = pending.map((s) => ({ s, opts: eligible(s) })).sort((a, b) => a.opts.length - b.opts.length);
      const { s, opts } = ranked[0];
      pending = pending.filter((x) => x !== s);
      if (!opts.length) continue;
      const others = pending.filter((x) => x.planId === s.planId);
      const best = opts
        .map((p) => {
          const mine = all().filter((b) => b.profileId === p);
          const countHere = mine.filter((b) => b.positionId === s.positionId).length;
          const w = weight(s.positionId, p);
          // Services relative to their share: a ½ player with 2 counts like a main player with 4.
          const load = w > 0 ? (countHere + 1) / w : 1e6 + countHere;
          const alsoServing = mine.some((b) => b.planId === s.planId);
          // Still needed as a main player for another open spot on this service (e.g. a main drummer).
          const neededElsewhere = others.some(
            (o) => o.positionId !== s.positionId && weight(o.positionId, p) >= 1 && (candidates[o.positionId] ?? []).includes(p) && !(canDouble(o.positionId) || canDouble(s.positionId))
          );
          const near = mine.some((b) => b.planId !== s.planId && dayDiff(b.date, s.date) <= 7);
          const last = mine.map((b) => b.date).sort().at(-1) ?? "";
          return { p, load, alsoServing, neededElsewhere, near, last };
        })
        .sort(
          (a, b) =>
            Number(a.alsoServing) - Number(b.alsoServing) || // prefer someone not already on this service
            Number(a.neededElsewhere) - Number(b.neededElsewhere) || // keep main players for their main spot
            a.load - b.load || // fewest services for their share first ("only if needed" last)
            (avoidBackToBack ? Number(a.near) - Number(b.near) : 0) || // rest between weeks
            a.last.localeCompare(b.last) || // longest since they last served
            Number(verified(b.p)) - Number(verified(a.p)) // confirmed members first
        )[0];
      out.push({ ...s, profileId: best.p });
    }
  }
  return out;
}
