import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Returns the signed-in caller's profile (via their own RLS-bound session), or null.
export async function callerProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("id,email,full_name,phone,role").eq("id", user.id).maybeSingle();
  return (data as Profile) ?? null;
}
