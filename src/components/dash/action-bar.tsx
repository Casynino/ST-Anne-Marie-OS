import Link from "next/link";
import type { ReactNode } from "react";
import type { Quick } from "./quick-links";

/**
 * The one row of things to do and places to go on a home page (up to eight; the sidebar has the rest), as plain text links on one line: no
 * boxes, no icons, no colours. The first is the main action (bold); a number in yellow appears when something is waiting there.
 */
export function ActionBar({ items, trailing, label }: { items: Quick[]; trailing?: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line pb-2.5">
      {items.slice(0, 8).map((q, i) => (
        <Link key={q.href + q.label} href={q.href} className={`inline-flex min-h-8 items-center gap-1.5 text-sm hover:text-link hover:underline ${i === 0 ? "font-semibold text-ink" : "font-medium text-muted"}`}>
          {q.label}
          {q.count ? <span className="text-xs font-semibold tabular-nums text-sun">{q.count}</span> : null}
        </Link>
      ))}
      {trailing}
    </nav>
  );
}
