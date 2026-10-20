import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { ActionForm, Field } from "@/components/form";
import { ThemeRoot } from "@/components/theme-root";
import { LanguageSwitch } from "@/components/language-switch";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const signedIn = await getContext();
  if (signedIn) redirect(homeFor(signedIn.userType));
  const t = await getT();
  const locale = await getLocale();
  // Single-school deployment: show the school's name on the sign-in screen.
  const school = await db.school.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true } });

  return (
    <ThemeRoot className="min-h-dvh">
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-link">{school?.name ?? t("app.name")}</h1>
        <p className="mt-1 text-sm text-muted">{t("app.tagline")}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">{t("auth.signIn.title")}</h2>
        <p className="mb-4 mt-1 text-sm text-muted">{t("auth.signIn.intro")}</p>
        <ActionForm action={loginAction} submitLabel={t("auth.signIn.button")}>
          <Field name="identifier" label={t("auth.identifier")} autoComplete="username" required />
          <Field name="password" label={t("auth.password")} type="password" autoComplete="current-password" required />
        </ActionForm>
      </div>
      <div className="mt-4 flex justify-center">
        <LanguageSwitch current={locale} />
      </div>
    </main>
    </ThemeRoot>
  );
}
