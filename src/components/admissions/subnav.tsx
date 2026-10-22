import { BarChart3, CalendarDays, CalendarRange, ClipboardList, MessagesSquare, SlidersHorizontal, UserCheck, Wallet } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";
import { SectionTabs } from "@/components/section-tabs";

/** Section links for the admissions area (new applicants only), limited to what the user may open. */
export function AdmissionsNav({ ctx, t, current, badges = {} }: { ctx: AuthContext; t: Translate; current: string; badges?: Record<string, number> }) {
  const has = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const items = [
    { href: "/admissions", label: t("adm.nav.applications"), icon: ClipboardList, show: has("admission.read") },
    { href: "/admissions?stage=interview", label: t("adm.nav.stageInterview"), icon: MessagesSquare, show: has("admission.read") },
    { href: "/admissions/payment", label: t("adm.nav.payment"), icon: Wallet, show: has("admission.read") },
    { href: "/admissions/registration", label: t("adm.nav.registration"), icon: UserCheck, show: has("admission.read") },
    { href: "/admissions/windows", label: t("adm.nav.windows"), icon: CalendarRange, show: has("admission.read") || has("admission.interview.manage") },
    { href: "/admissions/interviews", label: t("adm.nav.calendar"), icon: CalendarDays, show: has("admission.read") || has("admission.interview.manage") },
    { href: "/admissions/reports", label: t("adm.nav.reports"), icon: BarChart3, show: has("admission.read") },
    { href: "/admissions/policy", label: t("adm.nav.policy"), icon: SlidersHorizontal, show: has("school.settings.read") },
  ].filter((i) => i.show).map((i) => ({ ...i, badge: badges[i.href] }));
  return <SectionTabs items={items} current={current} label={t("adm.title")} />;
}
