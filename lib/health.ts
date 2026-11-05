// Team-health numbers worked out from each person's schedule history.
import type { AssignmentStatus } from "./types";

export type HistRow = {
  profile_id: string;
  status: AssignmentStatus;
  attendance?: "present" | "no_show" | null;
  date: string; // service date YYYY-MM-DD
};

export type Health = {
  served: number; // past services they were confirmed for and didn't miss
  accepted: number;
  declined: number;
  noAnswer: number; // asked, never answered, and the date has passed
  noShows90: number; // confirmed but marked no-show in the last 90 days
  noShows: number;
  acceptRate: number | null; // 0..1 of past requests
  streak: number; // consecutive weeks scheduled (now / upcoming)
  streakFrom: string | null;
  lastServed: string | null;
  nextServing: string | null;
};

export const RULES = {
  breakAfterWeeks: 3, // more than 2 weeks in a row
  concernNoShows90: 2,
  concernAcceptRate: 0.5,
  readyMonths: 3,
  readyServed: 4,
  readyAcceptRate: 0.8,
  quietDays: 60,
};

/** Monday-based week number since 1970, used to find back-to-back weeks. */
export function weekIndex(d: string) {
  const t = new Date(d + "T12:00:00Z").getTime() / 86400000; // days since epoch
  return Math.floor((t + 3) / 7); // 1970-01-01 was a Thursday; +3 makes weeks start Monday
}

const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000);

export function healthFor(rows: HistRow[], today: string): Health {
  const past = rows.filter((r) => r.date < today && r.status !== "unsent");
  const accepted = past.filter((r) => r.status === "accepted").length;
  const declined = past.filter((r) => r.status === "declined").length;
  const noAnswer = past.filter((r) => r.status === "pending").length;
  const noShowRows = rows.filter((r) => r.attendance === "no_show");
  const noShows90 = noShowRows.filter((r) => r.date < today && daysBetween(r.date, today) <= 90).length;
  const servedRows = past.filter((r) => r.status === "accepted" && r.attendance !== "no_show");
  const asked = accepted + declined + noAnswer;

  // Streak: back-to-back weeks they're on the schedule (not declined), around today and ahead.
  const weeks = [...new Set(rows.filter((r) => r.status !== "declined" && r.attendance !== "no_show").map((r) => weekIndex(r.date)))].sort((a, b) => a - b);
  const nowW = weekIndex(today);
  let best = 0;
  let bestStart: number | null = null;
  let run = 0;
  let runStart = 0;
  for (let i = 0; i < weeks.length; i++) {
    if (i > 0 && weeks[i] === weeks[i - 1] + 1) run++;
    else {
      run = 1;
      runStart = weeks[i];
    }
    // Only count runs that reach this week or later (a current or upcoming stretch).
    if (weeks[i] >= nowW - 1 && run > best) {
      best = run;
      bestStart = runStart;
    }
  }
  const startRow = bestStart !== null ? rows.filter((r) => weekIndex(r.date) === bestStart).sort((a, b) => a.date.localeCompare(b.date))[0] : null;

  const sortedPast = servedRows.map((r) => r.date).sort();
  const upcoming = rows.filter((r) => r.date >= today && r.status !== "declined").map((r) => r.date).sort();

  return {
    served: servedRows.length,
    accepted,
    declined,
    noAnswer,
    noShows90,
    noShows: noShowRows.length,
    acceptRate: asked ? accepted / asked : null,
    streak: best,
    streakFrom: startRow?.date ?? null,
    lastServed: sortedPast.at(-1) ?? null,
    nextServing: upcoming[0] ?? null,
  };
}

/** Months between two dates (rounded down). */
export function monthsSince(from: string | null | undefined, today: string) {
  if (!from) return 0;
  return Math.floor(daysBetween(from.slice(0, 10), today) / 30.44);
}
