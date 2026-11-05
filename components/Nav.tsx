"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHURCH_NAME } from "@/lib/format";
import { useLocations, useProfile } from "./ProfileContext";

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  const me = useProfile();
  const loc = useLocations();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/", label: "Home" },
    { href: "/plans", label: "Plans" },
    { href: "/songs", label: "Songs" },
    { href: "/teams", label: "Teams" },
    ...(me.isAdmin ? [{ href: "/people", label: "People" }] : []),
    { href: "/me", label: "My Profile" },
  ];
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={CHURCH_NAME} className="h-8 w-auto" />
          <span className="hidden border-l border-line pl-2 font-display text-xs font-bold uppercase tracking-widest text-muted sm:inline">Worship</span>
        </Link>
        {loc.locations.length > 0 &&
          (loc.canSwitch ? (
            <select
              aria-label="Location"
              className="rounded-sm border border-line bg-white px-2 py-1 font-display text-xs font-bold uppercase tracking-wide text-ink"
              value={loc.current ?? ""}
              onChange={(e) => {
                loc.setCurrent(e.target.value || null);
                router.refresh();
              }}
            >
              <option value="">All locations</option>
              {loc.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          ) : (
            <span className="rounded-sm bg-accent-soft px-2 py-1 font-display text-xs font-bold uppercase tracking-wide text-accent">
              {loc.name(loc.current)}
            </span>
          ))}
        <nav className="ml-2 hidden gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm ${active(l.href) ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 text-sm md:flex">
          <span className="text-muted">{me.full_name || me.email}</span>
          <button onClick={signOut} className="btn-ghost">Sign out</button>
        </div>
        <button className="ml-auto btn-ghost md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          ☰
        </button>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-2 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`block py-2 ${active(l.href) ? "font-semibold text-accent" : ""}`}>
              {l.label}
            </Link>
          ))}
          <button onClick={signOut} className="block py-2 text-muted">Sign out</button>
        </nav>
      )}
    </header>
  );
}
