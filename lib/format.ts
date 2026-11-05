export const CHURCH_NAME = process.env.NEXT_PUBLIC_CHURCH_NAME || "Fusion Church";

// Dates are stored as plain YYYY-MM-DD; parse at local noon so time zones never shift the day.
export function parseDate(d: string) {
  return new Date(`${d}T12:00:00`);
}

export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = {}) {
  return parseDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...opts,
  });
}

export function fmtTime(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${ampm}`;
}

// Adds minutes to an HH:MM[:SS] time and returns HH:MM.
export function addMinutes(t: string, mins: number) {
  const [h, m] = t.split(":").map(Number);
  const total = (h * 60 + m + mins + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nextSundayISO() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function planLabel(p: { title: string | null; service_date: string }) {
  return p.title?.trim() || fmtDate(p.service_date, { weekday: "long", year: undefined });
}
