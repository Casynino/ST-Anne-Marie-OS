"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight, Menu, X } from "lucide-react";
import { NAV_ICONS, type NavGroup } from "./icons";

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Brand({ name, initials, logo, collapsed }: { name: string; subtitle?: string; initials: string; logo?: { src: string }; collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-lg py-1" aria-label={name}>
      {logo ? <Image src={logo.src} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full bg-white object-contain p-0.5" /> : <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-brand-800">{initials}</span>}
      {!collapsed && <span className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">{name}</span>}
    </Link>
  );
}

/**
 * The menu: the home items first, then each group with its icon and heading and its pages under a thin guide line. The page you are on is a
 * soft filled block with a yellow mark on the guide line; icons stay visible when the menu is collapsed.
 */
function Groups({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Only the most specific menu entry is "current" (Returning students sits under /students, but Students must not light up with it).
  const current = groups.flatMap((g) => g.items).filter((i) => isActive(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const link = (item: NavGroup["items"][number], nested: boolean) => {
    const Icon = NAV_ICONS[item.icon];
    const active = item.href === current;
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors ${collapsed ? "justify-center" : ""} ${active ? "bg-white/10 font-medium text-white" : "text-brand-100 hover:bg-white/5 hover:text-white"}`}
      >
        {active && <span aria-hidden className={`absolute inset-y-2 w-[3px] rounded-full bg-sun ${nested && !collapsed ? "-left-[9px]" : "left-0"}`} />}
        <Icon className={`size-4 shrink-0 ${active ? "text-sun" : "text-brand-300 group-hover:text-white"}`} aria-hidden />
        {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
        {!!item.badge && <span className={`ml-auto rounded-md bg-sun px-1.5 py-0.5 text-[11px] font-semibold leading-none text-brand-950 ${collapsed ? "absolute right-1 top-1 ml-0" : ""}`}>{item.badge}</span>}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="space-y-4">
      {groups.map((g) => {
        if (g.flat) return <ul key={g.label} className="space-y-0.5">{g.items.map((i) => <li key={i.href}>{link(i, false)}</li>)}</ul>;
        return (
          <div key={g.label}>
            {collapsed ? <div aria-hidden className="mx-3 mb-2 h-px bg-white/10" /> : (
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-brand-300">{g.label}</p>
            )}
            <ul className={collapsed ? "space-y-0.5" : "ml-3 space-y-0.5 border-l border-white/10 pl-2"}>
              {g.items.map((i) => <li key={i.href}>{link(i, true)}</li>)}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppSidebar({ groups, name, subtitle, initials, logo, collapsedInitially, labels, footer }: { groups: NavGroup[]; name: string; subtitle?: string; initials: string; logo?: { src: string }; collapsedInitially: boolean; labels: { collapse: string; expand: string }; footer?: { full: ReactNode; icon: ReactNode } }) {
  const [collapsed, setCollapsed] = useState(collapsedInitially);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sam_nav=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside className={`no-print sticky top-0 hidden h-dvh shrink-0 p-3 transition-[width] duration-200 lg:block ${collapsed ? "w-[5.25rem]" : "w-72"}`}>
      <div className="flex h-full flex-col rounded-[1.25rem] border border-white/10 bg-rail px-3 pb-3 pt-4 text-white shadow-[0_18px_48px_-20px_rgba(0,0,0,.65)]">
        <div className={`mb-5 flex items-center ${collapsed ? "flex-col gap-2" : "justify-between gap-2 px-1"}`}>
          <Brand name={name} initials={initials} logo={logo} collapsed={collapsed} />
          <button type="button" onClick={toggle} aria-label={collapsed ? labels.expand : labels.collapse} aria-pressed={collapsed} title={collapsed ? labels.expand : labels.collapse} className="grid size-7 shrink-0 place-items-center rounded-md text-brand-300 hover:bg-white/10 hover:text-white">
            {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5"><Groups groups={groups} collapsed={collapsed} /></div>
        {footer && <div className="mt-3 border-t border-white/10 pt-3">{collapsed ? footer.icon : footer.full}</div>}
      </div>
    </aside>
  );
}

export function MobileDrawer({ groups, name, subtitle, initials, logo, labels, footer }: { groups: NavGroup[]; name: string; subtitle?: string; initials: string; logo?: { src: string }; labels: { menu: string; close: string }; footer?: ReactNode }) {
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
        <div className={`absolute inset-y-0 left-0 flex w-72 max-w-[86vw] flex-col bg-rail p-4 text-white shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`} inert={!open}>
          <div className="mb-4 flex items-center justify-between"><Brand name={name} initials={initials} logo={logo} /><button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-white/10"><X className="size-5" aria-hidden /></button></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><Groups groups={groups} onNavigate={() => setOpen(false)} /></div>
          {footer && <div className="mt-3 border-t border-dashed border-white/15 pt-3">{footer}</div>}
        </div>
      </div>
    </>
  );
}
