import Link from "next/link";
import type { ReactNode } from "react";
import { NAV_ICONS } from "@/components/app-shell/icons";
import { GRADIENT, type GradientTone } from "./parts";
import type { Quick } from "./quick-links";

const TONES: GradientTone[] = ["violet", "teal", "orange", "rose", "indigo", "green"];

/**
 * The one row of things to do and places to go on a home page (up to eight; the sidebar has the rest). The first is the main action, a solid
 * green button; the others are small cards with a coloured icon tile. A number appears when something is waiting there.
 */
export function ActionBar({ items, trailing, label }: { items: Quick[]; trailing?: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-2.5">
      {items.slice(0, 8).map((q, i) => {
        const Icon = NAV_ICONS[q.icon];
        const count = q.count ? <span className="rounded-md bg-sun px-1.5 text-xs font-semibold tabular-nums text-brand-950">{q.count}</span> : null;
        if (i === 0) {
          return (
            <Link key={q.href + q.label} href={q.href} className="btn-primary inline-flex min-h-10 items-center gap-2 px-4 text-sm font-medium">
              <Icon className="size-4" aria-hidden />{q.label}{count}
            </Link>
          );
        }
        return (
          <Link key={q.href + q.label} href={q.href} className="group inline-flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-ink shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-link/50 hover:shadow-[var(--shadow-lift)]">
            <span className={`grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${GRADIENT[TONES[(i - 1) % TONES.length]!]} text-white`}><Icon className="size-3.5" aria-hidden /></span>
            {q.label}{count}
          </Link>
        );
      })}
      {trailing}
    </nav>
  );
}
