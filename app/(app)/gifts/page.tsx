"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { displayName } from "@/components/Avatar";
import StrengthsForm from "@/components/StrengthsForm";
import { complete, KINDS, type Kind } from "@/lib/assessments";

type Data = Record<string, unknown>;

function GiftsInner() {
  const me = useProfile();
  const params = useSearchParams();
  const other = params.get("person");
  const personId = other && me.isLeader ? other : me.id;
  const [name, setName] = useState("");
  const [res, setRes] = useState<Partial<Record<Kind, Data>> | null>(null);
  const [done, setDone] = useState(0);

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: rows }, { data: p }] = await Promise.all([
      sb.from("assessments").select("kind,data").eq("profile_id", personId),
      sb.from("profiles").select("*").eq("id", personId).maybeSingle(),
    ]);
    const out: Partial<Record<Kind, Data>> = {};
    for (const r of rows ?? []) out[r.kind as Kind] = r.data as Data;
    setRes(out);
    setDone(KINDS.filter((k) => complete(k.kind, out[k.kind])).length);
    setName(p ? displayName(p) : "");
  }, [personId]);
  useEffect(() => {
    load();
  }, [load]);

  const mine = personId === me.id;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end gap-3 border-b border-line pb-4">
        <div className="flex-1">
          {me.isLeader && <Link href="/strengths" className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">Strengths &amp; gifts</Link>}
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{mine ? "My strengths & gifts" : `${name}: strengths & gifts`}</h1>
          <p className="text-sm text-muted">
            {mine
              ? "Take any of these tests, then tap your results here. Your leaders use them to help you serve where you shine."
              : `Enter ${name || "their"} results from their test reports.`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold">{done}<span className="text-base font-semibold text-muted">/{KINDS.length}</span></div>
          <div className="text-xs text-muted">filled in</div>
        </div>
      </header>
      {res && <StrengthsForm profileId={personId} initial={res} onSaved={load} />}
    </div>
  );
}

export default function GiftsPage() {
  return (
    <Suspense>
      <GiftsInner />
    </Suspense>
  );
}
