import { BarChart3, Bell, ClipboardCheck, RefreshCcw, Settings, UserCog } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";
import { SectionTabs } from "@/components/section-tabs";

/** Section links for the attendance area, limited to what the user may open. */
export function AttendanceNav({ ctx, t, current, conflicts = 0 }: { ctx: AuthContext; t: Translate; current: string; conflicts?: number }) {
  const has = (...p: Parameters<AuthContext["permissions"]["has"]>) => ctx.permissions.has(...p);
  const items = [
    { href: "/attendance", label: t("att.title"), icon: ClipboardCheck, show: true, badge: 0 },
    { href: "/attendance/reports", label: t("att.reports"), icon: BarChart3, show: has("attendance.read") || has("attendance.read_assigned") || has("attendance.take") || has("attendance.take_any"), badge: 0 },
    { href: "/attendance/conflicts", label: t("att.conflicts"), icon: RefreshCcw, show: has("attendance.correct"), badge: conflicts },
    { href: "/attendance/staff", label: t("att.staff"), icon: UserCog, show: has("attendance.staff.read"), badge: 0 },
    { href: "/attendance/alerts", label: t("att.alerts"), icon: Bell, show: has("notification.read"), badge: 0 },
    { href: "/attendance/settings", label: t("att.settings"), icon: Settings, show: has("attendance.configure"), badge: 0 },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return <SectionTabs items={items} current={current} label={t("att.title")} />;
}
