"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Field, IfConflict, inputClass, useFormValues } from "@/components/form";

type Found = { id: string; fullName: string; phone: string; children: number };
export type GuardianLabels = {
  title?: string;
  search: string;
  useExisting: string;
  clear: string;
  existing: string;
  sharedPhone: string;
  siblingHint: string;
  fullName: string;
  phone: string;
  altPhone: string;
  email: string;
  occupation: string;
  relationship: string;
  financial: string;
  notify: string;
  optional: string;
  select: string;
  relationships: { value: string; label: string }[];
};

/**
 * Guardian entry: pick an existing guardian (explicit link, e.g. for siblings) or enter a new one.
 * `prefix` namespaces the inputs ("g1_" in the registration form, "" in the link form).
 */
export function GuardianFields({ prefix, labels, primary, canSearch, optionalBlock }: { prefix: string; labels: GuardianLabels; primary?: boolean; canSearch: boolean; optionalBlock?: boolean }) {
  const req = !optionalBlock; // an optional block must not carry `required`, or hidden empty fields block the whole form
  const { values } = useFormValues();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [chosen, setChosen] = useState<Found | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredId = values?.[`${prefix}guardianId`];

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/guardians/search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
        if (res.ok) setResults((await res.json()).items);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const guardianId = chosen?.id ?? (restoredId && !chosen ? restoredId : "");

  return (
    <div className="space-y-3">
      {canSearch && !guardianId && (
        <div className="relative">
          <label className="mb-1 block text-sm font-medium" htmlFor={`${prefix}search`}>{labels.search}</label>
          <input id={`${prefix}search`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} autoComplete="off" />
          <p className="mt-1 text-sm text-muted">{labels.siblingHint}</p>
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-white shadow-md">
              {results.map((g) => (
                <li key={g.id}>
                  <button type="button" onClick={() => { setChosen(g); setResults([]); setQuery(""); }} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-canvas">
                    <span><strong>{g.fullName}</strong> · {g.phone}</span>
                    <span className="text-brand-700">{labels.useExisting}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {guardianId ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <input type="hidden" name={`${prefix}guardianId`} value={guardianId} />
          <span><span className="text-muted">{labels.existing}: </span><strong>{chosen ? `${chosen.fullName} · ${chosen.phone}` : guardianId.slice(0, 8)}</strong></span>
          <button type="button" onClick={() => setChosen(null)} className="inline-flex min-h-9 items-center gap-1 text-brand-700"><X className="size-4" aria-hidden />{labels.clear}</button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name={`${prefix}fullName`} label={labels.fullName} required={req} />
          <Field name={`${prefix}phone`} label={labels.phone} type="tel" required={req} />
          <Field name={`${prefix}altPhone`} label={labels.altPhone} type="tel" optionalLabel={labels.optional} />
          <Field name={`${prefix}email`} label={labels.email} type="email" optionalLabel={labels.optional} />
          <Field name={`${prefix}occupation`} label={labels.occupation} optionalLabel={labels.optional} />
          <IfConflict><Field name={`${prefix}allowSharedPhone`} type="checkbox" label={labels.sharedPhone} className="sm:col-span-2" /></IfConflict>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name={`${prefix}relationship`} label={labels.relationship} type="select" options={labels.relationships} placeholder={labels.select} required={req} />
        <div className="flex flex-col justify-end">
          <Field name={`${prefix}isFinanciallyResponsible`} type="checkbox" label={labels.financial} defaultValue={primary} />
          <Field name={`${prefix}receivesNotifications`} type="checkbox" label={labels.notify} defaultValue />
        </div>
      </div>
    </div>
  );
}
