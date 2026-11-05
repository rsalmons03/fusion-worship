// Stem splitting through Replicate (Demucs). Server-only: uses REPLICATE_API_TOKEN.
const API = "https://api.replicate.com/v1";
// The Demucs model on Replicate; can be changed without code via REPLICATE_STEMS_MODEL ("owner/name").
const MODEL = () => process.env.REPLICATE_STEMS_MODEL || "ryan5453/demucs";

function token() {
  const t = (process.env.REPLICATE_API_TOKEN ?? "").trim();
  if (!t) throw new Error("Stem splitting isn't set up: add REPLICATE_API_TOKEN as a Secret in Cloudflare (fusion-worshipppp → Settings → Variables and Secrets), then Deploy.");
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
