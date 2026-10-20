"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { SiteImage } from "@/server/website";

export type SiteLink = { href: string; label: string; match?: string[] };

export function SiteHeader({
  name, initials, logo, links, applyLabel, applyShortLabel, applyHref, portalLabel, portalHref, menuLabel, closeLabel, skipLabel, languageSwitch,
}: {
  name: string; initials: string; logo?: SiteImage; links: SiteLink[]; applyLabel: string; applyShortLabel: string; applyHref: string; portalLabel: string; portalHref: string; menuLabel: string; closeLabel: string; skipLabel: string; languageSwitch: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setScrolled(window.scrollY > 12)); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (l: SiteLink) => {
    const roots = [l.href, ...(l.match ?? [])];
    return roots.some((r) => (r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(`${r}/`)));
  };

  return (
    <header className="site-header sticky top-0 z-40 border-b border-ink/25 bg-cream transition-colors duration-300" data-scrolled={scrolled}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-white focus:px-3 focus:py-2">{skipLabel}</a>
      <div className="mx-auto flex h-16 max-w-[100rem] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3" aria-label={name}>
          {logo ? (
            <Image src={logo.src} alt="" width={40} height={40} priority className="size-10 shrink-0 object-contain" />
          ) : (
            <span aria-hidden className="display flex size-10 shrink-0 items-center justify-center border border-ink text-[15px] font-semibold tracking-wide text-ink">{initials}</span>
          )}
          <span className="display max-w-[8.5rem] text-[1.02rem] font-semibold leading-[1.05] text-ink min-[400px]:max-w-[12rem] sm:max-w-[16rem] sm:text-[1.3rem]">{name}</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-stretch gap-6 self-stretch xl:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`flex items-center whitespace-nowrap border-y-2 border-transparent text-[15px] font-semibold transition-colors ${isActive(l) ? "border-b-ink text-ink" : "text-ink/70 hover:text-ink"}`}>{l.label}</Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3 xl:ml-2">
          <div className="hidden md:block">{languageSwitch}</div>
          <Link href={portalHref} className="hidden whitespace-nowrap text-[15px] font-semibold text-ink underline decoration-1 underline-offset-[5px] hover:decoration-2 lg:inline">{portalLabel}</Link>
          <Link href={applyHref} className="inline-flex min-h-11 items-center whitespace-nowrap bg-ink px-4 text-sm font-semibold text-cream transition-colors hover:bg-brand-800 sm:px-5"><span className="sm:hidden">{applyShortLabel}</span><span className="hidden sm:inline">{applyLabel}</span></Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? closeLabel : menuLabel} className="inline-flex min-h-11 items-center gap-2 px-1 text-sm font-semibold uppercase tracking-[.14em] text-ink xl:hidden">
            <span className="hidden min-[430px]:inline">{open ? closeLabel : menuLabel}</span>
            <span aria-hidden className="relative block h-3 w-5"><span className={`absolute inset-x-0 h-px bg-ink transition-transform ${open ? "top-1.5 rotate-45" : "top-0"}`} /><span className={`absolute inset-x-0 top-1.5 h-px bg-ink transition-opacity ${open ? "opacity-0" : ""}`} /><span className={`absolute inset-x-0 h-px bg-ink transition-transform ${open ? "top-1.5 -rotate-45" : "top-3"}`} /></span>
          </button>
        </div>
      </div>

      <div id="site-menu" className={`grid overflow-hidden bg-cream transition-[grid-template-rows,opacity] duration-300 ease-out xl:hidden ${open ? "grid-rows-[1fr] border-t border-ink/25 opacity-100" : "grid-rows-[0fr] opacity-0"}`} inert={!open}>
        <div className="min-h-0">
          <nav aria-label="Mobile" className="mx-auto max-w-[100rem] px-4 pb-8 pt-2 sm:px-6">
            <ol className="divide-y divide-ink/15">
              {links.map((l, i) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={isActive(l) ? "page" : undefined} className="flex min-h-14 items-baseline gap-4 py-3">
                    <span aria-hidden className="w-6 text-sm tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span className={`display text-3xl ${isActive(l) ? "text-brand-700" : "text-ink"}`}>{l.label}</span>
                  </Link>
                </li>
              ))}
              <li><Link href={portalHref} className="flex min-h-14 items-baseline gap-4 py-3"><span aria-hidden className="w-6 text-sm text-muted">→</span><span className="display text-3xl text-ink underline decoration-1 underline-offset-4">{portalLabel}</span></Link></li>
            </ol>
            <div className="mt-5 md:hidden">{languageSwitch}</div>
          </nav>
        </div>
      </div>
    </header>
  );
}
