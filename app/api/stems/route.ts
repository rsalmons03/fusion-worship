import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrediction, startSplit, stemLabel, stemUrls } from "@/lib/replicate";
import { getMusicAI, isAudioOutput, maiLabel, musicAIConfigured, resultLinks, startMusicAI } from "@/lib/musicai";

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
    // Music.AI (Moises) when it's set up; otherwise Replicate.
    const pred = musicAIConfigured()
      ? await startMusicAI(signed.signedUrl, file.name).then((j) => ({ id: `mai:${j.id}`, status: "starting" }))
      : await startSplit(signed.signedUrl);
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
  const stuck = job.status === "importing" && Date.now() - new Date(job.updated_at).getTime() > 3 * 60 * 1000;
  if (job.status === "done" || job.status === "failed" || (job.status === "importing" && !stuck)) return NextResponse.json({ status: job.status, error: job.error });

  try {
    const isMai = String(job.prediction_id ?? "").startsWith("mai:");
    const pred = isMai
      ? await getMusicAI(job.prediction_id.slice(4)).then((j) => ({ status: j.status, output: j.result, error: j.error }))
      : await getPrediction(job.prediction_id);
    if (pred.status === "failed" || pred.status === "canceled") {
      await admin.from("stem_jobs").update({ status: "failed", error: pred.error ?? pred.status, updated_at: new Date().toISOString() }).eq("id", job.id);
      return NextResponse.json({ status: "failed", error: pred.error ?? pred.status });
    }
    if (pred.status !== "succeeded") {
      if (pred.status !== job.status) await admin.from("stem_jobs").update({ status: pred.status, updated_at: new Date().toISOString() }).eq("id", job.id);
      return NextResponse.json({ status: pred.status });
    }

    // Claim the import so two checks can't both save the stems. An import that stalled (e.g. the
    // request was cut off) for over 3 minutes can be claimed again.
    const stale = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    let { data: claimed } = await admin
      .from("stem_jobs")
      .update({ status: "importing", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .in("status", ["starting", "processing", "succeeded"])
      .select("id");
    if (!claimed?.length && job.status === "importing" && job.updated_at < stale)
      ({ data: claimed } = await admin.from("stem_jobs").update({ status: "importing", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "importing").lt("updated_at", stale).select("id"));
    if (!claimed?.length) return NextResponse.json({ status: "importing" });

    let parts: [string, string][];
    if (isMai) {
      const links = resultLinks(pred.output as Record<string, unknown>);
      // Keep Music.AI's whole result (chords, beats, sections, lyrics…) with the song for the player.
      await admin.storage
        .from("charts")
        .upload(`analysis/${job.song_id}.json`, new Blob([JSON.stringify({ source: "music.ai", at: new Date().toISOString(), result: pred.output })], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      parts = links.filter(([n, u]) => isAudioOutput(n, u)).map(([n, u]) => [maiLabel(n), u]);
    } else parts = stemUrls(pred.output).map(([n, u]) => [stemLabel(n), u]);
    if (!parts.length) throw new Error("The splitter finished but returned no audio parts. (Music.AI: check the workflow has stem outputs.)");
    const work = importParts(job, parts, isMai);
    // Let the save finish on the server even if the phone disconnects (Cloudflare keeps it running).
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      getCloudflareContext().ctx.waitUntil(work.catch(() => {}));
      return NextResponse.json({ status: "importing" });
    } catch {
      const saved = await work; // not on Cloudflare (local dev): just wait
      return NextResponse.json({ status: "done", saved });
    }
  } catch (e) {
    await admin.from("stem_jobs").update({ status: "failed", error: (e as Error).message, updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ status: "failed", error: (e as Error).message });
  }
}

/** Downloads every part from Replicate and saves it to the song as a stem (all at once). */
async function importParts(job: { id: string; song_id: string; file_id: string }, parts: [string, string][], oneAtATime = false) {
  const admin = createAdminClient();
  try {
    const { data: src } = await admin.from("song_files").select("name").eq("id", job.file_id).maybeSingle();
    const { data: existing } = await admin.from("song_files").select("name").eq("song_id", job.song_id);
    const have = new Set((existing ?? []).map((f) => f.name));
    const used = new Set<string>();
    const one = async ([part, url]: [string, string]) => {
      let label = part;
      for (let k = 2; used.has(label); k++) label = `${part} ${k}`;
      used.add(label);
      const name = `${label} (split${src?.name ? ` from ${src.name}` : ""})`;
      if (have.has(name)) return 1; // already saved by an earlier try
      const audio = await fetch(url);
      if (!audio.ok) throw new Error(`Downloading ${part} failed (${audio.status})`);
      const type = (audio.headers.get("content-type") || "").split(";")[0];
      const ext = /wav/.test(type) || /\.wav(\?|$)/i.test(url) ? "wav" : /flac/.test(type) ? "flac" : /mp4|m4a|aac/.test(type) ? "m4a" : "mp3";
      const bytes = await audio.arrayBuffer();
      if (bytes.byteLength > 50 * 1024 * 1024) throw new Error(`${part} is over 50 MB: set the workflow's stem output to MP3.`);
      const path = `${job.song_id}/${crypto.randomUUID()}.${ext}`;
      const up = await admin.storage.from("charts").upload(path, bytes, { contentType: type || (ext === "wav" ? "audio/wav" : "audio/mpeg"), upsert: true });
        if (up.error) throw new Error(`Saving ${part} failed: ${up.error.message}`);
        let { error } = await admin.from("song_files").insert({ song_id: job.song_id, name, path, is_stem: true });
        if (error && /is_stem/.test(error.message)) ({ error } = await admin.from("song_files").insert({ song_id: job.song_id, name, path }));
        if (error) throw new Error(error.message);
        return 1;
    };
    // Big files (e.g. WAV stems) one at a time to stay within the server's memory.
    const results: number[] = [];
    if (oneAtATime) for (const p of parts) results.push(await one(p));
    else results.push(...(await Promise.all(parts.map(one))));
    await admin.from("stem_jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", job.id);
    return results.length;
  } catch (e) {
    await admin.from("stem_jobs").update({ status: "failed", error: (e as Error).message, updated_at: new Date().toISOString() }).eq("id", job.id);
    throw e;
  }
}
