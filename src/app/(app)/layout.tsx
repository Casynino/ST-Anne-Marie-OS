import Link from "next/link";
import { LogOut } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { getSchoolBasics } from "@/server/settings";
import { signOutAction } from "@/app/actions-shared";
import { LanguageSwitch } from "@/components/language-switch";
import { MobileNav, SidebarNav, type NavItem } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const t = await getT();
  const school = await getSchoolBasics(ctx.schoolId);

  const items: NavItem[] = [{ href: "/", label: t("nav.dashboard"), icon: "dashboard" }];
  if (hasAny(ctx, ["student.read", "student.read_assigned"])) items.push({ href: "/students", label: t("nav.students"), icon: "students" });
  if (hasAny(ctx, ["guardian.read"])) items.push({ href: "/guardians", label: t("nav.guardians"), icon: "guardians" });
  if (hasAny(ctx, ["academic.read"])) items.push({ href: "/academics", label: t("nav.academics"), icon: "academics" });
  if (hasAny(ctx, ["user.read"])) items.push({ href: "/users", label: t("nav.users"), icon: "users" });
  if (hasAny(ctx, ["role.read"])) items.push({ href: "/roles", label: t("nav.roles"), icon: "roles" });
  if (hasAny(ctx, ["school.settings.read"])) items.push({ href: "/settings", label: t("nav.settings"), icon: "settings" });
  if (hasAny(ctx, ["audit.read"])) items.push({ href: "/audit", label: t("nav.audit"), icon: "audit" });

  const signOut = (
    <form action={signOutAction}>
      <button className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-brand-100 hover:bg-brand-800">
        <LogOut className="size-5" aria-hidden /> {t("nav.signOut")}
      </button>
    </form>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh flex-col bg-brand-900 p-4 text-white lg:flex">
        <Link href="/" className="mb-6 block px-1">
          <span className="block text-lg font-semibold leading-tight">{school.name}</span>
          <span className="text-xs text-brand-200">{t("app.tagline")}</span>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav items={items} />
        </div>
        <div className="space-y-3 border-t border-brand-800 pt-3">
          <LanguageSwitch current={ctx.locale} dark />
          {signOut}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-white px-3 py-2 lg:px-6">
          <MobileNav items={items} menuLabel={t("nav.menu")} closeLabel={t("nav.close")} schoolName={school.name} footer={<div className="space-y-3"><LanguageSwitch current={ctx.locale} dark />{signOut}</div>} />
          <span className="truncate font-semibold lg:hidden">{school.name}</span>
          <span className="ml-auto truncate text-sm text-muted">{ctx.fullName}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
