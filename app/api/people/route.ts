import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendEmail, siteUrl } from "@/lib/email";
import { CHURCH_NAME } from "@/lib/format";

// Admin adds a person: creates their login (no password — they sign in with an email link)
// and sets their name/role. Optionally emails them a welcome note.
export async function POST(req: Request) {
  const me = await callerProfile();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { email, name, role, location_id } = await req.json().catch(() => ({}));
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!["admin", "leader", "member"].includes(role)) return NextResponse.json({ error: "Bad role" }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").ilike("email", cleanEmail).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: cleanEmail,
      email_confirm: true,
      user_metadata: { full_name: String(name ?? "").trim() },
    });
    if (error || !data.user) return NextResponse.json({ error: error?.message ?? "Could not create user" }, { status: 500 });
    id = data.user.id;
  }
  const patch: Record<string, string | null> = { role };
  if (location_id !== undefined) {
    if (location_id && !/^[0-9a-f-]{36}$/i.test(String(location_id))) return NextResponse.json({ error: "Bad location" }, { status: 400 });
    patch.location_id = location_id || null;
  }
  if (String(name ?? "").trim()) patch.full_name = String(name).trim();
  const { error: upErr } = await admin.from("profiles").update(patch).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: true, emailed: false, note: "Email isn't set up, so tell them to sign in at the site with this email." });
  }
  const link = `${siteUrl(req)}/login`;
  try {
    await sendEmail({
      to: cleanEmail,
      subject: `You've been added to ${CHURCH_NAME} worship planning`,
      text: `You've been added to ${CHURCH_NAME}'s worship planning site. Sign in with this email address at ${link} — we'll email you a one-time link, no password needed.`,
      html: `<p>You've been added to <b>${escapeHtml(CHURCH_NAME)}</b>'s worship planning site.</p><p><a href="${link}">Sign in here</a> with this email address — we'll email you a one-time link, no password needed.</p>`,
    });
    return NextResponse.json({ ok: true, emailed: true });
  } catch (e) {
    return NextResponse.json({ ok: true, emailed: false, note: `Welcome email failed: ${(e as Error).message}` });
  }
}
