"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The filter row of the applications list. Choosing a class, a person, an interview state or a date applies at once; the search applies on
 * Enter. The date range and the channel sit under "More filters", which opens by itself when one of them is in use.
 */
export function DeskFilters({ children, more, moreLabel, moreOpen, resetHref, active, clearLabel }: {
  children: ReactNode; more: ReactNode; moreLabel: string; moreOpen: boolean; resetHref: string; active: boolean; clearLabel: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      method="get"
      onChange={(e) => {
        const el = e.target as Element;
        if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === "date")) ref.current?.requestSubmit();
      }}
      className="mb-4 rounded-lg border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {active && <Link href={resetHref} className="inline-flex min-h-10 items-center px-2 text-sm font-medium text-link hover:underline">{clearLabel}</Link>}
      </div>
      <details open={moreOpen} className="group mt-2">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-sm font-medium text-link marker:hidden [&::-webkit-details-marker]:hidden">
          {moreLabel}<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">{more}</div>
      </details>
    </form>
  );
}
