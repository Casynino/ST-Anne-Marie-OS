import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { getSite, initialsOf } from "@/lib/site";
import { inter, montserrat } from "@/lib/fonts";
import { ActionForm, Field, PasswordField } from "@/components/form";
import { LanguageSwitch } from "@/components/language-switch";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

/**
 * One sign-in for the whole school community: parents, students, teachers and every member of staff sign in here and are taken to their own
 * page (`homeFor` and the role portals decide where; every page is still permission-checked). Kept as clean as the home screens: the
 * night background with its green glow, one small centred card, the school's logo and name, two fields and a button. Phones first: one
 * column, large touch targets, 16px inputs, a Show/Hide password button.
 */
export default async function LoginPage() {
  const signedIn = await getContext();
  if (signedIn) redirect(homeFor(signedIn.userType));
  const [t, locale, site] = await Promise.all([getT(), getLocale(), getSite()]);
  const name = site?.school.name ?? t("app.name");
  const logo = site?.images.logo;

  return (
    <div className={`site-root ${montserrat.variable} ${inter.variable} grid min-h-dvh place-items-center px-4 py-10 text-ink`}>
      <main className="w-full max-w-sm">
        <Link href="/" className="mx-auto mb-6 flex w-fit flex-col items-center gap-3 text-center" aria-label={name}>
          {logo ? <Image src={logo.src} alt="" width={64} height={64} priority className="size-14 shrink-0 rounded-full bg-white object-contain p-0.5" /> : <span aria-hidden className="display grid size-14 shrink-0 place-items-center rounded-full bg-brand-700 text-lg text-white">{initialsOf(name)}</span>}
          <span className="display text-xl text-heading">{name}</span>
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-lift)] sm:p-7">
          <h1 className="text-lg font-semibold text-heading">{t("auth.signIn.title")}</h1>
          <p className="mb-5 mt-1 text-sm text-muted">{t("auth.signIn.intro")}</p>
          <ActionForm action={loginAction} submitLabel={t("auth.signIn.button")} className="space-y-4" buttonClassName="min-h-12 w-full">
            <Field name="identifier" label={t("auth.identifier")} autoComplete="username" required />
            <PasswordField name="password" label={t("auth.password")} autoComplete="current-password" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} />
          </ActionForm>
          <p className="mt-4 text-xs text-muted">{t("auth.login.forgot")}</p>
        </div>
        <nav aria-label={t("auth.signIn.title")} className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          <Link href="/apply/form" className="inline-flex min-h-11 items-center text-link hover:underline">{t("auth.login.apply")}</Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-muted hover:text-ink hover:underline">{t("auth.backToSite")}</Link>
        </nav>
        <div className="flex justify-center"><LanguageSwitch current={locale} dark pill /></div>
      </main>
    </div>
  );
}
