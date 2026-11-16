import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { getSite, initialsOf } from "@/lib/site";
import { inter, montserrat } from "@/lib/fonts";
import { ActionForm, Field, PasswordField } from "@/components/form";
import { LanguageSwitch } from "@/components/language-switch";
import { EntryBackdrop } from "@/components/entry-backdrop";
import { LoginDialog } from "@/components/login-dialog";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

/**
 * One sign-in for the whole school community: parents, students, teachers and every member of staff sign in here and are taken to their own
 * page (`homeFor` and the role portals decide where; every page is still permission-checked). The same idea as the ZELab entry screen:
 * a moving picture (the school's own photographs drifting and cross-fading), the logo, the school's name and motto, and one plain
 * "Log in →". The form opens in a pop-up. Always dark (`site-dark`). Phones first: large touch targets, 16px inputs, a Show/Hide password.
 */
export default async function LoginPage() {
  const signedIn = await getContext();
  if (signedIn) redirect(homeFor(signedIn.userType));
  const [t, locale, site] = await Promise.all([getT(), getLocale(), getSite()]);
  const name = site?.school.name ?? t("app.name");
  const motto = site?.school.motto;
  const logo = site?.images.logo;
  // The school's own photographs only (wide ones first, a few of them); with none, the page simply has the dark green background.
  const pool = site ? [...(site.images.hero ?? []), ...(site.images.gallery ?? [])] : [];
  const wide = pool.filter((p) => p.width / p.height >= 1.25);
  const photos = (wide.length >= 2 ? wide : pool).filter((p, i, a) => a.findIndex((q) => q.src === p.src) === i).slice(0, 5).map((p) => ({ src: p.src, width: p.width, height: p.height }));

  return (
    <div className={`site-root site-dark ${montserrat.variable} ${inter.variable} relative isolate grid min-h-dvh place-items-center overflow-hidden px-4 py-10 text-center text-ink`}>
      {photos.length > 0 && <EntryBackdrop photos={photos} />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(75%_65%_at_50%_35%,rgb(6_38_27/.5),rgb(5_14_10/.9))]" />
      <div aria-hidden className="entry-dots pointer-events-none absolute inset-0 -z-10 opacity-70" />

      <Link href="/" className="absolute left-3 top-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white sm:left-5 sm:top-5"><ArrowLeft className="size-4" aria-hidden />{t("auth.backToSite")}</Link>

      <main className="flex w-full max-w-md flex-col items-center">
        <Link href="/" className="rise flex flex-col items-center gap-4" aria-label={name}>
          {logo ? <Image src={logo.src} alt="" width={96} height={96} priority className="size-20 shrink-0 rounded-full bg-white object-contain p-1 shadow-[0_10px_40px_-10px_rgb(0_0_0/.7)] sm:size-24" /> : <span aria-hidden className="display grid size-20 shrink-0 place-items-center rounded-full bg-brand-700 text-2xl text-white sm:size-24">{initialsOf(name)}</span>}
          <span className="display text-3xl text-white sm:text-4xl">{name}</span>
        </Link>
        {motto && <p className="rise-2 mt-2 text-base font-medium tracking-[.14em] text-white/80">{motto}</p>}
        <span aria-hidden className="rise-2 mt-5 block h-[3px] w-12 rounded bg-sun" />
        <div className="rise-3 mt-8">
          <LoginDialog trigger={t("auth.login.entry")} title={t("auth.signIn.title")} closeLabel={t("auth.login.close")}>
            <p className="-mt-2 mb-5 text-sm text-white/70">{t("auth.signIn.intro")}</p>
            <ActionForm action={loginAction} submitLabel={t("auth.signIn.button")} className="space-y-4" buttonClassName="min-h-12 w-full">
              <Field name="identifier" label={t("auth.identifier")} autoComplete="username" required />
              <PasswordField name="password" label={t("auth.password")} autoComplete="current-password" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} />
            </ActionForm>
            <p className="mt-4 text-xs text-white/60">{t("auth.login.forgot")}</p>
          </LoginDialog>
        </div>
        <nav aria-label={t("auth.signIn.title")} className="rise-3 mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          <Link href="/apply/form" className="inline-flex min-h-11 items-center text-white/80 hover:text-white hover:underline">{t("auth.login.apply")}</Link>
        </nav>
        <div className="rise-3 mt-1"><LanguageSwitch current={locale} dark pill /></div>
      </main>
    </div>
  );
}
