import { BarChart3, Banknote, CalendarClock, FileText, LayoutDashboard, ReceiptText, Receipt, Scale, SlidersHorizontal, Undo2, UserCheck } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";
import { SectionTabs } from "@/components/section-tabs";

/** Section links for the finance area, limited to what the user may open. */
export function FinanceNav({ ctx, t, current, unmatched = 0, admissionDue = 0 }: { ctx: AuthContext; t: Translate; current: string; unmatched?: number; admissionDue?: number }) {
  const has = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const items = [
    { href: "/finance", icon: LayoutDashboard, label: t("fin.nav.overview"), show: has("finance.reports") || has("fees.read") },
    { href: "/finance/invoices", icon: ReceiptText, label: t("fin.nav.invoices"), show: has("fees.read") },
    { href: "/finance/payments", icon: Banknote, label: t("fin.nav.payments"), show: has("fees.read") },
    { href: "/finance/refunds", icon: Undo2, label: t("fin.nav.refunds"), show: has("fees.read") },
    { href: "/finance/admissions", icon: UserCheck, label: t("fin.nav.admissions"), show: has("admission.payment.record") || has("admission.payment.verify"), badge: admissionDue },
    { href: "/finance/application-fees", icon: FileText, label: t("fin.nav.applicationFees"), show: has("finance.reports") || has("admission.payment.verify") || has("admission.payment.record") },
    { href: "/finance/annual", icon: CalendarClock, label: t("lc.nav.annualFees"), show: has("fees.read") && has("registration.read") },
    { href: "/finance/reconciliation", icon: Scale, label: t("fin.nav.reconciliation"), show: has("finance.reconcile"), badge: unmatched },
    { href: "/finance/fees", icon: SlidersHorizontal, label: t("fin.nav.fees"), show: has("fees.read") },
    { href: "/finance/expenses", icon: Receipt, label: t("fin.nav.expenses"), show: has("expense.read") },
    { href: "/finance/reports", icon: BarChart3, label: t("fin.nav.reports"), show: has("finance.reports") },
  ].filter((i) => i.show);
  return <SectionTabs items={items.map((i) => ({ href: i.href, label: i.label, icon: i.icon, badge: "badge" in i ? i.badge : undefined }))} current={current} label={t("fin.title")} />;
}
