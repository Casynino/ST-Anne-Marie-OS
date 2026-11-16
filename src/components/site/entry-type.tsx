"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Field } from "@/components/form";

type Kind = "NEW" | "TRANSFER";
const Ctx = createContext<{ kind: Kind; setKind: (k: Kind) => void }>({ kind: "NEW", setKind: () => undefined });

/** Holds whether the child is new to school or transferring, so the previous-school questions and transfer papers show only for a transfer. */
export function EntryTypeProvider({ defaultKind = "NEW", children }: { defaultKind?: Kind; children: ReactNode }) {
  const [kind, setKind] = useState<Kind>(defaultKind);
  return <Ctx.Provider value={{ kind, setKind }}>{children}</Ctx.Provider>;
}

export const useIsTransfer = () => useContext(Ctx).kind === "TRANSFER";

/** Shows its content only for a child who is transferring from another school (hidden fields are not sent). */
export function WhenTransfer({ children }: { children: ReactNode }) {
  return useIsTransfer() ? <>{children}</> : null;
}

/** Two clear choices: new to school, or transferring from another school. */
export function EntryTypeChoice({ labels }: { labels: { newTitle: string; newBody: string; transferTitle: string; transferBody: string; name: string } }) {
  const { kind, setKind } = useContext(Ctx);
  const option = (value: Kind, title: string, body: string) => (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 border border-line p-4 has-[:checked]:border-link has-[:checked]:bg-tint">
      <input type="radio" name="entryType" value={value} checked={kind === value} onChange={() => setKind(value)} className="mt-1 size-5 accent-brand-700" />
      <span><span className="block font-semibold text-heading">{title}</span><span className="block text-sm text-muted">{body}</span></span>
    </label>
  );
  return (
    <div role="radiogroup" aria-label={labels.name} className="grid gap-3 sm:grid-cols-2">
      {option("NEW", labels.newTitle, labels.newBody)}
      {option("TRANSFER", labels.transferTitle, labels.transferBody)}
    </div>
  );
}

export type PreviousSchoolLabels = { title: string; hintNew: string; hintTransfer: string; school: string; class: string; classHint: string; reason: string; reasonHint: string; admissionNo: string; optional: string };

/** Where the child studied before. Required for a transfer, together with the reason for changing school. */
export function PreviousSchoolSection({ box, legend, labels, d }: { box: string; legend: string; labels: PreviousSchoolLabels; d: { previousSchool?: string; previousClass?: string; transferReason?: string; previousAdmissionNo?: string } }) {
  const transfer = useIsTransfer();
  return (
    <fieldset className={box}>
      <legend className={legend}>{labels.title}</legend>
      <p className="text-sm text-muted">{transfer ? labels.hintTransfer : labels.hintNew}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="previousSchool" label={labels.school} defaultValue={d.previousSchool} required={transfer} optionalLabel={labels.optional} />
        <Field name="previousClass" label={labels.class} defaultValue={d.previousClass} required={transfer} optionalLabel={labels.optional} hint={labels.classHint} />
        {transfer && (
          <>
            <Field name="previousAdmissionNo" label={labels.admissionNo} defaultValue={d.previousAdmissionNo} optionalLabel={labels.optional} />
            <Field name="transferReason" label={labels.reason} type="textarea" defaultValue={d.transferReason} required hint={labels.reasonHint} className="sm:col-span-2" />
          </>
        )}
      </div>
    </fieldset>
  );
}
