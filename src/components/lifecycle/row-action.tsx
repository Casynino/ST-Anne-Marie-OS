"use client";

import { useRef, type ReactNode } from "react";

/**
 * A button on a list row that opens a small pop-up with the form for that step (the form is passed in, so the same server action and the same
 * rules apply as on the student's own page). The pop-up is a native dialog: Escape and the Close button shut it.
 */
export function RowAction({ label, title, closeLabel, primary = false, children }: { label: string; title: string; closeLabel: string; primary?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`btn-sm inline-flex items-center font-medium ${primary ? "btn-primary" : "btn-secondary"}`}>{label}</button>
      <dialog ref={ref} className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/60">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={() => ref.current?.close()} className="text-sm text-link hover:underline">{closeLabel}</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-left [&_*]:whitespace-normal">{children}</div>
      </dialog>
    </>
  );
}
