"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="display text-4xl text-heading">Something went wrong</h1>
      <p className="mt-3 text-lg text-muted">This page could not be loaded. Please try again, or contact the school office.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="inline-flex min-h-12 items-center rounded-full bg-brand-700 px-6 font-semibold text-white hover:bg-brand-800">Try again</button>
        <Link href="/" className="inline-flex min-h-12 items-center rounded-full border-2 border-brand-700 px-6 font-semibold text-heading hover:bg-brand-700 hover:text-white">Home</Link>
      </div>
    </div>
  );
}
