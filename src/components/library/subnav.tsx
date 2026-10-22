import { BarChart3, Globe, History, KeyRound, Library, Settings, Tags } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";
import { SectionTabs } from "@/components/section-tabs";

/** Section links of Library Management, limited to what the person may open. */
export function LibraryNav({ ctx, t, current }: { ctx: AuthContext; t: Translate; current: string }) {
  const has = (...p: string[]) => p.some((x) => ctx.permissions.has(x as never));
  const items = [
    { href: "/library-admin", label: t("lib.nav.resources"), icon: Library, show: has("library.read", "library.upload", "library.manage", "library.review", "library.publish") },
    { href: "/library-admin/categories", label: t("lib.nav.categories"), icon: Tags, show: has("library.manage") },
    { href: "/library-admin/students", label: t("lib.nav.pins"), icon: KeyRound, show: has("library.pin") },
    { href: "/library-admin/analytics", label: t("lib.nav.analytics"), icon: BarChart3, show: has("library.analytics", "library.manage") },
    { href: "/library-admin/activity", label: t("lib.nav.activity"), icon: History, show: has("library.audit") },
    { href: "/library-admin/settings", label: t("lib.nav.settings"), icon: Settings, show: has("library.manage") },
    { href: "/library", label: t("lib.nav.public"), icon: Globe, show: true },
  ].filter((i) => i.show);
  return <SectionTabs items={items} current={current} label={t("lib.title")} />;
}
