import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Location, Profile } from "@/lib/types";

export async function requireProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("profiles").select("id,email,full_name,phone,role,location_id").eq("id", user.id).maybeSingle();
  if (error) {
    // Database not migrated for locations yet: fall back so the app keeps working.
    const { data: old } = await supabase.from("profiles").select("id,email,full_name,phone,role").eq("id", user.id).maybeSingle();
    return old ? ({ ...old, location_id: null } as Profile) : null;
  }
  return (data as Profile) ?? null;
}

export async function loadLocations(): Promise<Location[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("locations").select("*").order("sort");
  return (data ?? []) as Location[];
}
