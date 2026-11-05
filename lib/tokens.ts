import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TokenLookup = {
  assignmentId: string;
  status: string;
  personName: string;
  positionName: string;
  teamName: string;
  serviceDate: string;
  startTime: string | null;
  planTitle: string | null;
};

// Resolves an emailed accept/decline token. Server-only (uses the service role).
export async function lookupToken(token: string): Promise<TokenLookup | null> {
  if (!UUID_RE.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("assignment_tokens")
    .select("assignment_id, assignments(status, profiles(full_name, email), positions(name, teams(name)), plans(service_date, start_time, title))")
    .eq("token", token)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = (data as any)?.assignments;
  if (!a) return null;
  return {
    assignmentId: data!.assignment_id,
    status: a.status,
    personName: a.profiles?.full_name || a.profiles?.email || "",
    positionName: a.positions?.name ?? "",
    teamName: a.positions?.teams?.name ?? "",
    serviceDate: a.plans?.service_date,
    startTime: a.plans?.start_time ?? null,
    planTitle: a.plans?.title ?? null,
  };
}
