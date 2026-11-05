"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildSlides, type SlideItem } from "@/lib/slides";
import type { Plan } from "@/lib/types";

/** Loads a plan's order and turns it into projector slides. */
export function usePlanSlides(planId: string, linesPerSlide: number) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<SlideItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const supabase = createClient();
    supabase.from("plans").select("*").eq("id", planId).maybeSingle().then(({ data, error }) => {
      if (error) setError(error.message);
      setPlan(data as Plan);
    });
    supabase
      .from("plan_items")
      .select("id, kind, title, description, songs(chordpro, author)")
      .eq("plan_id", planId)
      .order("position")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setItems((data ?? []) as unknown as SlideItem[]);
      });
  }, [planId]);
  const slides = useMemo(() => buildSlides(items, linesPerSlide), [items, linesPerSlide]);
  return { plan, items, slides, error };
}

/** Next/previous, skipping past the logo or a cleared screen first. */
export function stepState(s: { slide: number; logo: boolean; clear: boolean; black: boolean }, dir: 1 | -1, count: number) {
  if (s.logo || s.clear || s.black) return { logo: false, clear: false, black: false };
  return { slide: Math.max(0, Math.min(count - 1, s.slide + dir)) };
}
