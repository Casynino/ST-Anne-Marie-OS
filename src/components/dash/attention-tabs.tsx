"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Info } from "lucide-react";

export type AttentionRow = { key: string; area: string; text: string; href: string; tone?: "bad" | "warn" | "info"; detail?: string; count?: number };
const EDGE = { bad: "bg-bad", warn: "bg-warn", info: "bg-[#8b80ff]" } as const;
const ICON = { bad: "text-bad", warn: "text-warn", info: "text-[#a9a0ff]" } as const;
const SHOWN = 3;

/**
 * "Needs your attention": one row per item with a coloured edge, what it is, and one plain sentence about what to do. Filter by area. With
 * `heading` it is a full-width section of its own (a small capital heading with the number of items); without it, it is a panel with a title.
 */
export function AttentionTabs({ rows, areas, allLabel, title, subtitle, heading, moreLabel, className = "" }: { rows: AttentionRow[]; areas: { id: string; label: string }[]; allLabel: string; title?: string; subtitle?: string; heading?: string; moreLabel?: string; className?: string }) {
  const [area, setArea] = useState("all");
  const shown = area === "all" ? rows : rows.filter((r) => r.area === area);
  const counts = (id: string) => (id === "all" ? rows.length : rows.filter((r) => r.area === id).length);
  const tabs = [{ id: "all", label: allLabel }, ...areas.filter((a) => counts(a.id) > 0)];
  const card = (
    <div className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] ${heading ? "" : className}`}>
      {title && !heading && <header className="flex items-baseline justify-between gap-3 px-5 pb-1 pt-4"><h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>{subtitle && <p className="text-sm text-muted">{subtitle}</p>}</header>}
      {tabs.length > 2 && (
        <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2.5">
          {tabs.map((tab) => (
            <button key={tab.id} role="tab" aria-selected={area === tab.id} type="button" onClick={() => setArea(tab.id)} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors ${area === tab.id ? "bg-link text-canvas" : "border border-line text-ink hover:bg-canvas"}`}>
              {tab.label}<span className={`text-[11px] tabular-nums ${area === tab.id ? "text-canvas/75" : "text-muted"}`}>{counts(tab.id)}</span>
            </button>
          ))}
        </div>
      )}
      <ul className={`${heading ? "max-h-[10.5rem]" : "max-h-[22rem]"} divide-y divide-line overflow-y-auto`}>
        {shown.map((r) => {
          const tone = r.tone ?? "warn";
          const Icon = tone === "info" ? Info : AlertTriangle;
          return (
            <li key={r.key}>
              <Link href={r.href} className="group flex min-h-[3.5rem] items-center gap-3 px-3.5 py-2 hover:bg-canvas">
                <span aria-hidden className={`h-8 w-[3px] shrink-0 rounded-sm ${EDGE[tone]}`} />
                <Icon className={`size-4 shrink-0 ${ICON[tone]}`} aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold leading-5 text-ink">{r.text}</span>{r.detail && <span className="block truncate text-[13px] leading-5 text-muted">{r.detail}</span>}</span>
                {r.count !== undefined && <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${ICON[tone]}`}>{r.count}</span>}
                <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      {moreLabel && shown.length > SHOWN && <p className="flex items-center justify-center gap-1.5 border-t border-line bg-canvas/50 py-1.5 text-xs text-muted"><ChevronDown className="size-3.5" aria-hidden />{moreLabel.replace("{n}", String(shown.length - SHOWN))}</p>}
    </div>
  );
  if (!heading) return card;
  return (
    <section aria-label={heading} className={`mt-5 ${className}`}>
      <h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-muted">{heading}<span className="rounded bg-sun px-1.5 py-px text-[11px] font-bold tracking-normal text-brand-950">{rows.length}</span></h2>
      {card}
    </section>
  );
}
