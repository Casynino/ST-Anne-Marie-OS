"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
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
  const panel = useRef<HTMLDivElement>(null);

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
    <header className="site-header sticky top-0 z-40 bg-cream transition-[background-color,box-shadow] duration-300" data-scrolled={scrolled}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">{skipLabel}</a>
      <div className="mx-auto flex h-[4.25rem] max-w-[84rem] items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label={name}>
          {logo ? (
            <Image src={logo.src} alt="" width={44} height={44} priority className="size-11 shrink-0 rounded-full object-contain" />
          ) : (
            <span aria-hidden className="display flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold tracking-wide text-white">{initials}</span>
          )}
          <span className="display max-w-[6.5rem] text-[0.95rem] font-semibold leading-tight text-brand-900 min-[400px]:max-w-[9rem] sm:max-w-[13rem] sm:text-lg">{name}</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-0.5 xl:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`relative whitespace-nowrap rounded-full px-2.5 py-2 text-sm font-semibold transition-colors ${isActive(l) ? "text-brand-800" : "text-ink/75 hover:text-brand-800"}`}>
              {l.label}
              <span aria-hidden className={`absolute inset-x-2.5 -bottom-0.5 h-[3px] origin-left rounded-full bg-sun transition-transform duration-300 ${isActive(l) ? "scale-x-100" : "scale-x-0"}`} />
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:ml-3">
          <div className="hidden md:block">{languageSwitch}</div>
          <Link href={portalHref} className="hidden min-h-11 items-center whitespace-nowrap rounded-full border-2 border-brand-700 px-4 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-700 hover:text-white lg:inline-flex">{portalLabel}</Link>
          <Link href={applyHref} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-brand-700 px-4 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgb(2_106_67/.7)] transition-colors hover:bg-brand-800"><span className="sm:hidden">{applyShortLabel}</span><span className="hidden sm:inline">{applyLabel}</span></Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? closeLabel : menuLabel} className="inline-flex size-11 items-center justify-center rounded-full text-brand-900 transition-colors hover:bg-brand-100 xl:hidden">
            {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
        </div>
      </div>

      <div id="site-menu" ref={panel} className={`grid overflow-hidden bg-cream transition-[grid-template-rows,opacity] duration-300 ease-out xl:hidden ${open ? "grid-rows-[1fr] border-t border-line opacity-100" : "grid-rows-[0fr] opacity-0"}`} inert={!open}>
        <div className="min-h-0">
          <nav aria-label="Mobile" className="mx-auto max-w-6xl px-4 pb-6 pt-3 sm:px-6">
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`flex min-h-12 items-center rounded-xl px-3 text-lg font-semibold ${isActive(l) ? "bg-brand-50 text-brand-800" : "text-ink hover:bg-brand-50"}`}>{l.label}</Link>
                </li>
              ))}
              <li><Link href={portalHref} className="flex min-h-12 items-center rounded-xl px-3 text-lg font-semibold text-brand-800 hover:bg-brand-50">{portalLabel}</Link></li>
            </ul>
            <div className="mt-3 md:hidden">{languageSwitch}</div>
          </nav>
        </div>
      </div>
      <span aria-hidden className="sr-only">{menuLabel}</span>
    </header>
  );
}
