import Link from "next/link";
import type { Metadata } from "next";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { formatMoney } from "@/lib/finance/money";
import { applicationFeeInfo } from "@/server/application-fee";
import { getSite } from "@/lib/site";
import { listApplyClasses } from "@/server/public-applications";
import { RELATIONSHIPS } from "@/server/guardians";
import { ActionForm, Field } from "@/components/form";
import { ButtonLink, PageHero } from "@/components/site/blocks";
import { submitApplicationAction } from "../actions";

export const metadata: Metadata = { title: "Apply online" };

export default async function ApplyPage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  if (!site.settings.applicationsOpen) {
    return (
      <>
        <PageHero photo={false} title={t("apply.closed.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/apply", label: t("site.nav.admissions") }]}>{t("apply.closed.body")}</PageHero>
        <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-10 sm:px-6">
          <ButtonLink href="/contact" arrow>{t("site.nav.contact")}</ButtonLink>
          <p><Link href="/apply/track" className="font-semibold underline underline-offset-4">{t("site.admissions.track")}</Link></p>
        </div>
      </>
    );
  }
  const [fee, me] = await Promise.all([applicationFeeInfo(site.school.id), getContext()]);
  // With a fee but no way for families to pay it yet, the form is not offered (an application could never be completed).
  if (fee.feeCents > 0 && !fee.ready) {
    return (
      <>
        <PageHero photo={false} title={t("apply.noPay.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/apply", label: t("site.nav.admissions") }]}>{t("apply.noPay.body")}</PageHero>
        <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-10 sm:px-6"><ButtonLink href="/contact" arrow>{t("site.nav.contact")}</ButtonLink></div>
      </>
    );
  }
  const signedIn = me?.userType === "GUARDIAN" && me.schoolId === site.school.id;
  const needsAccount = !signedIn;
  const classes = await listApplyClasses(site.school.id, locale);
  const classOptions = classes.map((c) => ({ value: c.id, label: `${c.level} — ${c.name}` }));
  const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") }));

  return (
    <>
      <PageHero photo={false} eyebrow={t("site.how.kicker")} title={t("apply.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/apply", label: t("site.nav.admissions") }, { href: "/apply/form", label: t("apply.title") }]}>{t("apply.intro")}</PageHero>
      <div className="mx-auto max-w-[100rem] px-4 py-10 sm:px-6"><div className="max-w-3xl">
        {fee.feeCents > 0 && (
          <div className="mb-8 border border-line bg-surface p-5 sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{t("apply.fee.label")}</p>
            <p className="display mt-1 text-4xl text-heading">{formatMoney(fee.feeCents, fee.currency)}</p>
            <p className="mt-2 text-sm text-muted">{t("apply.fee.body")}</p>
          </div>
        )}
        <ActionForm action={submitApplicationAction} submitLabel={fee.feeCents > 0 ? t("apply.submit.pay") : t("apply.submit")} className="space-y-8">
          <fieldset className="space-y-4 border border-line bg-surface p-5 sm:p-7">
            <legend className="display px-2 text-3xl">{t("apply.child")}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="firstName" label={t("student.firstName")} required autoComplete="off" />
              <Field name="middleName" label={t("student.middleName")} optionalLabel={t("common.optional")} />
              <Field name="lastName" label={t("student.lastName")} required />
              <Field name="dateOfBirth" label={t("student.dob")} type="date" required />
              <Field name="gender" label={t("student.gender")} type="select" options={[{ value: "MALE", label: t("student.male") }, { value: "FEMALE", label: t("student.female") }]} placeholder={t("common.select")} required />
              <Field name="classAppliedId" label={t("apply.class")} type="select" options={classOptions} placeholder={t("common.select")} required />
              <Field name="previousSchool" label={t("student.previousSchool")} optionalLabel={t("common.optional")} className="sm:col-span-2" />
              <Field name="address" label={t("common.address")} optionalLabel={t("common.optional")} />
            </div>
          </fieldset>

          <fieldset className="space-y-4 border border-line bg-surface p-5 sm:p-7">
            <legend className="display px-2 text-3xl">{t("apply.guardian")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="g1_fullName" label={t("apply.guardian.name")} required />
              <Field name="g1_relationship" label={t("apply.relationship")} type="select" options={relOptions} placeholder={t("common.select")} required />
              <Field name="g1_phone" label={t("apply.guardian.phone")} type="tel" hint={t("apply.guardian.phone.hint")} required />
              <Field name="g1_email" label={t("apply.guardian.email")} type="email" hint={needsAccount ? t("apply.account.emailHint") : undefined} required={needsAccount} optionalLabel={needsAccount ? undefined : t("common.optional")} />
            </div>
          </fieldset>

          {needsAccount ? (
            <fieldset className="space-y-4 border border-line bg-surface p-5 sm:p-7">
              <legend className="display px-2 text-3xl">{t("apply.account")}</legend>
              <p className="text-sm text-muted">{t("apply.account.body")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="password" label={t("auth.password")} type="password" autoComplete="new-password" hint={t("auth.passwordRules")} required />
                <Field name="password2" label={t("apply.account.confirm")} type="password" autoComplete="new-password" required />
              </div>
              <p className="text-sm text-muted">{t("apply.account.signIn")} <Link href="/login" className="font-semibold underline underline-offset-4">{t("auth.signIn.button")}</Link></p>
            </fieldset>
          ) : (
            <p className="border border-line bg-surface p-5 text-sm">{t("apply.account.signedIn", { name: me!.fullName })}</p>
          )}

          <details className="border border-line bg-surface p-5 sm:p-7">
            <summary className="display min-h-11 cursor-pointer text-3xl">{t("apply.guardian2")}</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field name="g2_fullName" label={t("apply.guardian.name")} />
              <Field name="g2_relationship" label={t("apply.relationship")} type="select" options={relOptions} placeholder={t("common.select")} />
              <Field name="g2_phone" label={t("apply.guardian.phone")} type="tel" />
            </div>
          </details>

          {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
          </div>

          <div className="space-y-3 bg-surface p-5">
            <Field name="consent" type="checkbox" label={t("apply.consent")} required />
            <p className="text-xs text-muted">{t("apply.privacy")}</p>
          </div>
        </ActionForm>
      </div></div>
    </>
  );
}
