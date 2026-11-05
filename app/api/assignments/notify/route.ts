import { NextResponse } from "next/server";
import { callerProfile } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendEmail, siteUrl } from "@/lib/email";
import { CHURCH_NAME, fmtDate, fmtTime } from "@/lib/format";

// Emails a "Can you serve?" request to everyone on a plan whose status is still 'unsent'.
export async function POST(req: Request) {
  const me = await callerProfile();
  if (!me || (me.role !== "admin" && me.role !== "leader")) {
    return NextResponse.json({ error: "Only leaders can send requests" }, { status: 403 });
  }
  const { planId } = await req.json().catch(() => ({}));
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: plan } = await admin.from("plans").select("*").eq("id", planId).maybeSingle();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const { data: rows, error } = await admin
    .from("assignments")
    .select("id, profiles(full_name, email), positions(name, teams(name)), assignment_tokens(token)")
    .eq("plan_id", planId)
    .eq("status", "unsent");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const base = siteUrl(req);
  const when = `${fmtDate(plan.service_date, { weekday: "long", month: "long" })}${plan.start_time ? ` at ${fmtTime(plan.start_time)}` : ""}`;
  let sent = 0;
  const errors: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (rows ?? []) as any[]) {
    const email: string | undefined = r.profiles?.email;
    const tok = Array.isArray(r.assignment_tokens) ? r.assignment_tokens[0]?.token : r.assignment_tokens?.token;
    if (!email || !tok) {
      errors.push(`${r.profiles?.full_name ?? "someone"}: no email`);
      continue;
    }
    const first = (r.profiles?.full_name || "").split(" ")[0] || "there";
    const role = `${r.positions?.name ?? ""}${r.positions?.teams?.name ? ` (${r.positions.teams.name})` : ""}`;
    const link = `${base}/respond/${tok}`;
    try {
      await sendEmail({
        to: email,
        subject: `Can you serve ${fmtDate(plan.service_date, { year: undefined })}? — ${role}`,
        text: `Hi ${first},\n\nCan you serve as ${role} on ${when}${plan.title ? ` (${plan.title})` : ""}?\n\nAccept or decline here: ${link}\n\n${CHURCH_NAME}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1c1917">
          <p>Hi ${escapeHtml(first)},</p>
          <p>Can you serve as <b>${escapeHtml(role)}</b> on <b>${escapeHtml(when)}</b>${plan.title ? ` (${escapeHtml(plan.title)})` : ""}?</p>
          ${plan.notes ? `<p style="color:#78716c;white-space:pre-wrap">${escapeHtml(plan.notes)}</p>` : ""}
          <p><a href="${link}" style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept or decline</a></p>
          <p style="color:#78716c;font-size:13px">${escapeHtml(CHURCH_NAME)}</p></div>`,
      });
      await admin.from("assignments").update({ status: "pending", notified_at: new Date().toISOString() }).eq("id", r.id);
      sent++;
    } catch (e) {
      errors.push(`${email}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json({ sent, failed: errors.length, errors });
}
