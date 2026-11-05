import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// Service-role client. SERVER-ONLY — bypasses RLS. Never import into a client component.
export function createAdminClient() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").replace(/\s+/g, "");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
