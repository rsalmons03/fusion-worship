// Music.AI (the Moises engine for apps). Server-only: uses MUSICAI_API_KEY.
// You build a "workflow" in the Music.AI dashboard (stems + chords + beats + sections + lyrics) and
// give its slug as MUSICAI_WORKFLOW. A job runs that workflow on one song; its result lists the outputs
// (audio files for stems, data files for chords etc.), keyed by the output names set in the workflow.

const API = () => (process.env.MUSICAI_API_URL || "https://api.music.ai/api").replace(/\/$/, "");

export const musicAIConfigured = () => !!(process.env.MUSICAI_API_KEY || "").trim();

function key() {
  const k = (process.env.MUSICAI_API_KEY || "").replace(/\s+/g, "");
  if (!k) throw new Error("Music.AI isn't connected: add MUSICAI_API_KEY as a Secret in Cloudflare.");
  return k;
}
function workflow() {
  const w = (process.env.MUSICAI_WORKFLOW || "").trim();
  if (!w) throw new Error("Music.AI needs the workflow name: add MUSICAI_WORKFLOW in Cloudflare (Variables and Secrets) with your workflow's slug from the Music.AI dashboard.");
  return w;
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: { Authorization: key(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`Music.AI ${res.status}: ${(body.message as string) ?? (body.error as string) ?? text.slice(0, 200)}`);
  return body;
}

export type MaiJob = { id: string; status: "processing" | "succeeded" | "failed"; result?: Record<string, unknown>; error?: string };

const norm = (s: unknown): MaiJob["status"] => {
  const v = String(s ?? "").toUpperCase();
  return v === "SUCCEEDED" || v === "SUCCESS" || v === "COMPLETED" ? "succeeded" : v === "FAILED" || v === "ERROR" || v === "CANCELED" ? "failed" : "processing";
};

/** Starts the workflow on a song (given by a link Music.AI can download). */
export async function startMusicAI(inputUrl: string, name: string): Promise<MaiJob> {
  const b = await call("/job", { method: "POST", body: JSON.stringify({ name: name.slice(0, 80), workflow: workflow(), params: { inputUrl } }) });
  const id = String(b.id ?? (b.job as { id?: string })?.id ?? "");
  if (!id) throw new Error("Music.AI didn't return a job id.");
  return { id, status: "processing" };
}

export async function getMusicAI(id: string): Promise<MaiJob> {
  const b = await call(`/job/${encodeURIComponent(id)}`);
  const err = b.error as unknown;
  return {
    id,
    status: norm(b.status),
    result: (b.result as Record<string, unknown>) ?? undefined,
    error: typeof err === "string" ? err : err ? JSON.stringify(err).slice(0, 200) : undefined,
  };
}

/** Every link in the result, with its output name (nested results are flattened: "stems.vocals"). */
export function resultLinks(result: Record<string, unknown> | undefined): [string, string][] {
  const out: [string, string][] = [];
  const walk = (v: unknown, name: string) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) out.push([name, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${name}${i ? i + 1 : ""}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, name ? `${name}.${k}` : k);
  };
  walk(result, "");
  return out;
}

const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus)(\?|$)/i;
/** Which outputs are audio parts. Data outputs (chords, beats, sections, lyrics) are kept for later. */
export const isAudioOutput = (name: string, url: string) => AUDIO.test(url) || /stem|vocal|drum|bass|guitar|piano|keys?|other|instrument|accompan|backing|lead/i.test(name.split(".").pop() ?? "");

const PRETTY: [RegExp, string][] = [
  [/back(ing)?.?vocal|bgv/i, "Backing Vocals"],
  [/lead.?vocal/i, "Lead Vocals"],
  [/vocal|voice/i, "Vocals"],
  [/drum/i, "Drums"],
  [/bass/i, "Bass"],
  [/acoustic/i, "Acoustic Guitar"],
  [/electric|guitar/i, "Guitar"],
  [/piano|keys?|keyboard/i, "Keys"],
  [/string/i, "Strings"],
  [/wind|brass|horn/i, "Horns"],
  [/accompan|instrumental|backing.?track/i, "Instrumental"],
  [/other|rest|remain/i, "Other"],
];
export const maiLabel = (name: string) => PRETTY.find(([re]) => re.test(name))?.[1] ?? name.split(".").pop()!.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
