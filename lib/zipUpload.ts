// Multitrack zips (e.g. "Firm Foundation-Db major-150bpm.zip"): unzip on this device, upload each part
// on its own, and shrink any part over the storage limit to a high-quality MP3 first.
import { unzip, unzipSync } from "fflate";
import { MP3_PRE_TRIM, newEncoder } from "@/lib/mp3Align";
import { decodeAudio } from "@/lib/cueVoice";
import { analyze, saveAnalysis } from "@/lib/analysis";
import { fileExt, isAudio } from "@/lib/media";
import { normKey } from "@/lib/audioTags";
import { createClient } from "@/lib/supabase/client";

/** Storage refuses single files over this. */
export const MAX_UPLOAD = 50 * 1024 * 1024;
/** Audio bigger than this is shrunk first (a margin under the limit, which storage counts in its own way). */
export const SHRINK_OVER = 45 * 1000 * 1000;

const MIME: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff",
  flac: "audio/flac", ogg: "audio/ogg", pdf: "application/pdf", txt: "text/plain", png: "image/png", jpg: "image/jpeg",
};

export const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";

/** "Firm Foundation (He Won't)-Db major-150bpm-440hz" → title, key and tempo (read from the end of the name). */
export function parseZipName(name: string): { title: string; key: string | null; bpm: number | null } {
  let t = name.replace(/\.zip$/i, "").trim();
  let key: string | null = null;
  let bpm: number | null = null;
  for (let changed = true; changed; ) {
    changed = false;
    const hz = t.match(/[\s_-]+\d{3}\s*hz$/i);
    if (hz) { t = t.slice(0, hz.index); changed = true; continue; }
    const b = t.match(/[\s_-]+(\d{2,3})\s*bpm$/i);
    if (b) { bpm = Number(b[1]); t = t.slice(0, b.index); changed = true; continue; }
    // a key needs a "-" or "_" before it (so a title like "Plan A" stays whole)
    const k = t.match(/\s*[-_]\s*([A-G][#b♯♭]?)\s*(major|maj|minor|min|m)?$/);
    if (k && k.index! > 0) { key = normKey(k[1] + (/^m(in(or)?)?$/i.test(k[2] ?? "") ? "m" : "")); t = t.slice(0, k.index); changed = true; }
  }
  return { title: t.replace(/_/g, " ").replace(/\s+/g, " ").trim() || name, key, bpm };
}

const junk = (n: string) => n.endsWith("/") || /(^|\/)__MACOSX\//.test(n) || /(^|\/)\.[^/]*$/.test(n) || /(^|\/)(thumbs\.db|desktop\.ini)$/i.test(n);

/** The files inside a zip, unpacked one at a time (so a big multitrack doesn't fill memory). */
export async function unzipFiles(zip: File): Promise<{ name: string; size: number; open: () => Promise<File> }[]> {
  const buf = new Uint8Array(await zip.arrayBuffer());
  const list: { name: string; size: number }[] = [];
  unzipSync(buf, { filter: (e) => { if (!junk(e.name)) list.push({ name: e.name, size: e.originalSize }); return false; } });
  return list.map((e) => ({
    name: e.name.split("/").pop()!,
    size: e.size,
    open: () =>
      new Promise<File>((res, rej) =>
        unzip(buf, { filter: (x) => x.name === e.name }, (err, out) => {
          if (err) return rej(err);
          const data = out[e.name];
          const short = e.name.split("/").pop()!;
          res(new File([data as BlobPart], short, { type: MIME[fileExt(short)] ?? "" }));
        })
      ),
  }));
}

/** Files made by toMp3 (stored as "<id>.fw.mp3" so players can line them up exactly). */
const made = new WeakSet<File>();
/** The storage extension for a file: "fw.mp3" for our MP3s. */
export const storageExt = (f: File) => (made.has(f) ? "fw.mp3" : fileExt(f.name).replace(/[^a-z0-9]/g, "") || "bin");

/** Re-encodes decoded audio as a 256 kbps MP3 (a 5-minute stereo part ≈ 10 MB). */
export async function toMp3(audio: AudioBuffer, name: string, onProgress?: (p: number) => void): Promise<File> {
  const ch = Math.min(2, audio.numberOfChannels);
  const enc = newEncoder(ch, audio.sampleRate);
  // the encoder puts ~25 ms in front; drop that much from the start so the part stays in time
  const L = audio.getChannelData(0).subarray(MP3_PRE_TRIM);
  const R = ch > 1 ? audio.getChannelData(1).subarray(MP3_PRE_TRIM) : undefined;
  const block = 1152 * 32;
  const out: BlobPart[] = [];
  const i16 = (src: Float32Array, at: number, n: number) => {
    const a = new Int16Array(n);
    for (let k = 0; k < n; k++) {
      const v = Math.max(-1, Math.min(1, src[at + k]));
      a[k] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return a;
  };
  for (let i = 0, step = 0; i < L.length; i += block, step++) {
    const n = Math.min(block, L.length - i);
    const mp3 = enc.encodeBuffer(i16(L, i, n), R ? i16(R, i, n) : undefined);
    if (mp3.length) out.push(mp3.slice());
    if (step % 30 === 0) {
      onProgress?.(i / L.length);
      await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
  }
  out.push(enc.flush().slice());
  const f = new File(out, name.replace(/\.[^.]+$/, "") + ".mp3", { type: "audio/mpeg" });
  made.add(f);
  return f;
}

/**
 * Uploads every file in a multitrack zip to a song. Audio parts are marked as stems (so Fusion Tracks
 * opens them right away); parts over the limit are shrunk to MP3 on this device first.
 * Also fills in the song's key and tempo from the zip's name when the song has none.
 */
export async function uploadZipToSong(
  songId: string,
  zip: File,
  status: (msg: string) => void
): Promise<{ added: number; shrunk: number; errors: string[] }> {
  const supabase = createClient();
  const errors: string[] = [];
  let added = 0, shrunk = 0;
  status("Opening the zip…");
  let entries: Awaited<ReturnType<typeof unzipFiles>>;
  try {
    entries = await unzipFiles(zip);
  } catch (e) {
    return { added, shrunk, errors: [`${zip.name}: couldn't open the zip (${(e as Error).message})`] };
  }
  const audioCount = entries.filter((e) => isAudio(e.name)).length;
  const { key, bpm } = parseZipName(zip.name);
  if (key) await supabase.from("songs").update({ default_key: key }).eq("id", songId).is("default_key", null);
  if (bpm) await supabase.from("songs").update({ bpm }).eq("id", songId).is("bpm", null);

  for (const [i, e] of entries.entries()) {
    const label = `Part ${i + 1} of ${entries.length}: ${e.name}`;
    try {
      status(`${label} (unpacking)`);
      let f = await e.open();
      const audio = isAudio(e.name);
      let decoded: AudioBuffer | null = null;
      if (f.size > (audio ? SHRINK_OVER : MAX_UPLOAD)) {
        if (!audio) {
          errors.push(`${e.name}: over 50 MB (skipped)`);
          continue;
        }
        status(`${label} (making it smaller)`);
        decoded = await decodeAudio(await f.arrayBuffer());
        f = await toMp3(decoded, f.name, (p) => status(`${label} (making it smaller ${Math.round(p * 100)}%)`));
        shrunk++;
      }
      status(`${label} (uploading)`);
      const ext = storageExt(f);
      const path = `${songId}/${crypto.randomUUID()}.${ext}`;
      let up = await supabase.storage.from("charts").upload(path, f, { contentType: f.type || undefined });
      if (up.error && !/exceed|too large|size/i.test(up.error.message)) up = await supabase.storage.from("charts").upload(path, f, { contentType: f.type || undefined }); // one retry
      if (up.error) {
        errors.push(`${e.name}: ${up.error.message}`);
        continue;
      }
      const name = ext === "pro" ? f.name : f.name.replace(/\.[^.]+$/, "");
      const stem = audio && audioCount > 1;
      let { data: row, error } = await supabase.from("song_files").insert({ song_id: songId, name, path, ...(stem ? { is_stem: true } : {}) }).select("id").single();
      if (error && stem) ({ data: row, error } = await supabase.from("song_files").insert({ song_id: songId, name, path }).select("id").single());
      if (error) {
        errors.push(`${e.name}: ${error.message}`);
        continue;
      }
      added++;
      if (audio && row?.id) {
        try {
          status(`${label} (analysing)`);
          await saveAnalysis(row.id, analyze(decoded ?? (await decodeAudio(await f.arrayBuffer()))));
        } catch {}
      }
    } catch (err) {
      errors.push(`${e.name}: ${(err as Error).message}`);
    }
  }
  return { added, shrunk, errors };
}
