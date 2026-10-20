"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type Item = { path: string; caption?: string };

/** Swipeable photo rail with a full-screen viewer (arrow keys, Esc, swipe). Renders nothing without photos. */
export function GalleryRail({ items, labels }: { items: Item[]; labels: { close: string; prev: string; next: string } }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const touchX = useRef(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % items.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + items.length) % items.length));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, items.length]);

  if (items.length === 0) return null;
  const go = (d: number) => setOpen((i) => (i === null ? i : (i + d + items.length) % items.length));
  const shapes = ["aspect-[4/5]", "aspect-[4/3]", "aspect-[3/4]", "aspect-[1/1]"];

  return (
    <>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 [scrollbar-width:thin]">
        {items.map((g, i) => (
          <li key={g.path} className="w-[78%] shrink-0 snap-center sm:w-[44%] lg:w-[30%]">
            <button type="button" onClick={() => setOpen(i)} className="group relative block w-full overflow-hidden rounded-3xl bg-night-2 text-left focus-visible:outline-offset-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.path} alt={g.caption ?? ""} loading="lazy" decoding="async" className={`${shapes[i % shapes.length]} w-full object-cover transition-transform duration-700 group-hover:scale-105`} />
              {g.caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/85 to-transparent p-4 text-sm font-medium text-white">{g.caption}</span>}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        onClick={(e) => e.target === dialog.current && setOpen(null)}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? 0)}
        onTouchEnd={(e) => { const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}
        className="m-0 size-full max-h-none max-w-none bg-night/95 p-0 backdrop:bg-night"
      >
        {open !== null && items[open] && (
          <div className="relative flex size-full items-center justify-center p-4 sm:p-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={items[open]!.path} alt={items[open]!.caption ?? ""} className="max-h-full max-w-full rounded-2xl object-contain" />
            {items[open]!.caption && <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white sm:bottom-8">{items[open]!.caption}</p>}
            <button type="button" onClick={() => setOpen(null)} aria-label={labels.close} className="absolute right-3 top-3 inline-flex size-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-6 sm:top-6"><X className="size-6" aria-hidden /></button>
            {items.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label={labels.prev} className="absolute left-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-6"><ChevronLeft className="size-6" aria-hidden /></button>
                <button type="button" onClick={() => go(1)} aria-label={labels.next} className="absolute right-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-6"><ChevronRight className="size-6" aria-hidden /></button>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
