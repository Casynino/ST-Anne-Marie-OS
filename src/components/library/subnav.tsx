import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";

/** Section links of Library Management, limited to what the person may open. */
export function LibraryNav({ ctx, t, current }: { ctx: AuthContext; t: Translate; current: string }) {
  const has = (...p: string[]) => p.some((x) => ctx.permissions.has(x as never));
  const items = [
    { href: "/library-admin", label: t("lib.nav.resources"), show: has("library.read", "library.upload", "library.manage", "library.review", "library.publish") },
    { href: "/library-admin/categories", label: t("lib.nav.categories"), show: has("library.manage") },
    { href: "/library-admin/students", label: t("lib.nav.pins"), show: has("library.pin") },
    { href: "/library-admin/analytics", label: t("lib.nav.analytics"), show: has("library.analytics", "library.manage") },
    { href: "/library-admin/activity", label: t("lib.nav.activity"), show: has("library.audit") },
    { href: "/library-admin/settings", label: t("lib.nav.settings"), show: has("library.manage") },
    { href: "/library", label: t("lib.nav.public"), show: true },
  ].filter((i) => i.show);
  return (
    <nav aria-label={t("lib.title")} className="no-print -mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 whitespace-nowrap">
        {items.map((i) => (
          <li key={i.href}><Link href={i.href} aria-current={current === i.href ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${current === i.href ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface hover:bg-canvas"}`}>{i.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
