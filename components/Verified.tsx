/** The "confirmed member" check mark shown next to reliable people's names. */
export default function Verified({ on, className = "" }: { on?: boolean; className?: string }) {
  if (!on) return null;
  return (
    <svg viewBox="0 0 24 24" className={`inline-block h-4 w-4 shrink-0 align-[-2px] ${className}`} aria-label="Confirmed member" role="img">
      <title>Confirmed member</title>
      <path
        fill="#1d9bf0"
        d="M12 1.5l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-.9 2.9-3-.2L12 22.5l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.9-.9-2.9 2.5-1.7.9-2.9 3 .2z"
      />
      <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M7.8 12.2l2.8 2.8 5.6-5.8" />
    </svg>
  );
}
