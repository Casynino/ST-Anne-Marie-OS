import Link from "next/link";
import type { ReactNode } from "react";
import { NAV_ICONS } from "@/components/app-shell/icons";
import type { Quick } from "./quick-links";

const TONES = ["tone-sky", "tone-butter", "tone-mint", "tone-lav", "tone-peach", "tone-blush"] as const;

/** The one row of things to do and places to go on a home page (the six that matter most; the sidebar has the rest). The first is the main action, a number appears when something is waiting there. */
export function ActionBar({ items, trailing, label }: { items: Quick[]; trailing?: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-2">
      {items.slice(0, 8).map((q, i) => {
        const Icon = NAV_ICONS[q.icon];
        return (
          <Link key={q.href + q.label} href={q.href} className={`inline-flex min-h-10 items-center gap-2 px-3.5 text-sm font-medium ${TONES[i % TONES.length]} rounded-[0.625rem] bg-[var(--t-bg)] text-[var(--t-fg)] ring-1 ring-inset ring-white/10 transition-[transform,filter] hover:-translate-y-0.5 hover:brightness-110`}>
            <Icon className="size-4" aria-hidden />{q.label}
            {q.count ? <span className="rounded-md bg-sun px-1.5 text-xs font-semibold tabular-nums text-brand-950">{q.count}</span> : null}
          </Link>
        );
      })}
      {trailing}
    </nav>
  );
}
