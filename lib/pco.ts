// Planning Center Services (server-only). Uses a Personal Access Token: PCO_APP_ID + PCO_SECRET.
// Fusion is where services are planned; this copies a service's order into the matching Planning Center
// plan so MultiTracks Playback and Worship Online (which read Planning Center) get the setlist.

const API = "https://api.planningcenteronline.com/services/v2";

export const pcoConfigured = () => !!(process.env.PCO_APP_ID && process.env.PCO_SECRET);

function auth() {
  const id = (process.env.PCO_APP_ID || "").trim();
  const secret = (process.env.PCO_SECRET || "").trim();
  if (!id || !secret)
    throw new Error(
      "Planning Center isn't connected: add PCO_APP_ID and PCO_SECRET as Secrets in Cloudflare (from api.planningcenteronline.com → Personal Access Tokens)."
    );
  return "Basic " + btoa(`${id}:${secret}`);
}

type Res<T = Record<string, unknown>> = { id: string; type: string; attributes: T };

export async function pco<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return {} as T;
  const text = await res.text();
  let body: { errors?: { title?: string; detail?: string }[] } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const e = body.errors?.[0];
    throw new Error(`Planning Center ${res.status}: ${e?.detail || e?.title || text.slice(0, 160)}`);
  }
  return body as T;
}

export async function serviceTypes() {
  const r = await pco<{ data: Res<{ name: string }>[] }>("/service_types?per_page=100");
  return r.data.map((s) => ({ id: s.id, name: s.attributes.name }));
}

/** The plan in this service type on the given date (YYYY-MM-DD), if there is one. */
export async function findPlan(serviceTypeId: string, date: string) {
  const d = new Date(date + "T12:00:00Z");
  const after = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
  const r = await pco<{ data: Res<{ sort_date: string; dates: string; title: string | null }>[] }>(
    `/service_types/${serviceTypeId}/plans?filter=after&after=${after}&order=sort_date&per_page=10`
  );
  return r.data.find((p) => (p.attributes.sort_date || "").slice(0, 10) === date) ?? null;
}

async function findOrCreateSong(title: string, author?: string | null, ccli?: string | null) {
  const q = ccli ? `where[ccli_number]=${encodeURIComponent(ccli)}` : `where[title]=${encodeURIComponent(title)}`;
  let r = await pco<{ data: Res<{ title: string }>[] }>(`/songs?${q}&per_page=5`);
  if (!r.data.length && ccli) r = await pco(`/songs?where[title]=${encodeURIComponent(title)}&per_page=5`);
  const hit = r.data.find((s) => s.attributes.title.toLowerCase() === title.toLowerCase()) ?? r.data[0];
  if (hit) return hit.id;
  const made = await pco<{ data: Res }>("/songs", {
    method: "POST",
    body: JSON.stringify({ data: { type: "Song", attributes: { title, ...(author ? { author } : {}), ...(ccli ? { ccli_number: Number(ccli) || undefined } : {}) } } }),
  });
  return made.data.id;
}

async function arrangementAndKey(songId: string, key?: string | null, bpm?: number | null) {
  let arr = (await pco<{ data: Res<{ name: string }>[] }>(`/songs/${songId}/arrangements?per_page=10`)).data[0];
  if (!arr)
    arr = (
      await pco<{ data: Res<{ name: string }> }>(`/songs/${songId}/arrangements`, {
        method: "POST",
        body: JSON.stringify({ data: { type: "Arrangement", attributes: { name: "Default", ...(bpm ? { bpm } : {}) } } }),
      })
    ).data;
  let keyId: string | undefined;
  if (key) {
    const keys = (await pco<{ data: Res<{ starting_key: string; name: string }>[] }>(`/songs/${songId}/arrangements/${arr.id}/keys?per_page=25`)).data;
    keyId = keys.find((k) => k.attributes.starting_key === key)?.id;
    if (!keyId) {
      try {
        keyId = (
          await pco<{ data: Res }>(`/songs/${songId}/arrangements/${arr.id}/keys`, {
            method: "POST",
            body: JSON.stringify({ data: { type: "Key", attributes: { name: key, starting_key: key } } }),
          })
        ).data.id;
      } catch {
        keyId = undefined; // keys are optional; the item still gets the song
      }
    }
  }
  return { arrangementId: arr.id, keyId };
}

export type SyncItem = {
  kind: string;
  title: string;
  seconds?: number | null;
  description?: string | null;
  song?: { title: string; author?: string | null; ccli?: string | null; key?: string | null; bpm?: number | null } | null;
};

/** Replaces the plan's items with Fusion's order. Returns how many were sent. */
export async function pushItems(serviceTypeId: string, planId: string, items: SyncItem[]) {
  const base = `/service_types/${serviceTypeId}/plans/${planId}/items`;
  const existing = await pco<{ data: Res[] }>(`${base}?per_page=100`);
  for (const it of existing.data) await pco(`${base}/${it.id}`, { method: "DELETE" });
  let seq = 1;
  for (const it of items) {
    const attrs: Record<string, unknown> = {
      title: it.title || (it.kind === "header" ? "Section" : "Item"),
      sequence: seq++,
      item_type: it.kind === "header" ? "header" : it.kind === "song" ? "song" : "item",
      ...(it.seconds ? { length: Math.round(it.seconds) } : {}),
      ...(it.description ? { description: it.description.slice(0, 1000) } : {}),
    };
    if (it.kind === "song" && it.song) {
      const songId = await findOrCreateSong(it.song.title, it.song.author, it.song.ccli);
      const { arrangementId, keyId } = await arrangementAndKey(songId, it.song.key, it.song.bpm);
      Object.assign(attrs, { song_id: songId, arrangement_id: arrangementId, ...(keyId ? { key_id: keyId } : {}) });
    }
    await pco(base, { method: "POST", body: JSON.stringify({ data: { type: "Item", attributes: attrs } }) });
  }
  return items.length;
}

export const planUrl = (planId: string) => `https://services.planningcenteronline.com/plans/${planId}`;
