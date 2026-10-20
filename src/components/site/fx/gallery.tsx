"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SiteImage } from "@/server/website";

/**
 * Class names that make `n` photos exactly fill rows of four cells (desktop). A feature tile (2×2) adds three cells,
 * a wide tile adds one; whatever is left over after rounding up to a full row is absorbed that way.
 */
export function mosaicSpans(n: number): string[] {
  const spans: string[] = Array(n).fill("");
  if (n === 1) return ["sm:col-span-4"];
  let extra = Math.ceil(n / 4) * 4 - n;
  if (extra >= 3 && n >= 4) { spans[0] = "sm:col-span-2 sm:row-span-2"; extra -= 3; }
  const start = spans[0] ? 1 : 0;
  const step = extra > 0 ? Math.max(1, Math.min(3, Math.floor((n - start) / extra))) : 1;
  for (let i = start; extra > 0 && i < n; i += step) { spans[i] = "sm:col-span-2"; extra -= 1; }
  return spans;
}

/**
 * Editorial photo mosaic with an accessible full-screen viewer (native <dialog>: focus is trapped, Esc closes,
 * arrow keys and swipe move between photos). Renders nothing when the school has not supplied photographs.
 */
export function Gallery({ items, labels }: { items: SiteImage[]; labels: { close: string; prev: string; next: string; open: string } }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
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
  // Mosaic that always fills its 4-column rows: the number of photos decides which tiles are enlarged.
  const shown = items.slice(0, 12);
  const spans = mosaicSpans(shown.length);
  const current = open !== null ? items[open] : undefined;

  return (
    <>
      <ul className="grid auto-rows-[9.5rem] grid-cols-2 gap-3 sm:auto-rows-[11rem] sm:grid-cols-4">
        {shown.map((g, i) => (
          <li key={g.src} className={`${spans[i] ?? ""} ${shown.length % 2 === 1 && i === shown.length - 1 ? "max-sm:col-span-2" : ""}`}>
            <button
              type="button"
              onClick={(e) => { trigger.current = e.currentTarget; setOpen(i); }}
              aria-label={`${labels.open}${g.alt ? `: ${g.alt}` : ""}`}
              className="frame group block size-full rounded-2xl text-left"
            >
              <Image src={g.src} alt={g.alt} width={g.width} height={g.height} sizes="(min-width: 640px) 25vw, 50vw" loading="lazy" className="size-full object-cover" />
              {g.caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-950/80 to-transparent p-3 text-sm font-medium text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">{g.caption}</span>}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        onClose={() => { setOpen(null); trigger.current?.focus(); }}
        onClick={(e) => e.target === dialog.current && setOpen(null)}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? 0)}
        onTouchEnd={(e) => { const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}
        aria-label={current?.alt || labels.open}
        className="m-0 size-full max-h-none max-w-none bg-canvas/95 p-0 backdrop:bg-canvas"
      >
        {current && (
          <div className="relative flex size-full flex-col items-center justify-center p-4 sm:p-10">
            <Image src={current.src} alt={current.alt} width={current.width} height={current.height} sizes="100vw" className="max-h-[82dvh] w-auto max-w-full rounded-xl object-contain" />
            {current.caption && <p className="mt-4 text-center text-sm text-white">{current.caption}</p>}
            <button type="button" onClick={() => setOpen(null)} aria-label={labels.close} className="absolute right-3 top-3 inline-flex size-12 items-center justify-center rounded-full bg-surface/10 text-white hover:bg-surface/20 sm:right-6 sm:top-6"><X className="size-6" aria-hidden /></button>
            {items.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label={labels.prev} className="absolute left-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-surface/10 text-white hover:bg-surface/20 sm:left-6"><ChevronLeft className="size-6" aria-hidden /></button>
                <button type="button" onClick={() => go(1)} aria-label={labels.next} className="absolute right-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-surface/10 text-white hover:bg-surface/20 sm:right-6"><ChevronRight className="size-6" aria-hidden /></button>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
