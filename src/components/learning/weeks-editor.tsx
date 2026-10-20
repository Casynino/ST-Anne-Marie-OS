"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { inputClass } from "@/components/form";

export type WeekRow = { topic: string; objectives: string; activities: string; resources: string; assessment: string };
const EMPTY: WeekRow = { topic: "", objectives: "", activities: "", resources: "", assessment: "" };

/**
 * Rows of a scheme of work. Plain named inputs (w0_topic, w0_objectives, ...) so the form posts like any other; the
 * week number is simply the row position. Empty rows are ignored by the server action.
 */
export function WeeksEditor({ initial, labels }: { initial: WeekRow[]; labels: { week: string; topic: string; objectives: string; activities: string; resources: string; assessment: string; add: string; remove: string } }) {
  const [rows, setRows] = useState<(WeekRow & { key: number })[]>(() => (initial.length ? initial : [EMPTY, EMPTY, EMPTY, EMPTY]).map((r, i) => ({ ...r, key: i })));
  const [next, setNext] = useState(initial.length || 4);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <fieldset key={r.key} className="rounded-2xl border border-line bg-canvas/50 p-4">
          <legend className="px-2 text-sm font-bold text-link">{labels.week} {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-1 block text-sm font-medium">{labels.topic}</span><input name={`w${i}_topic`} defaultValue={r.topic} maxLength={160} className={inputClass} /></label>
            <label><span className="mb-1 block text-sm font-medium">{labels.objectives}</span><textarea name={`w${i}_objectives`} defaultValue={r.objectives} rows={3} maxLength={1500} className={inputClass} /></label>
            <label><span className="mb-1 block text-sm font-medium">{labels.activities}</span><textarea name={`w${i}_activities`} defaultValue={r.activities} rows={3} maxLength={1500} className={inputClass} /></label>
            <label><span className="mb-1 block text-sm font-medium">{labels.resources}</span><input name={`w${i}_resources`} defaultValue={r.resources} maxLength={800} className={inputClass} /></label>
            <label><span className="mb-1 block text-sm font-medium">{labels.assessment}</span><input name={`w${i}_assessment`} defaultValue={r.assessment} maxLength={800} className={inputClass} /></label>
          </div>
          {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-bad"><Trash2 className="size-4" aria-hidden />{labels.remove}</button>}
        </fieldset>
      ))}
      {rows.length < 60 && <button type="button" onClick={() => { setRows([...rows, { ...EMPTY, key: next }]); setNext(next + 1); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-brand-400 px-4 text-sm font-semibold text-link hover:bg-tint"><Plus className="size-4" aria-hidden />{labels.add}</button>}
    </div>
  );
}
