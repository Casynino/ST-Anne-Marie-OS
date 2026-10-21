"use client";

import { useState } from "react";

export type ClassCell = { key: string; name: string; students: string; status: "FINALISED" | "DRAFT" | "NOT_STARTED"; statusLabel: string; present: string; absent: string; absentCount: number; pct: number };

/** "Every class right now": filter by register state, one card per class with its present and absent count and a bar. */
export function ClassGrid({ cells, tabs, label }: { cells: ClassCell[]; tabs: { id: "all" | ClassCell["status"]; label: string }[]; label: string }) {
  const [tab, setTab] = useState<"all" | ClassCell["status"]>("all");
  const count = (id: "all" | ClassCell["status"]) => (id === "all" ? cells.length : cells.filter((c) => c.status === id).length);
  const shown = tab === "all" ? cells : cells.filter((c) => c.status === tab);
  return (
    <div>
      <div role="tablist" aria-label={label} className="mb-4 flex flex-wrap gap-1.5">
        {tabs.filter((x) => x.id === "all" || count(x.id) > 0).map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} type="button" onClick={() => setTab(x.id)} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors ${tab === x.id ? "bg-sun text-brand-950" : "border border-line text-ink hover:bg-canvas"}`}>
            {x.label}<span className={`text-xs ${tab === x.id ? "text-brand-950/70" : "text-muted"}`}>{count(x.id)}</span>
          </button>
        ))}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) => (
          <li key={c.key} className={`rounded-xl border bg-canvas/60 p-3.5 ${c.status === "FINALISED" ? "border-ok/30" : c.status === "DRAFT" ? "border-warn/40" : "border-line"}`}>
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-lg font-semibold leading-tight text-heading">{c.name}</p><p className="text-xs text-muted">{c.students}</p></div>
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.12em] ring-1 ring-inset ${c.status === "FINALISED" ? "bg-ok/12 text-ok ring-ok/25" : c.status === "DRAFT" ? "bg-warn/12 text-warn ring-warn/25" : "bg-muted/12 text-muted ring-muted/25"}`}>{c.statusLabel}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm"><span className="text-ok">{c.present}</span><span className={c.absentCount > 0 ? "font-semibold text-bad" : "text-muted"}>{c.absent}</span></div>
            <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-ok" style={{ width: `${c.pct}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
