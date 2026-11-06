import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrediction, segmentsOf, startTranscribe } from "@/lib/replicate";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function leaderOnly() {
  const me = await callerProfile();
  return me && (me.role === "admin" || me.role === "leader") ? me : null;
}

// Auto-sync step 1: start listening to a song's audio (best: its vocals stem).
export async function POST(req: Request) {
  if (!(await leaderOnly())) return NextResponse.json({ error: "Only leaders can auto-sync songs" }, { status: 403 });
  const { fileId } = await req.json().catch(() => ({}));
  if (!UUID_RE.test(String(fileId ?? ""))) return NextResponse.json({ error: "Bad file" }, { status: 400 });
  const admin = createAdminClient();
  const { data: file } = await admin.from("song_files").select("path").eq("id", fileId).maybeSingle();
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const { data: signed, error } = await admin.storage.from("charts").createSignedUrl(file.path, 60 * 60 * 2);
  if (error || !signed) return NextResponse.json({ error: error?.message ?? "Could not share the file" }, { status: 500 });
  try {
    const pred = await startTranscribe(signed.signedUrl);
    return NextResponse.json({ id: pred.id, status: pred.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Auto-sync step 2: check on it; when done, return the timed lines.
export async function GET(req: Request) {
  if (!(await leaderOnly())) return NextResponse.json({ error: "Only leaders can auto-sync songs" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{8,64}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  try {
    const p = await getPrediction(id);
    if (p.status === "succeeded") return NextResponse.json({ status: "succeeded", segments: segmentsOf(p.output) });
    return NextResponse.json({ status: p.status, error: p.error ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
