import { lookupToken } from "@/lib/tokens";
import { CHURCH_NAME, fmtDate, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Public page linked from the "Can you serve?" email. The token is the credential.
export default async function RespondPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { done?: string };
}) {
  const info = await lookupToken(params.token);
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-md p-6">
        <p className="mb-4 text-sm text-muted">{CHURCH_NAME}</p>
        {!info ? (
          <p>This link is no longer valid. You may have been removed from this service — ask your worship leader.</p>
        ) : (
          <>
            <h1 className="h2">Hi {info.personName.split(" ")[0]},</h1>
            <p className="mt-2">
              Can you serve as <b>{info.positionName}</b> ({info.teamName}) on{" "}
              <b>{fmtDate(info.serviceDate, { weekday: "long", month: "long" })}</b>
              {info.startTime && ` at ${fmtTime(info.startTime)}`}
              {info.planTitle && ` — ${info.planTitle}`}?
            </p>
            {searchParams.done && (
              <p className={`mt-4 rounded-md px-3 py-2 text-sm ${info.status === "accepted" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                {info.status === "accepted" ? "Thanks! You're confirmed." : "Got it — you've declined. Thanks for letting us know."}
              </p>
            )}
            {!searchParams.done && info.status !== "pending" && info.status !== "unsent" && (
              <p className="mt-4 text-sm text-muted">You&apos;ve already {info.status} this. You can change your answer below.</p>
            )}
            <form action="/api/respond" method="post" className="mt-5 flex gap-2">
              <input type="hidden" name="token" value={params.token} />
              <button name="status" value="accepted" className="btn flex-1">Accept</button>
              <button name="status" value="declined" className="btn-secondary flex-1">Decline</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
