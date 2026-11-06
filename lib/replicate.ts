// Stem splitting through Replicate (Demucs). Server-only: uses REPLICATE_API_TOKEN.
const API = "https://api.replicate.com/v1";
// The Demucs model on Replicate; can be changed without code via REPLICATE_STEMS_MODEL ("owner/name").
const MODEL = () => process.env.REPLICATE_STEMS_MODEL || "ryan5453/demucs";

function token() {
  // Runtime secret (Worker → Settings → Variables and Secrets). A Build variable with the same name
  // is also accepted: it's copied in when the app is built (see next.config.mjs). Spaces are ignored.
  const t = (process.env.REPLICATE_API_TOKEN || process.env.FW_REPLICATE_TOKEN_BUILD || "").replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!t) {
    const near = Object.keys(process.env).filter((k) => /replic|r8_|token/i.test(k) && k !== "FW_REPLICATE_TOKEN_BUILD");
    throw new Error(
      "The AI isn't connected yet: the app can't see REPLICATE_API_TOKEN." +
        (near.length ? ` It did find: ${near.join(", ")} (the name must be exactly REPLICATE_API_TOKEN).` : "") +
        " In Cloudflare: Workers & Pages → fusion-worshipppp → Settings → Variables and Secrets (not the Build section) → Add → type Secret → name REPLICATE_API_TOKEN → Deploy."
    );
  }
  return t;
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${body.detail ?? body.title ?? JSON.stringify(body).slice(0, 200)}`);
  return body;
}

export type Prediction = { id: string; status: "starting" | "processing" | "succeeded" | "failed" | "canceled"; output?: unknown; error?: string | null };

/** Starts splitting an audio file (given by a URL Replicate can download). */
export async function startSplit(audioUrl: string): Promise<Prediction> {
  const model = await call(`/models/${MODEL()}`);
  const version = model?.latest_version?.id;
  if (!version) throw new Error(`Couldn't find the stem model ${MODEL()} on Replicate.`);
  return call(`/predictions`, {
    method: "POST",
    body: JSON.stringify({
      version,
      // Six parts (vocals, drums, bass, guitar, piano, other) as MP3s to keep storage small.
      input: { audio: audioUrl, model: "htdemucs_6s", output_format: "mp3", stem: "none" },
    }),
  });
}

export async function getPrediction(id: string): Promise<Prediction> {
  return call(`/predictions/${encodeURIComponent(id)}`);
}

/** The finished parts as [name, url] pairs, whatever shape the model returns them in. */
export function stemUrls(output: unknown): [string, string][] {
  const out: [string, string][] = [];
  const nameFromUrl = (u: string) => decodeURIComponent(u.split("/").pop() ?? "stem").replace(/\.[a-z0-9]+$/i, "");
  if (Array.isArray(output)) for (const u of output) typeof u === "string" && out.push([nameFromUrl(u), u]);
  else if (output && typeof output === "object")
    for (const [k, v] of Object.entries(output as Record<string, unknown>)) if (typeof v === "string" && /^https?:/.test(v)) out.push([k, v]);
  return out;
}

const PRETTY: Record<string, string> = { vocals: "Vocals", drums: "Drums", bass: "Bass", guitar: "Guitar", piano: "Keys", other: "Other" };
export const stemLabel = (k: string) => PRETTY[k.toLowerCase()] ?? k.charAt(0).toUpperCase() + k.slice(1);

// ── Auto-sync: speech-to-text with timings (Whisper) to find where each section starts ──
const WHISPER = () => process.env.REPLICATE_WHISPER_MODEL || "openai/whisper";

export async function startTranscribe(audioUrl: string): Promise<Prediction> {
  const model = await call(`/models/${WHISPER()}`);
  const version = model?.latest_version?.id;
  if (!version) throw new Error(`Couldn't find the speech model ${WHISPER()} on Replicate.`);
  return call(`/predictions`, {
    method: "POST",
    body: JSON.stringify({ version, input: { audio: audioUrl, model: "large-v3", language: "en", transcription: "plain text", condition_on_previous_text: false } }),
  });
}

export type Segment = { start: number; end: number; text: string };
/** Timed lines from a finished transcription, whatever shape the model returns. */
export function segmentsOf(output: unknown): Segment[] {
  const o = output as { segments?: { start: number; end: number; text: string }[]; chunks?: { timestamp: [number, number]; text: string }[] } | null;
  if (o?.segments) return o.segments.map((s) => ({ start: +s.start, end: +s.end, text: String(s.text ?? "") }));
  if (o?.chunks) return o.chunks.map((c) => ({ start: +c.timestamp[0], end: +(c.timestamp[1] ?? c.timestamp[0]), text: String(c.text ?? "") }));
  return [];
}
