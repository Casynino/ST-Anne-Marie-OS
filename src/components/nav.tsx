"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, BookOpen, ClipboardCheck, GraduationCap, LayoutDashboard, Menu, ScrollText, Settings, ShieldCheck, UserCog, UserPlus, Users, X } from "lucide-react";

const ICONS = { dashboard: LayoutDashboard, attendance: ClipboardCheck, admissions: UserPlus, notifications: Bell, students: GraduationCap, guardians: Users, academics: BookOpen, users: UserCog, roles: ShieldCheck, settings: Settings, audit: ScrollText } as const;
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

function Links({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${active ? "bg-brand-700 text-white" : "text-brand-100 hover:bg-brand-800"}`}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Main">
      <Links items={items} />
    </nav>
  );
}

export function MobileNav({ items, menuLabel, closeLabel, schoolName, footer }: { items: NavItem[]; menuLabel: string; closeLabel: string; schoolName: string; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={menuLabel} aria-expanded={open} className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-canvas lg:hidden">
        <Menu className="size-6" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={menuLabel}>
          <button type="button" aria-label={closeLabel} className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-900 p-4 text-white">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">{schoolName}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-800">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto">
              <Links items={items} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="border-t border-brand-800 pt-3">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}
