import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Admin adds a person (no email is sent). Email is optional: without one they get a
// placeholder login nobody can use, so they can be scheduled before they ever sign in.
const PLACEHOLDER_DOMAIN = "no-email.fusion.invalid";
export async function POST(req: Request) {
  const me = await callerProfile();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { email, name, password, role, location_id } = await req.json().catch(() => ({}));
  const cleanName = String(name ?? "").trim();
  const realEmail = String(email ?? "").trim().toLowerCase();
  const hasEmail = realEmail !== "";
  if (hasEmail && !/^\S+@\S+\.\S+$/.test(realEmail)) return NextResponse.json({ error: "That email doesn't look right" }, { status: 400 });
  if (!hasEmail && !cleanName) return NextResponse.json({ error: "Enter a name (or an email)" }, { status: 400 });
  const cleanEmail = hasEmail ? realEmail : `${crypto.randomUUID()}@${PLACEHOLDER_DOMAIN}`;
  let pw = String(password ?? "");
  if (hasEmail && pw && pw.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  if (!pw) pw = crypto.randomUUID() + crypto.randomUUID(); // nobody knows it; set a real one later with "Set password"
  if (!["admin", "leader", "member"].includes(role)) return NextResponse.json({ error: "Bad role" }, { status: 400 });
  if (location_id && !UUID_RE.test(String(location_id))) return NextResponse.json({ error: "Bad location" }, { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "The server's secret Supabase key isn't set up. In Cloudflare → fusion-worshipppp → Settings → Variables and Secrets, add SUPABASE_SERVICE_ROLE_KEY (type Secret), then Deploy." },
      { status: 500 }
    );
  }
  const { data: existing } = hasEmail ? await admin.from("profiles").select("id").ilike("email", cleanEmail).maybeSingle() : { data: null };
  let id = existing?.id as string | undefined;
  if (id && password) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (!id) {
    const create = (address: string) =>
      admin.auth.admin.createUser({ email: address, password: pw, email_confirm: true, user_metadata: { full_name: cleanName } });
    let { data, error } = await create(cleanEmail);
    // Some Supabase setups refuse made-up domains: fall back to one on the church's own domain (never emailed).
    if (error && !hasEmail) ({ data, error } = await create(`no-email-${crypto.randomUUID().slice(0, 12)}@fusionchurchservices.cc`));
    if (error || !data.user) {
      const msg = error?.message ?? "Could not create user";
      return NextResponse.json(
        { error: /invalid api key|jwt|apikey/i.test(msg) ? "The server's secret Supabase key (SUPABASE_SERVICE_ROLE_KEY) in Cloudflare is wrong or missing. " + msg : msg },
        { status: 500 }
      );
    }
    id = data.user.id;
  }
  const patch: Record<string, string | null> = { role };
  if (cleanName) patch.full_name = cleanName;
  if (!hasEmail) patch.email = null; // show "no email" instead of the placeholder
  if (location_id !== undefined) patch.location_id = location_id || null;
  const { error: upErr } = await admin.from("profiles").update(patch).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, id, hasEmail, setPassword: !!password });
}

// Admin changes someone's sign-in email, or sets (resets) their password.
export async function PATCH(req: Request) {
  const me = await callerProfile();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { id, password, email, full_name, phone } = await req.json().catch(() => ({}));
  if (!UUID_RE.test(String(id ?? ""))) return NextResponse.json({ error: "Bad person" }, { status: 400 });
  const admin = createAdminClient();

  // Name / phone.
  const details: Record<string, string | null> = {};
  if (full_name !== undefined) details.full_name = String(full_name).trim().slice(0, 200);
  if (phone !== undefined) details.phone = String(phone).trim().slice(0, 50) || null;
  if (Object.keys(details).length) {
    const { data, error } = await admin.from("profiles").update(details).eq("id", String(id)).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "Person not found" }, { status: 404 });
    if (email === undefined && password === undefined) return NextResponse.json({ ok: true });
  }

  // Change sign-in email (also kept on the profile).
  if (email !== undefined) {
    const clean = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(String(id), { email: clean, email_confirm: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { error: pe } = await admin.from("profiles").update({ email: clean }).eq("id", String(id));
    if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Set / reset password.
  if (String(password ?? "").length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const { error } = await admin.auth.admin.updateUserById(String(id), { password: String(password) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
