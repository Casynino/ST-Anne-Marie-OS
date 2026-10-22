import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";

/** Section links for the finance area, limited to what the user may open. */
export function FinanceNav({ ctx, t, current, unmatched = 0, admissionDue = 0 }: { ctx: AuthContext; t: Translate; current: string; unmatched?: number; admissionDue?: number }) {
  const has = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const items = [
    { href: "/finance", label: t("fin.nav.overview"), show: has("finance.reports") || has("fees.read") },
    { href: "/finance/invoices", label: t("fin.nav.invoices"), show: has("fees.read") },
    { href: "/finance/payments", label: t("fin.nav.payments"), show: has("fees.read") },
    { href: "/finance/refunds", label: t("fin.nav.refunds"), show: has("fees.read") },
    { href: "/finance/admissions", label: t("fin.nav.admissions"), show: has("admission.payment.record") || has("admission.payment.verify"), badge: admissionDue },
    { href: "/finance/application-fees", label: t("fin.nav.applicationFees"), show: has("finance.reports") || has("admission.payment.verify") || has("admission.payment.record") },
    { href: "/finance/annual", label: t("lc.nav.annualFees"), show: has("fees.read") && has("registration.read") },
    { href: "/finance/reconciliation", label: t("fin.nav.reconciliation"), show: has("finance.reconcile"), badge: unmatched },
    { href: "/finance/fees", label: t("fin.nav.fees"), show: has("fees.read") },
    { href: "/finance/expenses", label: t("fin.nav.expenses"), show: has("expense.read") },
    { href: "/finance/reports", label: t("fin.nav.reports"), show: has("finance.reports") },
  ].filter((i) => i.show);
  return (
    <nav aria-label={t("fin.title")} className="no-print -mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-1 whitespace-nowrap border-b border-line">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={current === i.href ? "page" : undefined} className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${current === i.href ? "border-link text-ink" : "border-transparent text-muted hover:border-line hover:text-ink"}`}>
              {i.label}
              {"badge" in i && i.badge ? <span className="rounded-md bg-warn px-1.5 text-xs font-semibold text-white">{i.badge}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
