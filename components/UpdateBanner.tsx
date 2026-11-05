"use client";
import { useEffect, useState } from "react";

const MINE = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/** Shows "New version ready" when the site has been updated since this page loaded. */
export default function UpdateBanner() {
  const [latest, setLatest] = useState("");
  useEffect(() => {
    if (!MINE) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        const j = (await r.json()) as { version?: string };
        if (!stop && j.version && j.version !== MINE) setLatest(j.version);
      } catch {}
    };
    check();
    const id = window.setInterval(check, 3 * 60 * 1000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  if (!latest) return null;
  return (
    <button
      onClick={() => window.location.reload()}
      className="fixed inset-x-0 top-0 z-[100] bg-accent px-4 py-3 text-center text-sm font-bold text-white shadow-lg print:hidden"
    >
      ✨ New version ready – tap to update
    </button>
  );
}
