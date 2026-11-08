"use client";
import { createClient } from "@/lib/supabase/client";
import type { Tutorial } from "@/lib/types";

// "Practice on Worship Online": jump from a Fusion song straight to the same song on Worship Online
// (tutorials per instrument, stems, loops). The link is saved with the song's tutorials.

export const isWO = (u?: string | null) => !!u && /(^|\/\/|\.)worshiponline\.com/i.test(u);

export default function WorshipOnline({
  songId,
  title,
  tutorials,
  referenceUrl,
  canEdit,
  onSaved,
  compact = false,
}: {
  songId: string;
  title: string;
  tutorials?: Tutorial[] | null;
  referenceUrl?: string | null;
  canEdit: boolean;
  onSaved?: (next: Tutorial[]) => void;
  compact?: boolean;
}) {
  const link = tutorials?.find((t) => isWO(t.url))?.url ?? (isWO(referenceUrl) ? referenceUrl : null);
  const find = `https://www.google.com/search?q=${encodeURIComponent(`site:worshiponline.com ${title}`)}`;

  async function connect() {
    const url = prompt(
      `Paste the Worship Online link for "${title}".\n\nOpen the song on worshiponline.com (or in their app tap Share → Copy link), then paste it here.`,
      link ?? ""
    );
    if (url === null) return;
    const clean = url.trim();
    if (clean && !isWO(clean)) return alert("That doesn't look like a worshiponline.com link.");
    const next = [...(tutorials ?? []).filter((t) => !isWO(t.url)), ...(clean ? [{ part: "Full band", title: "Worship Online", url: clean }] : [])];
    const { error } = await createClient().from("songs").update({ tutorials: next }).eq("id", songId);
    if (error) return alert(/tutorials/.test(error.message) ? "This needs the database update (run ALL_UPDATES.sql). " + error.message : error.message);
    onSaved?.(next);
  }

  const btn = compact ? "rounded-full px-3 py-1.5 text-xs" : "rounded-lg px-4 py-2.5 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {link ? (
        <a href={link} target="_blank" rel="noopener" className={`${btn} inline-flex items-center gap-1.5 bg-[#1f6feb] font-bold text-white shadow-sm hover:opacity-90`}>
          ▶ Practice on Worship Online
        </a>
      ) : (
        <a href={find} target="_blank" rel="noopener" className={`${btn} inline-flex items-center gap-1.5 border border-[#1f6feb] font-bold text-[#1f6feb] hover:bg-[#1f6feb]/10`}>
          🔎 Find on Worship Online
        </a>
      )}
      {canEdit && (
        <button onClick={connect} className="text-xs font-semibold text-muted underline-offset-2 hover:underline">
          {link ? "Change link" : "Connect link"}
        </button>
      )}
    </div>
  );
}
