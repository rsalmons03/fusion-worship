import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function requireProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.from("profiles").select("id,email,full_name,phone,role").eq("id", user.id).maybeSingle();
  return (data as Profile) ?? null;
}
