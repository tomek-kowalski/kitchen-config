import type { ReactNode } from "react";

/**
 * Shared selection styling: the accent (blue) marks the selected option with a border, a light
 * background and a check mark, so selection never relies on colour alone. Keyboard focus uses a
 * separate dark outline, and disabled options are greyed out without the accent.
 */
export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true" className={className}>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
      {children}
    </h2>
  );
}

export function ErrorList({ errors }: { errors: readonly { message: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      {errors.map((error, index) => (
        <li key={index}>{error.message}</li>
      ))}
    </ul>
  );
}
