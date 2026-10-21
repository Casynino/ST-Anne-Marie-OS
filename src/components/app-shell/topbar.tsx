"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, ChevronRight, Globe, KeyRound, Search } from "lucide-react";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path-based breadcrumbs. Known segments get translated labels; record ids become the "details" label. */
export function Breadcrumbs({ labels, detailsLabel, homeLabel }: { labels: Record<string, string>; detailsLabel: string; homeLabel: string }) {
  const segments = (usePathname() ?? "").split("/").filter(Boolean);
  if (segments.length < 2) return null; // top-level pages already show their title
  const crumbs = segments.map((seg, i) => ({ href: `/${segments.slice(0, i + 1).join("/")}`, label: UUID.test(seg) ? detailsLabel : (labels[seg] ?? seg.replace(/-/g, " ")) }));
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1 text-sm text-muted">
        <li><Link href="/dashboard" className="hover:text-ink hover:underline">{homeLabel}</Link></li>
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex min-w-0 items-center gap-1"><ChevronRight className="size-3.5 shrink-0" aria-hidden />{i === crumbs.length - 1 ? <span aria-current="page" className="truncate font-medium text-ink">{c.label}</span> : <Link href={c.href} className="truncate hover:text-ink hover:underline">{c.label}</Link>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function GlobalSearch({ action, placeholder, label }: { action: string; placeholder: string; label: string }) {
  return (
    <form action={action} method="get" role="search" className="hidden min-w-0 flex-1 md:block md:max-w-sm">
      <label className="sr-only" htmlFor="global-search">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input id="global-search" name="q" type="search" placeholder={placeholder} className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-4 text-sm placeholder:text-muted/80 focus:border-brand-500 focus:bg-surface" />
      </div>
    </form>
  );
}

/** Opens the public website in a new tab, so staff keep their place in the system. */
export function WebsiteLink({ label }: { label: string }) {
  return (
    <Link href="/" target="_blank" rel="noopener" aria-label={label} title={label} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-ink hover:bg-canvas">
      <Globe className="size-5" aria-hidden /><span className="hidden lg:inline">{label}</span>
    </Link>
  );
}

export function NotificationBell({ count, label }: { count: number; label: string }) {
  return (
    <Link href="/notifications" aria-label={`${label}${count ? ` (${count})` : ""}`} className="relative inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-canvas">
      <Bell className="size-5" aria-hidden />
      {count > 0 && <span className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-bad px-1 text-center text-[11px] font-bold leading-5 text-white">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}

/** Account menu: name, role, change password, language, sign out (the language/sign-out controls are server-rendered children). */
export function UserMenu({ name, initials, role, passwordLabel, children }: { name: string; initials: string; role?: string; passwordLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex min-h-11 items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-canvas">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">{initials}</span>
        <span className="hidden text-left leading-tight sm:block"><span className="block max-w-[10rem] truncate text-sm font-semibold">{name}</span>{role && <span className="block max-w-[10rem] truncate text-xs text-muted">{role}</span>}</span>
        <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-[var(--shadow-lift)]">
          <div className="border-b border-line px-3 pb-2 pt-1"><p className="truncate font-semibold">{name}</p>{role && <p className="truncate text-sm text-muted">{role}</p>}</div>
          <Link role="menuitem" href="/change-password" className="mt-1 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-canvas"><KeyRound className="size-4" aria-hidden />{passwordLabel}</Link>
          <div className="space-y-1 border-t border-line pt-2">{children}</div>
        </div>
      )}
    </div>
  );
}
