import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, BookOpen, Briefcase, GraduationCap, Users } from "lucide-react";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { getSite, initialsOf } from "@/lib/site";
import { inter, montserrat } from "@/lib/fonts";
import { ActionForm, Field, PasswordField } from "@/components/form";
import { LanguageSwitch } from "@/components/language-switch";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

/**
 * One sign-in for the whole school community. Parents, students, teachers and every member of staff sign in here and are taken to their own
 * page (`homeFor` and the role portals decide where; every page is still permission-checked). Built for phones first: one column, large
 * touch targets, 16px inputs, a Show/Hide password button. The picture and the name are the school's own.
 */
export default async function LoginPage() {
  const signedIn = await getContext();
  if (signedIn) redirect(homeFor(signedIn.userType));
  const [t, locale, site] = await Promise.all([getT(), getLocale(), getSite()]);
  const name = site?.school.name ?? t("app.name");
  const motto = site?.school.motto;
  const logo = site?.images.logo;
  // The school's own photographs only (a wide one if there is one); with none, the page simply has the green background.
  const pool = site ? (site.images.hero.length ? site.images.hero : site.images.gallery) : [];
  const photo = pool.find((p) => p.width / p.height >= 1.25) ?? pool[0];
  const audiences = [
    { icon: Users, title: t("auth.login.parents"), body: t("auth.login.parents.body") },
    { icon: GraduationCap, title: t("auth.login.students"), body: t("auth.login.students.body") },
    { icon: BookOpen, title: t("auth.login.teachers"), body: t("auth.login.teachers.body") },
    { icon: Briefcase, title: t("auth.login.staff"), body: t("auth.login.staff.body") },
  ];

  return (
    <div className={`site-root ${montserrat.variable} ${inter.variable} relative isolate min-h-dvh overflow-hidden bg-brand-900 text-white`}>
      {photo && <Image src={photo.src} alt="" fill priority sizes="100vw" className="-z-20 object-cover" />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-950/85 via-brand-900/65 to-brand-900/70 lg:bg-gradient-to-r lg:from-brand-950/90 lg:via-brand-900/70 lg:to-brand-900/35" />

      <main className="mx-auto grid min-h-dvh w-full max-w-6xl content-start gap-6 px-4 pb-10 pt-8 sm:px-8 lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:items-center lg:gap-x-16 lg:gap-y-8 lg:py-12">
        {/* The school */}
        <section className="lg:col-start-1 lg:row-start-1 lg:self-end">
          <Link href="/" className="inline-flex items-center gap-4" aria-label={name}>
            {logo ? <Image src={logo.src} alt="" width={64} height={64} priority className="size-14 shrink-0 bg-white object-contain p-0.5 sm:size-16" /> : <span aria-hidden className="display grid size-14 shrink-0 place-items-center bg-white text-lg text-brand-800 sm:size-16">{initialsOf(name)}</span>}
            <span className="min-w-0">
              <span className="display block text-2xl text-white sm:text-3xl">{name}</span>
              {motto && <span className="block text-sm font-medium tracking-wide text-white/80">{motto}</span>}
            </span>
          </Link>
          <h1 className="display mt-6 hidden text-4xl text-white lg:block xl:text-5xl">{t("auth.login.headline")}</h1>
          <p className="mt-4 hidden max-w-lg text-lg leading-relaxed text-white/85 lg:block">{t("auth.login.lead")}</p>
        </section>

        {/* The sign-in */}
        <section className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <div className="mx-auto w-full max-w-md bg-white p-6 text-ink shadow-[0_24px_60px_-20px_rgb(0_0_0/.6)] sm:p-8">
            <h2 className="display text-3xl text-heading">{t("auth.signIn.title")}</h2>
            <p className="mb-5 mt-2 text-base text-muted lg:hidden">{t("auth.login.leadShort")}</p>
            <p className="mb-5 mt-2 hidden text-base text-muted lg:block">{t("auth.signIn.intro")}</p>
            <ActionForm action={loginAction} submitLabel={t("auth.signIn.button")} className="space-y-4" buttonClassName="min-h-12 w-full">
              <Field name="identifier" label={t("auth.identifier")} autoComplete="username" required />
              <PasswordField name="password" label={t("auth.password")} autoComplete="current-password" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} />
            </ActionForm>
            <p className="mt-5 text-sm text-muted">{t("auth.login.forgot")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-4 text-sm">
              <Link href="/apply/form" className="inline-flex min-h-11 items-center font-semibold text-link hover:underline">{t("auth.login.apply")}</Link>
              <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("auth.backToSite")}</Link>
            </div>
          </div>
          <div className="mt-5 flex justify-center"><LanguageSwitch current={locale} dark pill /></div>
        </section>

        {/* Who signs in here */}
        <section aria-label={t("auth.login.who")} className="lg:col-start-1 lg:row-start-2 lg:self-start">
          <ul className="grid gap-3 sm:grid-cols-2">
            {audiences.map((a) => (
              <li key={a.title} className="flex gap-3 border border-white/20 bg-white/10 p-4">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center bg-sun text-[#10200f]"><a.icon className="size-5" /></span>
                <span><span className="block font-semibold text-white">{a.title}</span><span className="mt-0.5 block text-sm leading-snug text-white/80">{a.body}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-white/75 lg:hidden">{t("auth.login.after")}</p>
        </section>
      </main>
    </div>
  );
}
