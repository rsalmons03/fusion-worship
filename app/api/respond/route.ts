import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupToken } from "@/lib/tokens";

// Form POST from /respond/[token]. Never a GET, so email link scanners can't accept on someone's behalf.
export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const status = String(form.get("status") ?? "");
  if (status !== "accepted" && status !== "declined") return NextResponse.json({ error: "Bad status" }, { status: 400 });
  const info = await lookupToken(token);
  if (!info) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  await createAdminClient()
    .from("assignments")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("id", info.assignmentId);
  return NextResponse.redirect(new URL(`/respond/${token}?done=1`, req.url), 303);
}
