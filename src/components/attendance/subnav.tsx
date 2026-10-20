import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";

/** Section links for the attendance area, limited to what the user may open. */
export function AttendanceNav({ ctx, t, current, conflicts = 0 }: { ctx: AuthContext; t: Translate; current: string; conflicts?: number }) {
  const has = (...p: Parameters<AuthContext["permissions"]["has"]>) => ctx.permissions.has(...p);
  const items = [
    { href: "/attendance", label: t("att.title"), show: true },
    { href: "/attendance/reports", label: t("att.reports"), show: has("attendance.read") || has("attendance.read_assigned") || has("attendance.take") || has("attendance.take_any") },
    { href: "/attendance/conflicts", label: t("att.conflicts"), show: has("attendance.correct"), badge: conflicts },
    { href: "/attendance/staff", label: t("att.staff"), show: has("attendance.staff.read") },
    { href: "/attendance/alerts", label: t("att.alerts"), show: has("notification.read") },
    { href: "/attendance/settings", label: t("att.settings"), show: has("attendance.configure") },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return (
    <nav aria-label={t("att.title")} className="no-print -mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 whitespace-nowrap">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={current === i.href ? "page" : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${current === i.href ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface text-ink hover:bg-canvas"}`}
            >
              {i.label}
              {"badge" in i && i.badge ? <span className="rounded-full bg-warn px-1.5 text-xs font-semibold text-white">{i.badge}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
