"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHURCH_NAME } from "@/lib/format";
import Avatar, { displayName } from "./Avatar";
import { useLocations, useProfile } from "./ProfileContext";

type L = { href: string; label: string };

/** Closes a dropdown when you click outside it. */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  const me = useProfile();
  const loc = useLocations();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const manageRef = useOutside(manageOpen, () => setManageOpen(false));
  const userRef = useOutside(userOpen, () => setUserOpen(false));

  const main: L[] = [
    { href: "/", label: "Home" },
    { href: "/plans", label: "Plans" },
    { href: "/calendar", label: "Calendar" },
    { href: "/songs", label: "Songs" },
    { href: "/trainings", label: "Training" },
  ];
  const manage: L[] = [
    { href: "/teams", label: "Teams" },
    ...(me.isAdmin ? [{ href: "/people", label: "People" }] : []),
    ...(me.isLeader
      ? [
          { href: "/roster", label: "Roster" },
          { href: "/confirmations", label: "Confirmations" },
          { href: "/health", label: "Team health" },
        ]
      : []),
  ];
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const manageActive = manage.some((l) => active(l.href));
  const name = displayName(me);

  useEffect(() => {
    setOpen(false);
    setManageOpen(false);
    setUserOpen(false);
  }, [path]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const linkCls = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-ink text-white" : "text-muted hover:bg-stone-100 hover:text-ink"}`;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={CHURCH_NAME} className="h-8 w-auto" />
        </Link>
        {loc.locations.length > 0 &&
          (loc.canSwitch ? (
            <select
              aria-label="Location"
              className="rounded-full border border-line bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink"
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
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent">{loc.name(loc.current)}</span>
          ))}

        <nav className="ml-2 hidden items-center gap-1 lg:flex">
          {main.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls(active(l.href))}>
              {l.label}
            </Link>
          ))}
          {manage.length > 0 && (
            <div ref={manageRef} className="relative">
              <button className={linkCls(manageActive)} onClick={() => setManageOpen(!manageOpen)} aria-expanded={manageOpen}>
                Manage ▾
              </button>
              {manageOpen && (
                <div className="absolute left-0 mt-2 w-52 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
                  {manage.map((l) => (
                    <Link key={l.href} href={l.href} className={`block px-4 py-2 text-sm hover:bg-stone-50 ${active(l.href) ? "font-semibold text-accent" : ""}`}>
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div ref={userRef} className="relative ml-auto hidden lg:block">
          <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-stone-100" onClick={() => setUserOpen(!userOpen)} aria-expanded={userOpen}>
            <Avatar name={name} size="sm" />
            <span className="max-w-[10rem] truncate text-sm font-medium">{name}</span>
          </button>
          {userOpen && (
            <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
              <Link href="/me" className="block px-4 py-2 text-sm hover:bg-stone-50">My profile</Link>
              <button onClick={signOut} className="block w-full px-4 py-2 text-left text-sm text-muted hover:bg-stone-50">Sign out</button>
            </div>
          )}
        </div>

        <button className="ml-auto grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-2 lg:hidden">
          {[...main, ...manage, { href: "/me", label: "My profile" }].map((l) => (
            <Link key={l.href} href={l.href} className={`block py-2.5 ${active(l.href) ? "font-semibold text-accent" : ""}`}>
              {l.label}
            </Link>
          ))}
          <button onClick={signOut} className="block py-2.5 text-muted">Sign out</button>
        </nav>
      )}
    </header>
  );
}
