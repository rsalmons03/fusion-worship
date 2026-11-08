import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { findPlan, planUrl, pushItems, serviceTypes, type SyncItem } from "@/lib/pco";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const CONFIG = "pco/locations.json"; // Fusion location → Planning Center service type

async function leaderOnly() {
  const me = await callerProfile();
  return me && (me.role === "admin" || me.role === "leader") ? me : null;
}

async function readConfig(): Promise<Record<string, string>> {
  const { data } = await createAdminClient().storage.from("charts").download(CONFIG);
  if (!data) return {};
  try {
    return JSON.parse(await data.text());
  } catch {
    return {};
  }
}

// Planning Center service types (to choose which one a location sends to), plus the saved choices.
export async function GET() {
  if (!(await leaderOnly())) return NextResponse.json({ error: "Only leaders can use Planning Center sync" }, { status: 403 });
  try {
    const [types, config] = await Promise.all([serviceTypes(), readConfig()]);
    return NextResponse.json({ types, config });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Send one Fusion service's order to the Planning Center plan on the same date.
export async function POST(req: Request) {
  if (!(await leaderOnly())) return NextResponse.json({ error: "Only leaders can use Planning Center sync" }, { status: 403 });
  const { planId, serviceTypeId } = await req.json().catch(() => ({}));
  if (!UUID_RE.test(String(planId ?? "")) || !/^\d+$/.test(String(serviceTypeId ?? ""))) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const admin = createAdminClient();
  try {
    const { data: plan } = await admin.from("plans").select("id, service_date, location_id, title").eq("id", planId).maybeSingle();
    if (!plan) return NextResponse.json({ error: "Service not found" }, { status: 404 });
    const { data: rows } = await admin
      .from("plan_items")
      .select("kind, title, description, song_key, duration_sec, duration_min, songs(title, author, ccli, default_key, bpm)")
      .eq("plan_id", planId)
      .order("position");
    type Row = { kind: string; title: string; description: string | null; song_key: string | null; duration_sec?: number | null; duration_min: number | null; songs: { title: string; author: string | null; ccli: string | null; default_key: string | null; bpm: number | null } | null };
    const items: SyncItem[] = ((rows ?? []) as unknown as Row[]).map((r) => ({
      kind: r.kind === "song" && !r.songs ? "item" : r.kind,
      title: r.songs?.title ?? r.title,
      seconds: r.duration_sec ?? (r.duration_min ? r.duration_min * 60 : null),
      description: r.description,
      song: r.songs ? { title: r.songs.title, author: r.songs.author, ccli: r.songs.ccli, key: r.song_key || r.songs.default_key, bpm: r.songs.bpm } : null,
    }));

    const target = await findPlan(String(serviceTypeId), plan.service_date);
    if (!target)
      return NextResponse.json(
        { error: `There's no Planning Center plan on ${plan.service_date} in that service type. Create the plan for that date in Planning Center (or let its schedule create it), then send again.` },
        { status: 404 }
      );
    const count = await pushItems(String(serviceTypeId), target.id, items);

    // Remember this location's service type for next time.
    if (plan.location_id) {
      const config = await readConfig();
      if (config[plan.location_id] !== String(serviceTypeId)) {
        config[plan.location_id] = String(serviceTypeId);
        await admin.storage.from("charts").upload(CONFIG, new Blob([JSON.stringify(config)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      }
    }
    return NextResponse.json({ count, url: planUrl(target.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
