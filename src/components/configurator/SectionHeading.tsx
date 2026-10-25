import type { ReactNode } from "react";

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
