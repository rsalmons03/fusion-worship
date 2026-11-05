import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderTemplate, TemplateItem } from "./types";

/** Puts a template's order of service into a plan (replacing or adding to what's there). */
export async function applyTemplate(supabase: SupabaseClient, t: Pick<OrderTemplate, "items">, planId: string, mode: "replace" | "append" = "replace") {
  let start = 0;
  if (mode === "replace") {
    const { error } = await supabase.from("plan_items").delete().eq("plan_id", planId);
    if (error) return error.message;
  } else {
    const { data } = await supabase.from("plan_items").select("position").eq("plan_id", planId).order("position", { ascending: false }).limit(1);
    start = data?.[0]?.position ?? 0;
  }
  if (!t.items.length) return null;
  const { error } = await supabase.from("plan_items").insert(
    t.items.map((it, i) => ({
      plan_id: planId,
      position: start + i + 1,
      kind: it.kind,
      title: it.title,
      duration_min: it.duration_min,
      description: it.description,
      song_id: null,
      song_key: null,
    }))
  );
  return error?.message ?? null;
}

/** A plan's order of service as template rows (songs become "song" rows by name only). */
export function itemsToTemplate(items: { kind: string; title: string; duration_min: number | null; description: string | null }[]): TemplateItem[] {
  return items.map((i) => ({
    kind: i.kind === "song" ? "item" : (i.kind as TemplateItem["kind"]),
    title: i.title,
    duration_min: i.duration_min,
    description: i.description,
  }));
}

export async function loadTemplates(supabase: SupabaseClient): Promise<OrderTemplate[]> {
  const { data, error } = await supabase.from("order_templates").select("*").order("name");
  if (error) return [];
  return (data ?? []) as OrderTemplate[];
}
