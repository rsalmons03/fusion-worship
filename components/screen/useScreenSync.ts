"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SCREEN, screenChannel, type ScreenState } from "@/lib/slides";

type Stamped = ScreenState & { at: number };

/**
 * Keeps the projector screen and any phone remotes on the same slide, live, over Supabase Realtime.
 * Newest change wins. A device that joins late asks the others for the current state.
 */
export function useScreenSync(planId: string) {
  const [state, setLocal] = useState<Stamped>({ ...DEFAULT_SCREEN, at: 0 });
  const [online, setOnline] = useState(false);
  const ref = useRef(state);
  ref.current = state;
  const chan = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const c = supabase.channel(screenChannel(planId), { config: { broadcast: { self: false } } });
    c.on("broadcast", { event: "state" }, ({ payload }) => {
      const p = payload as Stamped;
      if (p && p.at > ref.current.at) setLocal(p);
    })
      .on("broadcast", { event: "hello" }, () => {
        if (ref.current.at) c.send({ type: "broadcast", event: "state", payload: ref.current });
      })
      .subscribe((s) => {
        setOnline(s === "SUBSCRIBED");
        if (s === "SUBSCRIBED") c.send({ type: "broadcast", event: "hello", payload: {} });
      });
    chan.current = c;
    return () => {
      supabase.removeChannel(c);
      chan.current = null;
    };
  }, [planId]);

  const set = useCallback((patch: Partial<ScreenState> | ((s: ScreenState) => Partial<ScreenState>)) => {
    const cur = ref.current;
    const next: Stamped = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch), at: Date.now() };
    ref.current = next;
    setLocal(next);
    chan.current?.send({ type: "broadcast", event: "state", payload: next });
  }, []);

  return { state, set, online };
}
