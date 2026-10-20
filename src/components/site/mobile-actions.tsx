"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";

/** Two big thumb-reach actions on phones, shown once the visitor has scrolled past the first screen. Hidden from tablets up. */
export function MobileActions({ applyHref, applyLabel, phoneHref, callLabel }: { applyHref: string; applyLabel: string; phoneHref?: string; callLabel: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setShow(window.scrollY > 520)); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div aria-hidden={!show} inert={!show} className={`fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 transition-[transform,opacity] duration-300 md:hidden ${show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"}`}>
      <div className="mx-auto flex max-w-md gap-2 rounded-full bg-brand-950/95 p-1.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/.55)] backdrop-blur">
        <Link href={applyHref} className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-sun px-4 text-[15px] font-bold text-brand-950 active:scale-[.98]">{applyLabel}</Link>
        {phoneHref && <a href={phoneHref} aria-label={callLabel} className="flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold text-white active:scale-[.98]"><Phone className="size-4" aria-hidden />{callLabel}</a>}
      </div>
    </div>
  );
}
