import type { AssignmentStatus } from "@/lib/types";

/** Shows a real name, or a tidy one made from the email if no name is set. */
export function displayName(p?: { full_name?: string | null; email?: string | null } | null) {
  if (!p) return "Unknown";
  if (p.full_name?.trim()) return p.full_name.trim();
  const local = (p.email ?? "").split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown";
}

const PALETTE = ["bg-orange-200 text-orange-900", "bg-sky-200 text-sky-900", "bg-emerald-200 text-emerald-900", "bg-violet-200 text-violet-900", "bg-amber-200 text-amber-900", "bg-rose-200 text-rose-900", "bg-teal-200 text-teal-900"];

/** Round initials avatar with an optional status badge (✓ confirmed, ? waiting, ✕ declined). */
export default function Avatar({
  name,
  status,
  size = "md",
}: {
  name: string;
  status?: AssignmentStatus | "no_show" | null;
  size?: "sm" | "md";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = PALETTE[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
  const dim = size === "sm" ? "h-8 w-8 text-[11px]" : "h-9 w-9 text-xs";
  const badge =
    status === "accepted"
      ? { cls: "bg-ok", ch: "✓" }
      : status === "declined" || status === "no_show"
      ? { cls: "bg-bad", ch: "✕" }
      : status === "pending"
      ? { cls: "bg-amber-500", ch: "?" }
      : status === "unsent"
      ? { cls: "bg-stone-400", ch: "•" }
      : null;
  return (
    <span className={`relative inline-grid shrink-0 place-items-center rounded-full font-bold ${dim} ${color}`} aria-hidden>
      {initials || "?"}
      {badge && (
        <span className={`absolute -bottom-0.5 -left-0.5 grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] leading-none text-white ring-2 ring-white ${badge.cls}`}>
          {badge.ch}
        </span>
      )}
    </span>
  );
}
