"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Submit button for forms that have several actions (uses `intent` as name/value). Shows a busy state while the action runs. */
export function SubmitButton({ children, intent, variant = "primary", confirm, className = "" }: { children: ReactNode; intent?: string; variant?: "primary" | "secondary" | "danger"; confirm?: string; className?: string }) {
  const { pending } = useFormStatus();
  const tone =
    variant === "primary" ? "bg-brand-700 text-white hover:bg-brand-800" : variant === "danger" ? "border border-bad/40 bg-white text-bad hover:bg-red-50" : "border border-line bg-white text-ink hover:bg-canvas";
  return (
    <button
      type="submit"
      name={intent ? "intent" : undefined}
      value={intent}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${tone} ${className}`}
    >
      {pending ? "…" : children}
    </button>
  );
}
