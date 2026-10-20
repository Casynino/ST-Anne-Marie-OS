"use client";

import { Field, IfConflict, inputClass } from "@/components/form";

/** Confirmation checkboxes appear only after the server asked for them (possible duplicate / shared phone). */
export function ConfirmBoxes({ duplicate, sharedPhone }: { duplicate: string; sharedPhone: string }) {
  return (
    <IfConflict>
      <Field name="confirmDuplicate" type="checkbox" label={duplicate} />
      <Field name="confirmSharedPhone" type="checkbox" label={sharedPhone} />
    </IfConflict>
  );
}

export function FileInput({ label, hint }: { label: string; hint: string }) {
  return (
    <div>
      <label htmlFor="doc-file" className="mb-1 block text-sm font-medium">{label}</label>
      <input id="doc-file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link`} />
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
}
