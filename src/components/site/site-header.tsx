"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Search } from "lucide-react";
import type { SiteImage } from "@/server/website";

export type SiteSubLink = { href: string; label: string };
export type SiteLink = { href: string; label: string; match?: string[]; items?: SiteSubLink[] };

/**
 * The school's header in two tiers: the identity row (emblem, name, motto; calendar, quick links, search, language, portal, apply) and
 * a deep-green navigation bar with drop-down menus that stays at the top while scrolling. On phones both collapse into one bar and a
 * full-screen menu. Menu entries come from the school's own content, so no link leads to an empty page.
 */
export function SiteHeader({
  name, initials, motto, logo, links, quickLinks, quickLabel, searchLabel, calendarLabel, applyLabel, applyShortLabel, applyHref, portalLabel, portalHref, signedIn, menuLabel, closeLabel, skipLabel, languageSwitch, topSlot,
}: {
  name: string; initials: string; motto?: string | null; logo?: SiteImage; links: SiteLink[]; quickLinks: SiteSubLink[]; quickLabel: string; searchLabel: string; calendarLabel: string; applyLabel: string; applyShortLabel: string; applyHref: string; portalLabel: string; portalHref: string; signedIn?: boolean; menuLabel: string; closeLabel: string; skipLabel: string; languageSwitch: ReactNode; topSlot?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setScrolled(window.scrollY > 140)); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    if (!open) return;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => { document.documentElement.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [open]);

  const isActive = (l: SiteLink) => {
    const roots = [l.href, ...(l.match ?? [])];
    return roots.some((r) => (r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(`${r}/`)));
  };
  const mark = logo ? (
    <Image src={logo.src} alt="" width={64} height={64} priority className="size-12 shrink-0 object-contain xl:size-16" />
  ) : (
    <span aria-hidden className="display flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold tracking-wide text-white xl:size-16 xl:text-base">{initials}</span>
  );

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-sun focus:px-4 focus:py-2 focus:text-[#10200f]">{skipLabel}</a>
      {topSlot}

      {/* Identity row: sticky on phones, scrolls away on larger screens (the navigation bar below stays) */}
      <div className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md xl:static">
        <div className="mx-auto flex h-[4.25rem] max-w-[100rem] items-center gap-4 px-4 sm:px-8 xl:h-28">
          <Link href="/" className="flex min-w-0 items-center gap-3.5" aria-label={name}>
            {mark}
            <span className="min-w-0 leading-tight">
              <span className="display block truncate text-[1.05rem] font-bold text-heading sm:text-xl xl:text-[1.7rem]">{name}</span>
              {motto && <span className="hidden text-sm font-medium tracking-wide text-muted sm:block xl:text-[15px]">{motto}</span>}
            </span>
          </Link>

          {/* Plain and clear: links are text, the only filled control is Apply online (a rectangle). Every control is 44px high. */}
          <div className="ml-auto hidden items-center gap-1.5 xl:flex">
            <Link href="/calendar" className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-[15px] font-semibold text-link transition-colors hover:bg-tint"><CalendarDays className="size-[18px]" aria-hidden />{calendarLabel}</Link>
            <div className="group relative">
              <button type="button" className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-[15px] font-semibold text-link transition-colors hover:bg-tint">{quickLabel}<ChevronDown className="size-4 transition-transform group-focus-within:rotate-180 group-hover:rotate-180" aria-hidden /></button>
              <div className="invisible absolute right-0 top-full z-50 w-64 pt-2 opacity-0 transition-[opacity,visibility] duration-200 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                <ul className="rounded-md border-t-4 border-sun bg-surface p-2 shadow-[var(--shadow-lift)]">
                  {quickLinks.map((q) => <li key={q.href}><Link href={q.href} className="flex min-h-11 items-center rounded px-3 text-[15px] font-semibold text-brand-900 transition-colors hover:bg-tint">{q.label}</Link></li>)}
                </ul>
              </div>
            </div>
            <Link href="/search" aria-label={searchLabel} title={searchLabel} className="inline-flex size-11 items-center justify-center rounded-md text-link transition-colors hover:bg-tint"><Search className="size-[18px]" aria-hidden /></Link>
            <div className="ml-1">{languageSwitch}</div>
            <span aria-hidden className="mx-2 h-6 w-px bg-line" />
            <Link href={portalHref} className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 text-[15px] font-semibold text-link transition-colors hover:bg-tint">
              <span className="max-w-[11rem] truncate">{portalLabel}</span>
            </Link>
            <Link href={applyHref} className="inline-flex h-11 items-center whitespace-nowrap rounded-md bg-sun px-5 text-[15px] font-semibold text-[#10200f] transition-colors hover:bg-sun-600">{applyLabel}</Link>
          </div>

          <div className="ml-auto flex items-center gap-2 xl:hidden">
            <Link href={applyHref} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md bg-sun px-4 text-sm font-bold text-[#10200f]"><span className="sm:hidden">{applyShortLabel}</span><span className="hidden sm:inline">{applyLabel}</span></Link>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? closeLabel : menuLabel} className="inline-flex size-11 items-center justify-center rounded-md bg-brand-800 text-white">
              <span aria-hidden className="relative block h-3 w-5"><span className={`absolute inset-x-0 h-0.5 rounded bg-current transition-transform duration-300 ${open ? "top-1 rotate-45" : "top-0"}`} /><span className={`absolute inset-x-0 top-1 h-0.5 rounded bg-current transition-opacity ${open ? "opacity-0" : ""}`} /><span className={`absolute inset-x-0 h-0.5 rounded bg-current transition-transform duration-300 ${open ? "top-1 -rotate-45" : "top-2"}`} /></span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation bar (larger screens): stays at the top while scrolling */}
      <div className="sticky top-0 z-40 hidden bg-brand-800 shadow-[0_6px_18px_-10px_rgb(0_0_0/.5)] xl:block">
        <nav aria-label="Main" className="mx-auto flex h-14 max-w-[100rem] items-center px-8">
          <Link href="/" aria-label={name} className={`shrink-0 overflow-hidden transition-[width,opacity,margin] duration-300 ${scrolled ? "mr-4 w-10 opacity-100" : "mr-0 w-0 opacity-0"}`} tabIndex={scrolled ? 0 : -1}>
            {logo ? <Image src={logo.src} alt="" width={40} height={40} className="size-10 rounded-full bg-white object-contain" /> : <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white text-xs font-bold text-link">{initials}</span>}
          </Link>
          <div className="flex flex-1 items-stretch justify-between self-stretch">
            {links.map((l) => {
              const active = isActive(l);
              const link = (
                <Link href={l.href} aria-current={active ? "page" : undefined} className={`relative inline-flex h-full items-center gap-1.5 px-4 text-[13px] font-bold uppercase tracking-[.1em] transition-colors ${active ? "text-sun" : "text-white hover:text-sun"}`}>
                  {l.label}
                  {l.items && l.items.length > 1 && <ChevronDown className="size-3.5 opacity-70 transition-transform duration-300 group-focus-within:rotate-180 group-hover:rotate-180" aria-hidden />}
                  <span aria-hidden className={`absolute inset-x-4 bottom-0 h-[3px] origin-left bg-sun transition-transform duration-300 ${active ? "scale-x-100" : "scale-x-0"}`} />
                </Link>
              );
              if (!l.items || l.items.length <= 1) return <div key={l.href} className="flex">{link}</div>; // one entry would only repeat the parent link
              return (
                <div key={l.href} className="group relative flex">
                  {link}
                  <div className="invisible absolute left-0 top-full z-50 w-72 opacity-0 transition-[opacity,visibility] duration-200 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    <ul className="border-t-4 border-sun bg-surface p-2 shadow-[var(--shadow-lift)]">
                      {l.items.map((i) => <li key={i.href}><Link href={i.href} className="flex min-h-11 items-center rounded px-3 text-[15px] font-semibold text-brand-900 transition-colors hover:bg-tint">{i.label}</Link></li>)}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Phone menu */}
      <div id="site-menu" className={`fixed inset-x-0 bottom-0 top-[4.25rem] z-30 overflow-y-auto bg-canvas transition-[opacity,visibility] duration-300 xl:hidden ${open ? "visible opacity-100" : "invisible opacity-0"}`} inert={!open}>
        <nav aria-label="Mobile" className="mx-auto max-w-3xl px-4 pb-16 pt-2 sm:px-8">
          <ul>
            {links.map((l) => (
              <li key={l.href} className="border-b border-line py-3">
                <Link href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`flex min-h-11 items-center text-xl font-bold ${isActive(l) ? "text-link" : "text-heading"}`}>{l.label}</Link>
                {l.items && l.items.length > 1 && <ul className="mb-1 flex flex-wrap gap-x-5 gap-y-0.5 pl-1">{l.items.map((i) => <li key={i.href}><Link href={i.href} className="inline-flex min-h-10 items-center text-[15px] font-medium text-muted hover:text-link">{i.label}</Link></li>)}</ul>}
              </li>
            ))}
            {[{ href: "/calendar", label: calendarLabel }, { href: "/search", label: searchLabel }, { href: portalHref, label: portalLabel }].map((q) => <li key={q.href} className="border-b border-line"><Link href={q.href} className="flex min-h-14 items-center text-lg font-bold text-link">{q.label}</Link></li>)}
          </ul>
          <div className="mt-6">{languageSwitch}</div>
        </nav>
      </div>
    </>
  );
}
