// Lengths in the order of service, kept in seconds (e.g. 4:56) but compatible with whole minutes.

type HasLen = { duration_sec?: number | null; duration_min?: number | null };

/** Length in seconds, or null if not set. */
export function secOf(x: HasLen): number | null {
  if (x.duration_sec != null) return x.duration_sec;
  if (x.duration_min != null) return x.duration_min * 60;
  return null;
}

/** 296 → "4:56", 3600 → "60:00". */
export function fmtLen(sec: number | null | undefined) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "4:56" → 296, "5" → 300 (plain numbers are minutes), "" → null. */
export function parseLen(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

/** Both fields, so older screens that only read minutes still work. */
export function lenPatch(sec: number | null) {
  return { duration_sec: sec, duration_min: sec == null ? null : Math.round(sec / 60) };
}

/** Adds seconds to "HH:MM[:SS]" and returns "HH:MM". */
export function addSeconds(t: string, sec: number) {
  const [h, m, s] = t.split(":").map(Number);
  const total = (h * 3600 + m * 60 + (s || 0) + sec + 86400 * 10) % 86400;
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
