"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { SiteImage } from "@/server/website";

export type SiteLink = { href: string; label: string; match?: string[] };

export function SiteHeader({
  name, initials, logo, links, applyLabel, applyShortLabel, applyHref, portalLabel, portalHref, menuLabel, closeLabel, skipLabel, languageSwitch, topSlot,
}: {
  name: string; initials: string; logo?: SiteImage; links: SiteLink[]; applyLabel: string; applyShortLabel: string; applyHref: string; portalLabel: string; portalHref: string; menuLabel: string; closeLabel: string; skipLabel: string; languageSwitch: ReactNode; topSlot?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setScrolled(window.scrollY > 24)); };
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
  const solid = scrolled || open;

  return (
    <header className="site-header fixed inset-x-0 top-0 z-40 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-500" data-solid={solid}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-sun focus:px-4 focus:py-2 focus:text-[#10200f]">{skipLabel}</a>
      {topSlot && <div className={`grid transition-[grid-template-rows,opacity] duration-500 ${scrolled || open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}><div className="min-h-0 overflow-hidden">{topSlot}</div></div>}
      <div className="mx-auto flex h-[4.5rem] max-w-[100rem] items-center gap-4 px-4 sm:px-8">
        <Link href="/" className="relative z-10 flex min-w-0 shrink-0 items-center gap-3" aria-label={name}>
          {logo ? (
            <Image src={logo.src} alt="" width={44} height={44} priority className="size-11 shrink-0 rounded-full bg-white/95 object-contain p-0.5" />
          ) : (
            <span aria-hidden className="display flex size-11 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-[15px] font-semibold tracking-wide text-white">{initials}</span>
          )}
          <span className="display max-w-[8.5rem] text-[1.15rem] font-semibold leading-[1] text-white min-[400px]:max-w-[12rem] sm:max-w-[18rem] sm:text-[1.5rem]">{name}</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 xl:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`relative whitespace-nowrap rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors ${isActive(l) ? "text-sun" : "text-white/75 hover:text-white"}`}>
              {l.label}
              <span aria-hidden className={`absolute inset-x-3.5 bottom-0.5 h-px origin-left bg-sun transition-transform duration-500 ${isActive(l) ? "scale-x-100" : "scale-x-0"}`} />
            </Link>
          ))}
        </nav>

        <div className="relative z-10 ml-auto flex items-center gap-2 sm:gap-3 xl:ml-3">
          <div className="hidden md:block">{languageSwitch}</div>
          <Link href={portalHref} className="hidden whitespace-nowrap rounded-full border border-white/25 px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-white/10 lg:inline-flex">{portalLabel}</Link>
          <Link href={applyHref} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-sun px-5 text-sm font-semibold text-[#10200f] transition-colors hover:bg-sun-600"><span className="sm:hidden">{applyShortLabel}</span><span className="hidden sm:inline">{applyLabel}</span></Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? closeLabel : menuLabel} className="glass inline-flex size-11 items-center justify-center rounded-full text-white xl:hidden">
            <span aria-hidden className="relative block h-3 w-5"><span className={`absolute inset-x-0 h-px bg-current transition-transform duration-300 ${open ? "top-1.5 rotate-45" : "top-0"}`} /><span className={`absolute inset-x-0 top-1.5 h-px bg-current transition-opacity ${open ? "opacity-0" : ""}`} /><span className={`absolute inset-x-0 h-px bg-current transition-transform duration-300 ${open ? "top-1.5 -rotate-45" : "top-3"}`} /></span>
          </button>
        </div>
      </div>

      <div id="site-menu" className={`fixed inset-x-0 bottom-0 top-[4.5rem] overflow-y-auto bg-[#07100b]/97 transition-[opacity,visibility] duration-500 xl:hidden ${open ? "visible opacity-100" : "invisible opacity-0"}`} inert={!open}>
        <nav aria-label="Mobile" className="mx-auto max-w-[100rem] px-4 pb-16 pt-6 sm:px-8">
          <ol>
            {links.map((l, i) => (
              <li key={l.href} className="border-b border-white/10" style={{ transitionDelay: open ? `${i * 55}ms` : "0ms" }}>
                <Link href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`flex min-h-16 items-baseline gap-5 py-3 transition-[transform,opacity] duration-500 ${open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} style={{ transitionDelay: open ? `${i * 55 + 120}ms` : "0ms" }}>
                  <span aria-hidden className="w-7 text-sm tabular-nums text-sun">{String(i + 1).padStart(2, "0")}</span>
                  <span className={`display text-[2.4rem] ${isActive(l) ? "text-sun" : "text-white"}`}>{l.label}</span>
                </Link>
              </li>
            ))}
            <li><Link href={portalHref} className="flex min-h-16 items-baseline gap-5 py-3"><span aria-hidden className="w-7 text-sm text-sun">→</span><span className="display text-[2.4rem] text-white underline decoration-1 underline-offset-8">{portalLabel}</span></Link></li>
          </ol>
          <div className="mt-8 md:hidden">{languageSwitch}</div>
        </nav>
      </div>
    </header>
  );
}
