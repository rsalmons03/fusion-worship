// Personality and gifting assessments (Enneagram, Working Genius, spiritual gifts, …).
// People take the tests on the official sites; the app stores their results in one place
// so leaders can find strengths, gaps and good fits across the whole church.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Kind = "enneagram" | "working_genius" | "spiritual_gifts" | "disc" | "strengths" | "mbti";

export type Results = {
  enneagram?: { type: number; wing?: number | null };
  working_genius?: { genius: string[]; competency: string[]; frustration: string[] };
  spiritual_gifts?: { top: string[] }; // strongest first
  disc?: { primary: string; secondary?: string | null };
  strengths?: { top: string[] }; // CliftonStrengths top 5, in order
  mbti?: { type: string };
};
export type Row = { profile_id: string; kind: Kind; data: Record<string, unknown>; taken_on: string | null; updated_at: string };

export const ENNEAGRAM = [
  { n: 1, name: "Reformer", gist: "principled, careful, improves things" },
  { n: 2, name: "Helper", gist: "caring, generous, people-focused" },
  { n: 3, name: "Achiever", gist: "driven, adaptable, gets results" },
  { n: 4, name: "Individualist", gist: "creative, expressive, deep" },
  { n: 5, name: "Investigator", gist: "curious, insightful, independent" },
  { n: 6, name: "Loyalist", gist: "committed, responsible, prepared" },
  { n: 7, name: "Enthusiast", gist: "energetic, optimistic, fun" },
  { n: 8, name: "Challenger", gist: "decisive, protective, strong" },
  { n: 9, name: "Peacemaker", gist: "calm, steady, brings people together" },
];
export const wingsOf = (t: number) => [t === 1 ? 9 : t - 1, t === 9 ? 1 : t + 1];

export const GENIUS = [
  { key: "Wonder", gist: "asks the big questions, sees what could be" },
  { key: "Invention", gist: "comes up with new ideas and solutions" },
  { key: "Discernment", gist: "good gut on what will work" },
  { key: "Galvanizing", gist: "rallies people to get moving" },
  { key: "Enablement", gist: "jumps in to help and support" },
  { key: "Tenacity", gist: "pushes things over the finish line" },
];

export const GIFTS = [
  "Administration", "Apostleship", "Craftsmanship", "Creative Arts", "Discernment", "Encouragement", "Evangelism", "Faith",
  "Giving", "Healing", "Helps / Service", "Hospitality", "Intercession", "Knowledge", "Leadership", "Mercy", "Music / Worship",
  "Pastoring / Shepherding", "Prophecy", "Teaching", "Wisdom",
];

export const DISC = [
  { key: "D", name: "Dominance", gist: "direct, results-driven" },
  { key: "I", name: "Influence", gist: "outgoing, enthusiastic" },
  { key: "S", name: "Steadiness", gist: "patient, dependable" },
  { key: "C", name: "Conscientiousness", gist: "accurate, analytical" },
];

export const STRENGTHS = [
  "Achiever", "Activator", "Adaptability", "Analytical", "Arranger", "Belief", "Command", "Communication", "Competition", "Connectedness",
  "Consistency", "Context", "Deliberative", "Developer", "Discipline", "Empathy", "Focus", "Futuristic", "Harmony", "Ideation", "Includer",
  "Individualization", "Input", "Intellection", "Learner", "Maximizer", "Positivity", "Relator", "Responsibility", "Restorative",
  "Self-Assurance", "Significance", "Strategic", "Woo",
];

export const MBTI = ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];

export const KINDS: { kind: Kind; name: string; short: string; take: { label: string; url: string }; help: string }[] = [
  { kind: "enneagram", name: "Enneagram", short: "Enneagram", take: { label: "truity.com", url: "https://www.truity.com" }, help: "Your number (1–9) and, if you know it, your wing." },
  { kind: "working_genius", name: "Working Genius", short: "Working Genius", take: { label: "workinggenius.com", url: "https://www.workinggenius.com" }, help: "Your 2 geniuses, 2 competencies and 2 frustrations." },
  { kind: "spiritual_gifts", name: "Spiritual gifts", short: "Gifts", take: { label: "spiritualgiftstest.com", url: "https://spiritualgiftstest.com" }, help: "Tap your top gifts, strongest first (up to 5)." },
  { kind: "disc", name: "DISC", short: "DISC", take: { label: "truity.com", url: "https://www.truity.com" }, help: "Your main style and, if you have one, your second." },
  { kind: "strengths", name: "CliftonStrengths", short: "Strengths", take: { label: "gallup.com", url: "https://www.gallup.com/cliftonstrengths" }, help: "Your top 5 strengths, in order." },
  { kind: "mbti", name: "Myers-Briggs / 16 Personalities", short: "MBTI", take: { label: "16personalities.com", url: "https://www.16personalities.com" }, help: "Your 4-letter type." },
];

