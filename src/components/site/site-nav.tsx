"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

export type SiteLink = { href: string; label: string };

export function SiteHeader({
  name, initials, logoPath, links, applyLabel, applyHref, signInLabel, signInHref, menuLabel, closeLabel, skipLabel, languageSwitch,
}: {
  name: string; initials: string; logoPath?: string; links: SiteLink[]; applyLabel: string; applyHref: string; signInLabel: string; signInHref: string; menuLabel: string; closeLabel: string; skipLabel: string; languageSwitch: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-night/90 text-white backdrop-blur supports-[backdrop-filter]:bg-night/75">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded focus:bg-white focus:px-3 focus:py-2">{skipLabel}</a>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          {logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPath} alt="" className="size-11 shrink-0 rounded-full object-contain" width={44} height={44} />
          ) : (
            <span aria-hidden className="site-serif flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold tracking-wide text-night">{initials}</span>
          )}
          <span className="site-serif line-clamp-2 text-base font-semibold leading-tight text-white sm:text-lg">{name}</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? "page" : undefined} className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors ${isActive(l.href) ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10 hover:text-white"}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-3">
          <div className="hidden sm:block">{languageSwitch}</div>
          <Link href={signInHref} className="hidden min-h-11 items-center whitespace-nowrap rounded-full border border-white/25 px-4 text-sm font-semibold text-white hover:bg-white/10 sm:inline-flex">{signInLabel}</Link>
          <Link href={applyHref} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-signal px-4 text-sm font-semibold text-night hover:bg-signal-700">{applyLabel}</Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? closeLabel : menuLabel} className="inline-flex size-11 items-center justify-center rounded-full text-white hover:bg-white/10 lg:hidden">
            {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
        </div>
      </div>

      <div aria-hidden className="scroll-progress absolute inset-x-0 bottom-0 h-[2px] bg-signal" />
      {open && (
        <div id="site-menu" className="border-t border-white/10 bg-night px-4 pb-5 pt-2 lg:hidden">
          <nav aria-label="Mobile">
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={isActive(l.href) ? "page" : undefined} className={`flex min-h-12 items-center rounded-xl px-3 text-base font-medium ${isActive(l.href) ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10"}`}>{l.label}</Link>
                </li>
              ))}
              <li><Link href={signInHref} className="flex min-h-12 items-center rounded-xl px-3 text-base font-medium text-brand-100 hover:bg-white/10">{signInLabel}</Link></li>
            </ul>
          </nav>
          <div className="mt-3 sm:hidden">{languageSwitch}</div>
        </div>
      )}
    </header>
  );
}
