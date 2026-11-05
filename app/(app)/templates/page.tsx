"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocations, useProfile } from "@/components/ProfileContext";
import { fmtTime } from "@/lib/format";
import { addSeconds, fmtLen, lenPatch, parseLen, secOf } from "@/lib/duration";
import type { ItemKind, OrderTemplate, TemplateItem } from "@/lib/types";

/** Standard orders of service that new plans can start from. */
export default function TemplatesPage() {
  const me = useProfile();
  const loc = useLocations();
  const supabase = createClient();
  const [list, setList] = useState<OrderTemplate[]>([]);
  const [missing, setMissing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("order_templates").select("*").order("name");
    if (error) return setMissing(true);
    setList((data ?? []) as OrderTemplate[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const name = prompt("Template name (e.g. Ventnor standard, Christmas Eve)");
    if (!name?.trim()) return;
    const { data, error } = await supabase
      .from("order_templates")
      .insert({ name: name.trim(), location_id: loc.current, items: [] })
      .select()
      .single();
    if (error || !data) return alert(error?.message ?? "Could not create");
    await load();
    setOpenId(data.id);
  }

  if (missing) return <p className="text-muted">Templates need the database update <b>010_templates.sql</b>. Run it in Supabase, then reload.</p>;

  const shown = list.filter((t) => !loc.current || !t.location_id || t.location_id === loc.current);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <Link href="/plans" className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">Plans</Link>
          <h1 className="h1">Order templates</h1>
          <p className="text-sm text-muted">The standard run of show. New plans start from the location&apos;s ★ default. Changing a template doesn&apos;t change plans you&apos;ve already made.</p>
        </div>
        {me.isLeader && <button className="btn" onClick={create}>+ New template</button>}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">No templates yet.</p>}
      {shown.map((t) => (
        <TemplateCard key={t.id} t={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onChanged={load} canEdit={me.isLeader} />
      ))}
    </div>
  );
}

function TemplateCard({ t, open, onToggle, onChanged, canEdit }: { t: OrderTemplate; open: boolean; onToggle: () => void; onChanged: () => void; canEdit: boolean }) {
  const loc = useLocations();
  const supabase = createClient();
  const [items, setItems] = useState<TemplateItem[]>(t.items);
  const [name, setName] = useState(t.name);
  const [start, setStart] = useState(t.start_time?.slice(0, 5) ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setItems(t.items);
    setName(t.name);
    setStart(t.start_time?.slice(0, 5) ?? "");
    setDirty(false);
  }, [t]);

  const change = (next: TemplateItem[]) => {
    setItems(next);
    setDirty(true);
  };
  const set = (i: number, patch: Partial<TemplateItem>) => change(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const add = (kind: ItemKind) =>
    change([...items, { kind, title: kind === "header" ? "New section" : "New item", ...(kind === "header" ? lenPatch(null) : lenPatch(300)), description: null }]);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("order_templates")
      .update({ name: name.trim() || t.name, start_time: start || null, items, updated_at: new Date().toISOString() })
      .eq("id", t.id);
    setSaving(false);
    if (error) return alert(error.message);
    setDirty(false);
    onChanged();
  }

  async function makeDefault() {
    // One default per location.
    let q = supabase.from("order_templates").update({ is_default: false }).neq("id", t.id);
    q = t.location_id ? q.eq("location_id", t.location_id) : q.is("location_id", null);
    await q;
    const { error } = await supabase.from("order_templates").update({ is_default: true }).eq("id", t.id);
    if (error) alert(error.message);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete template "${t.name}"? Plans already made from it are not affected.`)) return;
    const { error } = await supabase.from("order_templates").delete().eq("id", t.id);
    if (error) alert(error.message);
    onChanged();
  }

  let clock = start || null;
  const total = items.reduce((n, x) => n + (secOf(x) ?? 0), 0);
  const sectionSec = (i: number) => {
    let n = 0;
    for (let j = i + 1; j < items.length && items[j].kind !== "header"; j++) n += secOf(items[j]) ?? 0;
    return n;
  };

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-stone-50">
        <span className="flex-1">
          <span className="font-display text-lg font-bold">{t.name}</span>
          {t.is_default && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-[10px] font-bold uppercase text-white">★ Default</span>}
          <span className="block text-sm text-muted">
            {t.location_id ? loc.name(t.location_id) : "All locations"} · {t.items.filter((x) => x.kind !== "header").length} items · {fmtLen(t.items.reduce((n, x) => n + (secOf(x) ?? 0), 0))}
          </span>
        </span>
        <span className="text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-line">
          {canEdit && (
            <div className="flex flex-wrap items-end gap-3 bg-stone-50 px-4 py-3">
              <label className="block min-w-[12rem] flex-1"><span className="label">Name</span><input className="input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></label>
              <label className="block"><span className="label">Starts at</span><input type="time" className="input" value={start} onChange={(e) => { setStart(e.target.value); setDirty(true); }} /></label>
              {!t.is_default && <button className="btn-secondary" onClick={makeDefault}>★ Make default</button>}
              <button className="btn-secondary text-bad" onClick={remove}>Delete</button>
            </div>
          )}
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] border-y border-line px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-muted">
            <span>Length</span>
            <span>Title · total {fmtLen(total)}</span>
          </div>
          <ul>
            {items.map((it, i) => {
              const at = clock;
              const sec = secOf(it);
              if (clock && sec) clock = addSeconds(clock, sec);
              return it.kind === "header" ? (
                <li key={i} className="flex items-center gap-2 border-b border-line bg-stone-100 px-4 py-2">
                  {canEdit ? (
                    <input className="flex-1 bg-transparent text-xs font-bold uppercase tracking-wider outline-none" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
                  ) : (
                    <span className="flex-1 text-xs font-bold uppercase tracking-wider">{it.title}</span>
                  )}
                  {sectionSec(i) > 0 && <span className="text-xs font-semibold tabular-nums text-muted">{fmtLen(sectionSec(i))}</span>}
                  {canEdit && <RowControls i={i} n={items.length} move={move} remove={() => change(items.filter((_, j) => j !== i))} />}
                </li>
              ) : (
                <li key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-2 border-b border-line px-4 py-2.5">
                  <div className="text-sm tabular-nums">
                    {canEdit ? (
                      <LenInput sec={secOf(it)} onChange={(sec) => set(i, lenPatch(sec))} />
                    ) : (
                      <span className="font-semibold">{fmtLen(secOf(it) ?? 0)}</span>
                    )}
                    {at && <div className="text-xs text-muted">{fmtTime(at)}</div>}
                  </div>
                  <div className="min-w-0">
                    {canEdit ? (
                      <>
                        <input className="w-full bg-transparent text-sm font-semibold uppercase tracking-wide outline-none" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
                        <textarea
                          className="w-full resize-none bg-transparent text-sm text-muted outline-none placeholder:text-stone-300"
                          rows={Math.max(1, (it.description ?? "").split("\n").length)}
                          placeholder="Notes…"
                          value={it.description ?? ""}
                          onChange={(e) => set(i, { description: e.target.value || null })}
                        />
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-semibold uppercase tracking-wide">{it.title}</div>
                        {it.description && <p className="whitespace-pre-wrap text-sm text-muted">{it.description}</p>}
                      </>
                    )}
                  </div>
                  {canEdit && <RowControls i={i} n={items.length} move={move} remove={() => change(items.filter((_, j) => j !== i))} />}
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <div className="sticky bottom-16 flex flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-3 lg:bottom-0">
              <button className="btn-secondary" onClick={() => add("item")}>+ Item</button>
              <button className="btn-secondary" onClick={() => add("header")}>+ Section</button>
              <span className="flex-1" />
              {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
              <button className="btn" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save template"}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RowControls({ i, n, move, remove }: { i: number; n: number; move: (i: number, d: -1 | 1) => void; remove: () => void }) {
  return (
    <span className="flex items-start">
      <button className="btn-ghost px-1" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
      <button className="btn-ghost px-1" disabled={i === n - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
      <button className="btn-ghost px-1" onClick={remove} aria-label="Remove">✕</button>
    </span>
  );
}

function LenInput({ sec, onChange }: { sec: number | null; onChange: (sec: number | null) => void }) {
  const [v, setV] = useState(fmtLen(sec));
  useEffect(() => setV(fmtLen(sec)), [sec]);
  return (
    <input
      className="w-16 rounded border border-line px-1 py-0.5 text-right text-xs tabular-nums"
      aria-label="Length (m:ss)"
      placeholder="m:ss"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const s = parseLen(v);
        if (v.trim() && s == null) {
          alert("Use minutes:seconds, like 4:56 or 15");
          return setV(fmtLen(sec));
        }
        onChange(s);
      }}
    />
  );
}
