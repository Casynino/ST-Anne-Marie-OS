"use client";

import { useRef, type ReactNode } from "react";

/**
 * A plain text action on a list row (no box) that opens a small pop-up with the form for that step (the form is passed in, so the same server action and the same
 * rules apply as on the student's own page). The pop-up is a native dialog: Escape and the Close button shut it.
 */
export function RowAction({ label, title, closeLabel, primary = false, link = false, wide = false, children }: { label: string; title: string; closeLabel: string; primary?: boolean; /** A plain text link instead of a button. */ link?: boolean; /** A wider pop-up (for a quick view). */ wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`inline-flex items-center px-1.5 text-[13px] hover:underline ${primary ? "font-semibold text-link" : "font-medium text-muted hover:text-link"}`}>{label}{link ? " →" : ""}</button>
      <dialog ref={ref} className={`m-auto ${wide ? "w-[min(42rem,calc(100vw-2rem))]" : "w-[min(34rem,calc(100vw-2rem))]"} rounded-xl border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/60`}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={() => ref.current?.close()} className="text-sm text-link hover:underline">{closeLabel}</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-left [&_*]:whitespace-normal">{children}</div>
      </dialog>
    </>
  );
}
