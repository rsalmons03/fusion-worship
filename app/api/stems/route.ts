import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { getPrediction, startSplit, stemLabel, stemUrls } from "@/lib/replicate";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function leaderOnly() {
  const me = await callerProfile();
  return me && (me.role === "admin" || me.role === "leader") ? me : null;
}

// Start splitting one of a song's audio files into stems.
export async function POST(req: Request) {
  const me = await leaderOnly();
  if (!me) return NextResponse.json({ error: "Only leaders can split songs" }, { status: 403 });
  const { fileId } = await req.json().catch(() => ({}));
  if (!UUID_RE.test(String(fileId ?? ""))) return NextResponse.json({ error: "Bad file" }, { status: 400 });

  const admin = createAdminClient();
  const { data: file } = await admin.from("song_files").select("id,song_id,path,name").eq("id", fileId).maybeSingle();
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  // A link Replicate can download the song from (valid 2 hours).
  const { data: signed, error: se } = await admin.storage.from("charts").createSignedUrl(file.path, 60 * 60 * 2);
  if (se || !signed) return NextResponse.json({ error: se?.message ?? "Could not share the file" }, { status: 500 });

  try {
    const pred = await startSplit(signed.signedUrl);
    const { data: job, error } = await admin
      .from("stem_jobs")
      .insert({ song_id: file.song_id, file_id: file.id, prediction_id: pred.id, status: pred.status, created_by: me.id })
      .select("id")
      .single();
    if (error || !job) return NextResponse.json({ error: /stem_jobs/.test(error?.message ?? "") ? "Stem splitting needs the database update 014 (run ALL_UPDATES.sql)." : error?.message }, { status: 500 });
    return NextResponse.json({ jobId: job.id, status: pred.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Check a job; when Replicate has finished, save the parts to the song as stems.
export async function GET(req: Request) {
  const me = await leaderOnly();
  if (!me) return NextResponse.json({ error: "Only leaders can split songs" }, { status: 403 });
  const jobId = new URL(req.url).searchParams.get("job") ?? "";
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "Bad job" }, { status: 400 });

  const admin = createAdminClient();
  const { data: job } = await admin.from("stem_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status === "done" || job.status === "failed" || job.status === "importing") return NextResponse.json({ status: job.status, error: job.error });

  try {
    const pred = await getPrediction(job.prediction_id);
    if (pred.status === "failed" || pred.status === "canceled") {
      await admin.from("stem_jobs").update({ status: "failed", error: pred.error ?? pred.status, updated_at: new Date().toISOString() }).eq("id", job.id);
      return NextResponse.json({ status: "failed", error: pred.error ?? pred.status });
    }
    if (pred.status !== "succeeded") {
      if (pred.status !== job.status) await admin.from("stem_jobs").update({ status: pred.status, updated_at: new Date().toISOString() }).eq("id", job.id);
      return NextResponse.json({ status: pred.status });
    }

    // Claim the import so two checks can't both save the stems.
    const { data: claimed } = await admin
      .from("stem_jobs")
      .update({ status: "importing", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .in("status", ["starting", "processing", "succeeded"])
      .select("id");
    if (!claimed?.length) return NextResponse.json({ status: "importing" });

    const parts = stemUrls(pred.output);
    if (!parts.length) throw new Error("The splitter finished but returned no parts.");
    const { data: src } = await admin.from("song_files").select("name").eq("id", job.file_id).maybeSingle();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").replace(/\s+/g, "");
    let saved = 0;
    for (const [part, url] of parts) {
      const audio = await fetch(url);
      if (!audio.ok || !audio.body) continue;
      const path = `${job.song_id}/${crypto.randomUUID()}.mp3`;
      // Stream straight from Replicate into storage (no big buffers in the server).
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/charts/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "audio/mpeg", "x-upsert": "true" },
        body: audio.body,
        // @ts-expect-error: needed to send a streamed body (Node / Workers)
        duplex: "half",
      });
      if (!up.ok) throw new Error(`Saving ${part} failed: ${up.status} ${(await up.text()).slice(0, 150)}`);
      const name = `${stemLabel(part)} (split${src?.name ? ` from ${src.name}` : ""})`;
      let { error } = await admin.from("song_files").insert({ song_id: job.song_id, name, path, is_stem: true });
      if (error && /is_stem/.test(error.message)) ({ error } = await admin.from("song_files").insert({ song_id: job.song_id, name, path }));
      if (error) throw new Error(error.message);
      saved++;
    }
    await admin.from("stem_jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ status: "done", saved });
  } catch (e) {
    await admin.from("stem_jobs").update({ status: "failed", error: (e as Error).message, updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ status: "failed", error: (e as Error).message });
  }
}
