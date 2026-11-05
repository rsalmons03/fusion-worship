import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The version the server is running now. Open pages compare it with their own to know when to refresh.
export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? "" },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
