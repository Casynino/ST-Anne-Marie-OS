"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The sign-in entry: just "Log in →" on the screen. Pressing it opens the form in a pop-up (a native dialog: Escape and a click outside close
 * it, focus goes to the first field, and a wrong password stays inside the pop-up so nothing is lost).
 */
export function LoginDialog({ trigger, title, closeLabel, children }: { trigger: string; title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="group inline-flex min-h-12 items-center gap-2 border-b-2 border-sun px-1 text-lg font-semibold text-white transition-colors hover:text-sun focus-visible:outline-offset-4">
        {trigger}<span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-white/15 bg-[#0c1812]/95 p-0 text-left text-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/.8)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="relative p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <div className="mt-4">{children}</div>
          <button type="button" onClick={() => ref.current?.close()} aria-label={closeLabel} className="absolute right-3 top-3 grid size-9 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"><X className="size-4" aria-hidden /></button>
        </div>
      </dialog>
    </>
  );
}
