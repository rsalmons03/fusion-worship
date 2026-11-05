"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Location, Profile } from "@/lib/types";

type Ctx = {
  profile: Profile;
  locations: Location[];
  /** Location being viewed; null = all locations. Fixed to the person's own location if they have one. */
  current: string | null;
  setCurrent: (id: string | null) => void;
};

const C = createContext<Ctx | null>(null);
const KEY = "fw.location";

export function ProfileProvider({ profile, locations, children }: { profile: Profile; locations: Location[]; children: React.ReactNode }) {
  const fixed = profile.location_id;
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (fixed) return;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && locations.some((l) => l.id === saved)) setChosen(saved);
    } catch {}
  }, [fixed, locations]);
  const setCurrent = (id: string | null) => {
    setChosen(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {}
  };
  return <C.Provider value={{ profile, locations, current: fixed ?? chosen, setCurrent }}>{children}</C.Provider>;
}

function useCtx() {
  const c = useContext(C);
  if (!c) throw new Error("useProfile outside ProfileProvider");
  return c;
}

export function useProfile() {
  const { profile: p } = useCtx();
  return { ...p, isLeader: p.role === "admin" || p.role === "leader", isAdmin: p.role === "admin" };
}

export function useLocations() {
  const { locations, current, setCurrent, profile } = useCtx();
  const name = (id: string | null | undefined) => (id ? locations.find((l) => l.id === id)?.name ?? "" : "");
  return { locations, current, setCurrent, canSwitch: !profile.location_id, name };
}
