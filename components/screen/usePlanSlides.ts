"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SERMON_ITEM, buildSlides, type SlideItem } from "@/lib/slides";
import { loadSermon, type Sermon } from "@/lib/sermon";
import type { Plan } from "@/lib/types";

/** Loads a plan's order and turns it into projector slides. */
export function usePlanSlides(planId: string, linesPerSlide: number) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<SlideItem[]>([]);
  const [error, setError] = useState("");
  const [sermon, setSermon] = useState<Sermon | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.from("plans").select("*").eq("id", planId).maybeSingle().then(({ data, error }) => {
      if (error) setError(error.message);
      setPlan(data as Plan);
    });
    supabase
      .from("plan_items")
      .select("id, kind, title, description, song_id, songs(chordpro, author)")
      .eq("plan_id", planId)
      .order("position")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setItems((data ?? []) as unknown as SlideItem[]);
      });
    loadSermon(planId).then(setSermon);
  }, [planId]);
  const slides = useMemo(() => buildSlides(items, linesPerSlide, sermon), [items, linesPerSlide, sermon]);
  // The remote groups slides by order item; give the sermon its own group.
  const allItems = useMemo(() => {
    if (!sermon?.slides.length) return items;
    const at = items.findIndex((i) => i.kind !== "header" && i.kind !== "song" && SERMON_ITEM.test(i.title));
    const s: SlideItem = { id: "sermon", kind: "sermon", title: `Sermon: ${sermon.title}` };
    return at >= 0 ? [...items.slice(0, at), s, ...items.slice(at + 1)] : [...items, s];
  }, [items, sermon]);
  return { plan, items: allItems, slides, error };
}

/** Next/previous, skipping past the logo or a cleared screen first. */
export function stepState(s: { slide: number; logo: boolean; clear: boolean; black: boolean }, dir: 1 | -1, count: number) {
  if (s.logo || s.clear || s.black) return { logo: false, clear: false, black: false };
  return { slide: Math.max(0, Math.min(count - 1, s.slide + dir)) };
}
