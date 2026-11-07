"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { GUIDE_PHRASES, TEAM_FOLDER, decodeAudio, refreshTeamVoice, sayCue, teamVoiceUrls, unlockCues } from "@/lib/cueVoice";

// Record your own guide voice: one person says each call once ("One", "Verse 1", "Chorus"…),
// and the player uses it for every song's count-in and section calls.

/** Trim silence, even out the level, and save as a WAV every phone can play. */
async function cleanRecording(blob: Blob): Promise<Blob> {
  const buf = await decodeAudio(await blob.arrayBuffer());
  const sr = buf.sampleRate;
  const src = buf.getChannelData(0);
  let peak = 0;
  for (const v of src) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.01) throw new Error("That was silent: check the microphone and try again.");
  const thr = peak * 0.06;
  let a = 0, b = src.length - 1;
  while (a < b && Math.abs(src[a]) < thr) a++;
  while (b > a && Math.abs(src[b]) < thr) b--;
  a = Math.max(0, a - Math.floor(sr * 0.015));
  b = Math.min(src.length - 1, b + Math.floor(sr * 0.06));
  const n = b - a + 1;
  const gain = 0.9 / peak;
  const fade = Math.floor(sr * 0.008);
  const pcm = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, t: string) => [...t].forEach((c, i) => pcm.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  pcm.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true);
  pcm.setUint16(22, 1, true);
  pcm.setUint32(24, sr, true);
  pcm.setUint32(28, sr * 2, true);
  pcm.setUint16(32, 2, true);
  pcm.setUint16(34, 16, true);
  w(36, "data");
  pcm.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    const v = Math.max(-1, Math.min(1, src[a + i] * gain * env));
    pcm.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return new Blob([pcm.buffer], { type: "audio/wav" });
}

export default function GuideVoicePage() {
  const me = useProfile();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const autoStop = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    refreshTeamVoice();
    const m = await teamVoiceUrls();
    setDone(new Set(m.keys()));
  }, []);
  useEffect(() => {
    load();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [load]);

  const cur = GUIDE_PHRASES[idx];

  async function start() {
    if (rec) return stop();
    try {
      if (!stream.current) stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return alert("The app needs the microphone. Allow it when your phone asks (or in Settings › Safari › Microphone).");
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => save(new Blob(chunks, { type: r.mimeType || "audio/mp4" }));
    r.start();
    setRec(r);
    autoStop.current = window.setTimeout(() => r.state === "recording" && r.stop(), 3000);
  }
  function stop() {
    clearTimeout(autoStop.current);
    if (rec?.state === "recording") rec.stop();
  }
  async function save(blob: Blob) {
    setRec(null);
    setBusy("Saving…");
    try {
      const wav = await cleanRecording(blob);
      const { error } = await createClient().storage.from("charts").upload(`${TEAM_FOLDER}/${cur.slug}.wav`, wav, { upsert: true, contentType: "audio/wav" });
      if (error) throw new Error(error.message + (/row-level|policy/i.test(error.message) ? " (only leaders can record the guide voice)" : ""));
      await load();
      unlockCues();
      await sayCue("team", cur.say);
      if (idx < GUIDE_PHRASES.length - 1) setIdx(idx + 1);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove(slug: string) {
    if (!confirm("Delete this recording? The built-in voice will be used for it.")) return;
    await createClient().storage.from("charts").remove([`${TEAM_FOLDER}/${slug}.wav`]);
    load();
  }

  if (!me.isLeader) return <p className="text-muted">Only leaders can record the guide voice.</p>;
  const groups = [...new Set(GUIDE_PHRASES.map((p) => p.group))];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="h1">Guide voice</h1>
        <p className="text-sm text-muted">
          Record your team&apos;s own guide voice. Say each call once, clearly and with energy, the way you&apos;d call it to the band. The player uses it for every song&apos;s count-in and section calls
          (choose <b>Our team&apos;s voice</b> in the player). Anything not recorded uses the built-in voice. Best in a quiet room, phone about a hand&apos;s width from your mouth.
        </p>
        <p className="mt-1 text-sm font-semibold">{done.size} of {GUIDE_PHRASES.length} recorded</p>
      </div>

      <div className="card flex flex-col items-center gap-4 py-8 text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">{cur.group} · {idx + 1} of {GUIDE_PHRASES.length}</div>
        <div className="font-display text-5xl font-extrabold">{cur.say}</div>
        <button
          onClick={start}
          disabled={!!busy}
          className={`grid h-24 w-24 place-items-center rounded-full text-white shadow-lg transition ${rec ? "animate-pulse bg-red-600" : "bg-accent"} disabled:opacity-60`}
          aria-label={rec ? "Stop" : "Record"}
        >
          <span className="text-3xl">{rec ? "■" : "🎙"}</span>
        </button>
        <div className="h-5 text-sm text-muted">{busy || (rec ? "Recording… say it now (tap to stop)" : done.has(cur.slug) ? "✓ Recorded: tap 🎙 to redo" : "Tap 🎙, then say it")}</div>
        <div className="flex gap-3 text-sm">
          <button className="btn-ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Back</button>
          {done.has(cur.slug) && <button className="btn-ghost" onClick={() => { unlockCues(); sayCue("team", cur.say); }}>▶ Play</button>}
          <button className="btn-ghost" disabled={idx >= GUIDE_PHRASES.length - 1} onClick={() => setIdx(idx + 1)}>Skip →</button>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{g}</h2>
          <div className="flex flex-wrap gap-1.5">
            {GUIDE_PHRASES.map((p, i) =>
              p.group !== g ? null : (
                <span key={p.slug} className={`inline-flex items-center rounded-full border text-sm ${i === idx ? "border-accent" : "border-line"} ${done.has(p.slug) ? "bg-green-50" : "bg-white"}`}>
                  <button className="px-3 py-1" onClick={() => setIdx(i)}>{done.has(p.slug) ? "✓ " : ""}{p.say}</button>
                  {done.has(p.slug) && <button className="pr-2 text-xs text-muted hover:text-bad" onClick={() => remove(p.slug)} aria-label={`Delete ${p.say}`}>✕</button>}
                </span>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
