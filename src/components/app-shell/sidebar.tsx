"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight, Menu, X } from "lucide-react";
import { NAV_ICONS, type NavGroup } from "./icons";

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Brand({ name, initials, logo, collapsed }: { name: string; initials: string; logo?: { src: string }; collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 rounded-xl px-1 py-1" aria-label={name}>
      {logo ? <Image src={logo.src} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-white object-contain p-0.5" /> : <span aria-hidden className="display flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-brand-800">{initials}</span>}
      {!collapsed && <span className="display line-clamp-2 text-base font-semibold leading-tight text-white">{name}</span>}
    </Link>
  );
}

function Groups({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          {!collapsed ? <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-300">{g.label}</p> : <div aria-hidden className="mx-3 mb-2 h-px bg-white/10" />}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${collapsed ? "justify-center" : ""} ${active ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10 hover:text-white"}`}
                  >
                    {active && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-sun" />}
                    <Icon className="size-5 shrink-0" aria-hidden />
                    {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                    {!!item.badge && <span className={`ml-auto rounded-md bg-sun px-2 py-0.5 text-[11px] font-bold text-brand-950 ${collapsed ? "absolute right-1 top-1 ml-0 px-1.5" : ""}`}>{item.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar({ groups, name, initials, logo, collapsedInitially, labels }: { groups: NavGroup[]; name: string; initials: string; logo?: { src: string }; collapsedInitially: boolean; labels: { collapse: string; expand: string } }) {
  const [collapsed, setCollapsed] = useState(collapsedInitially);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sam_nav=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside className={`no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-brand-950 p-3 text-white transition-[width] duration-200 lg:flex ${collapsed ? "w-[4.75rem]" : "w-64"}`}>
      <div className={`mb-5 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}><Brand name={name} initials={initials} logo={logo} collapsed={collapsed} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5"><Groups groups={groups} collapsed={collapsed} /></div>
      <button type="button" onClick={toggle} aria-label={collapsed ? labels.expand : labels.collapse} aria-pressed={collapsed} className={`mt-3 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-brand-100 hover:bg-white/10 hover:text-white ${collapsed ? "justify-center" : ""}`}>
        {collapsed ? <ChevronsRight className="size-5" aria-hidden /> : <><ChevronsLeft className="size-5" aria-hidden />{labels.collapse}</>}
      </button>
    </aside>
  );
}

export function MobileDrawer({ groups, name, initials, logo, labels, footer }: { groups: NavGroup[]; name: string; initials: string; logo?: { src: string }; labels: { menu: string; close: string }; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={labels.menu} aria-expanded={open} className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-canvas lg:hidden"><Menu className="size-6" aria-hidden /></button>
      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} role="dialog" aria-modal="true" aria-label={labels.menu} aria-hidden={!open}>
        <button type="button" tabIndex={open ? 0 : -1} aria-label={labels.close} className={`absolute inset-0 bg-black/45 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} onClick={() => setOpen(false)} />
        <div className={`absolute inset-y-0 left-0 flex w-72 max-w-[86vw] flex-col bg-brand-950 p-4 text-white shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`} inert={!open}>
          <div className="mb-4 flex items-center justify-between"><Brand name={name} initials={initials} logo={logo} /><button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-white/10"><X className="size-5" aria-hidden /></button></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><Groups groups={groups} onNavigate={() => setOpen(false)} /></div>
          {footer && <div className="mt-3 border-t border-white/10 pt-3">{footer}</div>}
        </div>
      </div>
    </>
  );
}
