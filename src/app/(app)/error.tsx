"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Error boundary for staff pages: a clear message, a retry button, and the error digest for support. Details stay in the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
      <AlertTriangle className="mx-auto size-8 text-warn" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted">This page could not be loaded. Your data has not been changed. Please try again.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">Try again</button>
    </div>
  );
}
