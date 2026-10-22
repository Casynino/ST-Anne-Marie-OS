import { Bell, FileText, Megaphone, MessageSquare } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";
import { SectionTabs } from "@/components/section-tabs";

export function CommunicationNav({ ctx, t, current, attention = 0 }: { ctx: AuthContext; t: Translate; current: string; attention?: number }) {
  const has = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const items = [
    { href: "/communication", label: t("comm.nav.notices"), icon: Megaphone, show: has("comms.read"), badge: 0 },
    { href: "/communication/messages", label: t("comm.nav.messages"), icon: MessageSquare, show: has("messages.read") || has("messages.moderate"), badge: attention },
    { href: "/communication/templates", label: t("comm.nav.templates"), icon: FileText, show: has("comms.manage"), badge: 0 },
    { href: "/notifications", label: t("comm.nav.alerts"), icon: Bell, show: has("notification.read"), badge: 0 },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return <SectionTabs items={items} current={current} label={t("comm.title")} />;
}
