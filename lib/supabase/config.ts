// Public Supabase connection values (safe for the browser; RLS is the security boundary).

// Keep only the origin, so a pasted value like "https://x.supabase.co/rest/v1/" still works.
function normalizeUrl(raw: string): string {
  const s = raw.trim();
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

export const SUPABASE_URL = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").replace(/\s+/g, "");
