"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BG_STYLES, PALETTES, parseBg } from "@/lib/slides";
import Background, { isVideo, useSignedUrl } from "./Backgrounds";

const FOLDER = "backgrounds";

function Thumb({ path }: { path: string }) {
  const url = useSignedUrl(isVideo(path) ? null : path);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className="grid h-full w-full place-items-center bg-stone-800 text-lg">{isVideo(path) ? "🎬" : "🖼"}</span>
  );
}

/** Background chooser for the lyrics remote: animated styles × colours, or your own uploaded photos/videos. */
export default function BackgroundPicker({ bg, onPick, children }: { bg: string; onPick: (bg: string) => void; children?: React.ReactNode }) {
  const cur = parseBg(bg);
  const [media, setMedia] = useState<{ name: string; path: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient().storage.from("charts").list(FOLDER, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    setMedia((data ?? []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => ({ name: f.name, path: `${FOLDER}/${f.name}` })));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    const supabase = createClient();
    for (const [i, f] of list.entries()) {
      if (f.size > 50 * 1024 * 1024) {
        alert(`${f.name} is over 50 MB. Shorter loops (10–30 seconds) work best.`);
        continue;
      }
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      const ext = f.name.split(".").pop()?.toLowerCase() || (f.type.startsWith("video") ? "mp4" : "jpg");
      const safe = f.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
      const path = `${FOLDER}/${Date.now()}-${safe}.${ext}`;
      const { error } = await supabase.storage.from("charts").upload(path, f, { contentType: f.type || undefined });
      if (error) alert(`${f.name}: ${error.message}${/row-level|policy|unauthor/i.test(error.message) ? " (only leaders can upload)" : ""}`);
      else if (i === 0) onPick(`media:${path}`);
    }
    setBusy("");
    load();
  }

  async function remove(path: string) {
    if (!confirm("Delete this background?")) return;
    const { error } = await createClient().storage.from("charts").remove([path]);
    if (error) return alert(error.message);
    if (cur.path === path) onPick("bokeh:ember");
    load();
  }

  const palette = cur.style === "media" || cur.style === "black" ? "ember" : cur.palette;
  return (
    <section className="space-y-3 rounded-lg border border-stone-800 p-3 text-sm" id="backgrounds">
      <div className="flex items-center">
        <div className="flex-1 text-xs font-bold uppercase tracking-wide text-stone-400">Background</div>
        <button className="text-xs font-semibold text-stone-300" onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview"}</button>
      </div>
      {preview && (
        <div className="relative aspect-video w-full overflow-hidden rounded-md">
          <Background bg={bg} />
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] text-stone-400">Motion</div>
        <div className="flex flex-wrap gap-1.5">
          {BG_STYLES.map((st) => (
            <button
              key={st.id}
              onClick={() => onPick(st.id === "black" ? "black" : `${st.id}:${palette}`)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${cur.style === st.id ? "bg-white text-black" : "bg-stone-800"}`}
            >
              {st.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] text-stone-400">Colours</div>
        <div className="flex flex-wrap gap-2">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(`${cur.style === "media" || cur.style === "black" ? "bokeh" : cur.style}:${p.id}`)}
              className={`h-9 w-12 rounded-md text-[10px] font-bold ring-2 [text-shadow:0_1px_2px_#000] ${cur.style !== "media" && cur.style !== "black" && cur.palette === p.id ? "ring-white" : "ring-transparent"}`}
              style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]} 60%, ${p.colors[2]})` }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center text-[11px] text-stone-400">
          <span className="flex-1">My backgrounds (photos &amp; video loops)</span>
          <label className={`cursor-pointer rounded-full bg-accent px-3 py-1 text-xs font-bold text-white ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy || "+ Upload"}
            <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {media.length === 0 ? (
          <p className="text-xs text-stone-500">Upload a photo (series art) or a short looping video (MP4). It fills the screen behind the words.</p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {media.map((m) => (
              <div key={m.path} className={`relative aspect-video overflow-hidden rounded ring-2 ${cur.path === m.path ? "ring-white" : "ring-transparent"}`}>
                <button className="h-full w-full" onClick={() => onPick(`media:${m.path}`)} title={m.name}>
                  <Thumb path={m.path} />
                </button>
                <button onClick={() => remove(m.path)} className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-[10px]" aria-label="Delete">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
