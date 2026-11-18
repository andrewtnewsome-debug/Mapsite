export function Logo({ className }: { className?: string }) {
  // Original mark: two stacked ledger bars rising to the right.
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="7" fill="var(--primary)" />
      <rect x="7" y="15" width="4" height="6" rx="1.2" fill="var(--primary-fg)" opacity="0.55" />
      <rect x="12" y="11" width="4" height="10" rx="1.2" fill="var(--primary-fg)" opacity="0.78" />
      <rect x="17" y="7" width="4" height="14" rx="1.2" fill="var(--primary-fg)" />
    </svg>
  );
}
