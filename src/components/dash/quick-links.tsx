import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { NAV_ICONS, type NavIcon } from "@/components/app-shell/icons";

export type Quick = { href: string; label: string; icon: NavIcon; count?: number | null; hint?: string };

/** Easy access: the handful of places each person uses most, one tile each, with a number on it when something is waiting there. */
export function QuickLinks({ items, label }: { items: Quick[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {items.map((q) => {
        const Icon = NAV_ICONS[q.icon];
        return (
          <li key={q.href + q.label}>
            <Link href={q.href} className="group relative flex h-full min-h-[5.5rem] flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-[var(--shadow-lift)]">
              <span className="flex items-start justify-between gap-2">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-600/12 text-link"><Icon className="size-5" aria-hidden /></span>
                {q.count ? <span className="min-w-6 rounded-md bg-sun px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-brand-950">{q.count}</span> : <ArrowUpRight className="size-4 text-muted transition-colors group-hover:text-link" aria-hidden />}
              </span>
              <span><span className="block text-sm font-semibold leading-tight text-ink">{q.label}</span>{q.hint && <span className="mt-0.5 block text-xs text-muted">{q.hint}</span>}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
