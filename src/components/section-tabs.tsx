import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type TabItem = { href: string; label: string; icon?: LucideIcon; badge?: number | null };

/** The tabs of one area (Admissions, Finance, Attendance...): an icon and a label each, the current one underlined, a number when something is waiting. */
export function SectionTabs({ items, current, label }: { items: TabItem[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="no-print -mx-3 mb-5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-1 whitespace-nowrap border-b border-line">
        {items.map((i) => {
          const active = current === i.href;
          const Icon = i.icon;
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? "page" : undefined} className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition-colors ${active ? "border-link text-ink" : "border-transparent text-muted hover:border-line hover:text-ink"}`}>
                {Icon && <Icon className={`size-4 shrink-0 ${active ? "text-link" : ""}`} aria-hidden />}
                {i.label}
                {(i.badge ?? 0) > 0 && <span className="rounded-md bg-warn px-1.5 text-xs font-semibold leading-5 text-white">{i.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
