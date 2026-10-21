import Link from "next/link";
import type { ReactNode } from "react";
import { NAV_ICONS } from "@/components/app-shell/icons";
import type { Quick } from "./quick-links";

/** The one row of things to do and places to go on a home page (the six that matter most; the sidebar has the rest). The first is the main action, a number appears when something is waiting there. */
export function ActionBar({ items, trailing, label }: { items: Quick[]; trailing?: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-2">
      {items.slice(0, 6).map((q, i) => {
        const Icon = NAV_ICONS[q.icon];
        return (
          <Link key={q.href + q.label} href={q.href} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${i === 0 ? "bg-brand-700 text-white hover:bg-brand-600" : "border border-line bg-surface text-ink hover:border-brand-500 hover:text-link"}`}>
            <Icon className="size-4" aria-hidden />{q.label}
            {q.count ? <span className="rounded bg-sun px-1.5 text-xs font-bold tabular-nums text-brand-950">{q.count}</span> : null}
          </Link>
        );
      })}
      {trailing}
    </nav>
  );
}
