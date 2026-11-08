"use client";
import { useState } from "react";

/** "Send to Planning Center": copies this service's order into the Planning Center plan on the same date. */
export default function PcoSync({ planId, locationId, date }: { planId: string; locationId: string | null; date: string }) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<{ id: string; name: string }[] | null>(null);
  const [type, setType] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  async function start() {
    setOpen(true);
    setMsg(null);
    if (types) return;
    setBusy("Connecting to Planning Center…");
    try {
      const r = await fetch("/api/pco").then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setTypes(r.types);
      setType((locationId && r.config?.[locationId]) || r.types[0]?.id || "");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function send() {
    if (!type) return;
    if (!confirm(`Send this service's order to Planning Center?\n\nIt replaces the items in the Planning Center plan on ${date} (songs with keys, headers, items and times).`)) return;
    setBusy("Sending…");
    setMsg(null);
    try {
      const r = await fetch("/api/pco", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, serviceTypeId: type }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setMsg({ ok: true, text: `✓ Sent ${r.count} items to Planning Center.`, url: r.url });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  if (!open)
    return (
      <button className="btn-secondary" onClick={start} title="Copy this service's order into Planning Center (for MultiTracks Playback and Worship Online)">
        ⇄ Planning Center
      </button>
    );
  return (
    <div className="w-full rounded-lg border border-line bg-white p-3 text-sm shadow-sm">
      <div className="mb-2 flex items-center">
        <b className="flex-1">Send to Planning Center</b>
        <button className="text-muted" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      {types && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Planning Center service type">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn" onClick={send} disabled={!!busy || !type}>{busy || "Send this service"}</button>
        </div>
      )}
      {!types && busy && <p className="text-muted">{busy}</p>}
      {msg && (
        <p className={`mt-2 ${msg.ok ? "text-ok" : "text-bad"}`}>
          {msg.text}{" "}
          {msg.url && <a href={msg.url} target="_blank" rel="noopener" className="font-semibold underline">Open in Planning Center ↗</a>}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Then MultiTracks Playback and Worship Online pick up the setlist from Planning Center as usual.</p>
    </div>
  );
}
