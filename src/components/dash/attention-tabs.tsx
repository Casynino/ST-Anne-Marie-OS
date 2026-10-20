"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, AlertTriangle } from "lucide-react";

export type AttentionRow = { key: string; area: string; text: string; href: string };

/** "Needs your attention": filter by area, one row per item with a coloured edge (the pattern from Nino's other systems). */
export function AttentionTabs({ rows, areas, allLabel }: { rows: AttentionRow[]; areas: { id: string; label: string }[]; allLabel: string }) {
  const [area, setArea] = useState("all");
  const shown = area === "all" ? rows : rows.filter((r) => r.area === area);
  const counts = (id: string) => (id === "all" ? rows.length : rows.filter((r) => r.area === id).length);
  const tabs = [{ id: "all", label: allLabel }, ...areas.filter((a) => counts(a.id) > 0)];
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      {tabs.length > 2 && (
        <div role="tablist" className="flex flex-wrap gap-2 border-b border-line p-3">
          {tabs.map((tab) => (
            <button key={tab.id} role="tab" aria-selected={area === tab.id} type="button" onClick={() => setArea(tab.id)} className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors ${area === tab.id ? "bg-sun text-brand-950" : "border border-line text-ink hover:bg-canvas"}`}>
              {tab.label}<span className={`text-xs ${area === tab.id ? "text-brand-950/70" : "text-muted"}`}>{counts(tab.id)}</span>
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line">
        {shown.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="group flex min-h-14 items-center gap-4 px-4 py-3 hover:bg-canvas">
              <span aria-hidden className="h-9 w-1 shrink-0 rounded-full bg-warn" />
              <AlertTriangle className="size-5 shrink-0 text-warn" aria-hidden />
              <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{r.text}</span>
              <ChevronRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
