"use client";

import { useState } from "react";
import { Field } from "@/components/form";

/** A date and time for an interview, with the dates already set for other applicants offered first, so another applicant can join one of them. */
export function SlotField({ name, label, pickLabel, slots, required }: { name: string; label: string; pickLabel: string; slots: { local: string; label: string }[]; required?: boolean }) {
  const [picked, setPicked] = useState("");
  return (
    <div className="space-y-2 sm:col-span-2">
      {slots.length > 0 && (
        <label className="block text-sm">
          <span className="font-medium">{pickLabel}</span>
          <select value={picked} onChange={(e) => setPicked(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base">
            <option value="">—</option>
            {slots.map((s) => <option key={s.local} value={s.local}>{s.label}</option>)}
          </select>
        </label>
      )}
      {picked && <input type="hidden" name="allowSharedSlot" value="on" />}
      <Field key={picked} name={name} type="datetime-local" label={label} defaultValue={picked || undefined} required={required} />
    </div>
  );
}
