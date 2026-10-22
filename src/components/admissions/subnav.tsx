import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";

/** Section links for the admissions area, limited to what the user may open. */
export function AdmissionsNav({ ctx, t, current, badges = {} }: { ctx: AuthContext; t: Translate; current: string; badges?: Record<string, number> }) {
  const has = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const items = [
    { href: "/admissions", label: t("adm.nav.applications"), show: has("admission.read") },
    { href: "/admissions?stage=interview", label: t("adm.nav.stageInterview"), show: has("admission.read") },
    { href: "/admissions/payment", label: t("adm.nav.payment"), show: has("admission.read") },
    { href: "/admissions/registration", label: t("adm.nav.registration"), show: has("admission.read") },
    { href: "/admissions/returning", label: t("lc.nav.returning"), show: has("registration.read") },
    { href: "/admissions/placement", label: t("adm.nav.placement"), show: has("student.enroll") || has("admission.read") },
    { href: "/admissions/windows", label: t("adm.nav.windows"), show: has("admission.read") || has("admission.interview.manage") },
    { href: "/admissions/interviews", label: t("adm.nav.calendar"), show: has("admission.read") || has("admission.interview.manage") },
    { href: "/admissions/reports", label: t("adm.nav.reports"), show: has("admission.read") },
    { href: "/admissions/policy", label: t("adm.nav.policy"), show: has("school.settings.read") },
  ].filter((i) => i.show);
  return (
    <nav aria-label={t("adm.title")} className="no-print -mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 whitespace-nowrap">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={current === i.href ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${current === i.href ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface text-ink hover:bg-canvas"}`}>{i.label}{badges[i.href] !== undefined && <span className="ml-2 tabular-nums text-muted">{badges[i.href]}</span>}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
