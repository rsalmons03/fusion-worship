"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  schedule: <path d="M4 12l8-8 8 8M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" />,
  plans: <path d="M9 4h6M9 4a2 2 0 0 0-2 2H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1a2 2 0 0 0-2-2M9 11h6M9 15h6" />,
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 8h2m4 0h2m-8 4h2m4 0h2" />,
  songs: <path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z" />,
  training: <path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Zm6 3v6l5-3-5-3Z" />,
};

const TABS = [
  { href: "/", label: "Home", icon: I.schedule },
  { href: "/plans", label: "Plans", icon: I.plans },
  { href: "/calendar", label: "Calendar", icon: I.calendar },
  { href: "/songs", label: "Songs", icon: I.songs },
  { href: "/trainings", label: "Training", icon: I.training },
];

/** Phone tab bar. Hidden on larger screens, where the top menu shows everything. */
export default function BottomNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold uppercase tracking-wide ${active(t.href) ? "text-accent" : "text-muted"}`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {t.icon}
            </svg>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
