import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic-link landing: exchanges the one-time code for a session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await createClient().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
