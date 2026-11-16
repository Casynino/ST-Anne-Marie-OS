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
 * page (`homeFor` and the role portals decide where; every page is still permission-checked). The same clean idea as the ZELab entry
 * screen: a full-screen photograph from the school itself that drifts slowly, the logo, the school's name and motto, and one small card to
 * sign in. Always dark (`site-dark`). Phones first: one column, large touch targets, 16px inputs, a Show/Hide password button.
 */
export default async function LoginPage() {
  const signedIn = await getContext();
  if (signedIn) redirect(homeFor(signedIn.userType));
  const [t, locale, site] = await Promise.all([getT(), getLocale(), getSite()]);
  const name = site?.school.name ?? t("app.name");
  const motto = site?.school.motto;
  const logo = site?.images.logo;
  // The school's own photographs only (a wide one if there is one); with none, the page simply has the dark green background.
  const pool = site ? (site.images.hero.length ? site.images.hero : site.images.gallery) : [];
  const photo = pool.find((p) => p.width / p.height >= 1.25) ?? pool[0];

  return (
    <div className={`site-root site-dark ${montserrat.variable} ${inter.variable} relative isolate grid min-h-dvh place-items-center overflow-hidden px-4 py-10 text-ink`}>
      {photo && <Image src={photo.src} alt="" fill priority sizes="100vw" className="kb -z-20 object-cover" />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_30%,rgb(6_38_27/.55),rgb(5_14_10/.92))]" />

      <main className="w-full max-w-sm">
        <Link href="/" className="mx-auto mb-7 flex w-fit flex-col items-center gap-3 text-center" aria-label={name}>
          {logo ? <Image src={logo.src} alt="" width={80} height={80} priority className="size-16 shrink-0 rounded-full bg-white object-contain p-0.5" /> : <span aria-hidden className="display grid size-16 shrink-0 place-items-center rounded-full bg-brand-700 text-xl text-white">{initialsOf(name)}</span>}
          <span className="display text-2xl text-white sm:text-3xl">{name}</span>
          {motto && <span className="text-sm font-medium tracking-[.12em] text-white/75">{motto}</span>}
          <span aria-hidden className="h-[3px] w-10 rounded bg-sun" />
        </Link>
        <div className="rounded-2xl border border-white/15 bg-black/35 p-6 shadow-[0_24px_60px_-20px_rgb(0_0_0/.7)] backdrop-blur-xl sm:p-7">
          <h1 className="text-lg font-semibold text-white">{t("auth.signIn.title")}</h1>
          <p className="mb-5 mt-1 text-sm text-white/70">{t("auth.signIn.intro")}</p>
          <ActionForm action={loginAction} submitLabel={t("auth.signIn.button")} className="space-y-4" buttonClassName="min-h-12 w-full">
            <Field name="identifier" label={t("auth.identifier")} autoComplete="username" required />
            <PasswordField name="password" label={t("auth.password")} autoComplete="current-password" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} />
          </ActionForm>
          <p className="mt-4 text-xs text-white/60">{t("auth.login.forgot")}</p>
        </div>
        <nav aria-label={t("auth.signIn.title")} className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          <Link href="/apply/form" className="inline-flex min-h-11 items-center text-link hover:underline">{t("auth.login.apply")}</Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-white/70 hover:text-white hover:underline">{t("auth.backToSite")}</Link>
        </nav>
        <div className="flex justify-center"><LanguageSwitch current={locale} dark pill /></div>
      </main>
    </div>
  );
}
