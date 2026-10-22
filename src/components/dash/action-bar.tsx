import Link from "next/link";
import type { ReactNode } from "react";
import type { Quick } from "./quick-links";

/**
 * The one row of things to do and places to go on a home page (up to eight; the sidebar has the rest). The first is the main action, a solid
 * green button; the others are plain outlined text buttons (no icons). A number appears when something is waiting there.
 */
export function ActionBar({ items, trailing, label }: { items: Quick[]; trailing?: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-2.5">
      {items.slice(0, 8).map((q, i) => {
        const count = q.count ? <span className="rounded-md bg-sun px-1.5 text-xs font-semibold tabular-nums text-brand-950">{q.count}</span> : null;
        if (i === 0) {
          return (
            <Link key={q.href + q.label} href={q.href} className="btn-primary inline-flex min-h-10 items-center gap-2 px-4 text-sm font-medium">
              {q.label}{count}
            </Link>
          );
        }
        return (
          <Link key={q.href + q.label} href={q.href} className="group inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-link/60 hover:bg-tint hover:text-link">
            {q.label}{count}
          </Link>
        );
      })}
      {trailing}
    </nav>
  );
}