/** True when a result has been filled in enough to count. */
export function complete(kind: Kind, d: Record<string, unknown> | undefined): boolean {
  if (!d) return false;
  const r = d as Record<string, unknown> & { genius?: string[]; top?: string[]; type?: unknown; primary?: string };
  switch (kind) {
    case "enneagram": return typeof r.type === "number";
    case "working_genius": return (r.genius?.length ?? 0) > 0;
    case "spiritual_gifts": case "strengths": return (r.top?.length ?? 0) > 0;
    case "disc": return !!r.primary;
    case "mbti": return typeof r.type === "string" && r.type.length === 4;
  }
}

/** One-line summary, e.g. "2w3 Helper" or "Wonder + Invention". */
export function summary(kind: Kind, d: Record<string, unknown> | undefined): string {
  if (!d || !complete(kind, d)) return "";
  const r = d as { type?: number | string; wing?: number | null; genius?: string[]; top?: string[]; primary?: string; secondary?: string | null };
  switch (kind) {
    case "enneagram": return `${r.type}${r.wing ? `w${r.wing}` : ""} ${ENNEAGRAM[Number(r.type) - 1].name}`;
    case "working_genius": return (r.genius ?? []).join(" + ");
    case "spiritual_gifts": case "strengths": return (r.top ?? []).join(", ");
    case "disc": return (r.primary ?? "") + (r.secondary ?? "");
    case "mbti": return String(r.type);
  }
}

/** Every searchable tag a person's results give, e.g. "enneagram:2", "wg-genius:Tenacity", "gift:Teaching". */
export function tags(all: Partial<Record<Kind, Record<string, unknown>>>): string[] {
  const out: string[] = [];
  const e = all.enneagram as Results["enneagram"];
  if (e?.type) out.push(`enneagram:${e.type}`);
  const w = all.working_genius as Results["working_genius"];
  w?.genius?.forEach((g) => out.push(`wg-genius:${g}`));
  w?.competency?.forEach((g) => out.push(`wg-competency:${g}`));
  w?.frustration?.forEach((g) => out.push(`wg-frustration:${g}`));
  (all.spiritual_gifts as Results["spiritual_gifts"])?.top?.forEach((g, i) => out.push(`gift:${g}`, ...(i < 3 ? [`gift-top3:${g}`] : [])));
  const d = all.disc as Results["disc"];
  if (d?.primary) out.push(`disc:${d.primary}`);
  (all.strengths as Results["strengths"])?.top?.forEach((s) => out.push(`strength:${s}`));
  const m = all.mbti as Results["mbti"];
  if (m?.type) out.push(`mbti:${m.type}`, `mbti-ei:${m.type[0]}`);
  return out;
}

/** Gifts and strengths that tend to fit each kind of team (matched on the team's name), for recruiting ideas. */
export const TEAM_FIT: { test: RegExp; gifts: string[]; genius: string[]; note: string }[] = [
  { test: /worship|band|music|vocal/i, gifts: ["Music / Worship", "Creative Arts"], genius: ["Invention", "Galvanizing"], note: "musical, creative" },
  { test: /kid|child|nursery|youth|student/i, gifts: ["Teaching", "Pastoring / Shepherding", "Mercy", "Helps / Service"], genius: ["Enablement"], note: "teaching, shepherding" },
  { test: /dream|greet|host|hospitality|usher|parking|welcome/i, gifts: ["Hospitality", "Helps / Service", "Encouragement", "Evangelism"], genius: ["Enablement", "Galvanizing"], note: "welcoming, serving" },
  { test: /production|tech|sound|media|lights|livestream/i, gifts: ["Craftsmanship", "Helps / Service", "Creative Arts"], genius: ["Tenacity", "Discernment"], note: "hands-on, detail-minded" },
  { test: /prayer|care/i, gifts: ["Intercession", "Mercy", "Faith", "Pastoring / Shepherding"], genius: ["Enablement"], note: "caring, praying" },
];

export async function loadAll(supabase: SupabaseClient): Promise<{ rows: Row[]; ok: boolean }> {
  const { data, error } = await supabase.from("assessments").select("*");
  return { rows: (data ?? []) as Row[], ok: !error };
}

export async function saveResult(supabase: SupabaseClient, profileId: string, kind: Kind, data: Record<string, unknown> | null) {
  if (!data) return supabase.from("assessments").delete().eq("profile_id", profileId).eq("kind", kind);
  return supabase.from("assessments").upsert({ profile_id: profileId, kind, data, updated_at: new Date().toISOString() });
}
