import Link from "next/link";
import type { Metadata } from "next";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { formatMoney } from "@/lib/finance/money";
import { applicationFeeInfo } from "@/server/application-fee";
import { getSite } from "@/lib/site";
import { listApplyClasses } from "@/server/public-applications";
import { RELATIONSHIPS } from "@/server/guardians";
import { ApplicationFields } from "@/components/site/application-fields";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { db } from "@/lib/db";
import { ActionForm, Field, FileField } from "@/components/form";
import { EntryTypeProvider, WhenTransfer } from "@/components/site/entry-type";
import { ButtonLink, PageHero } from "@/components/site/blocks";
import { submitApplicationAction } from "../actions";
import { openWindows } from "@/server/interview-days";
import { OpenWindows } from "@/components/site/open-windows";

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
  const [fee, me, policy, windows] = await Promise.all([applicationFeeInfo(site.school.id), getContext(), getAdmissionPolicy(db, site.school.id), openWindows(site.school.id)]);
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
        <div className="mb-8"><OpenWindows windows={windows} t={t} locale={locale} timezone={site.school.timezone} /></div>
        {fee.feeCents > 0 && (
          <div className="mb-8 border border-line bg-surface p-5 sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{t("apply.fee.label")}</p>
            <p className="display mt-1 text-4xl text-heading">{formatMoney(fee.feeCents, fee.currency)}</p>
            <p className="mt-2 text-sm text-muted">{t("apply.fee.body")}</p>
          </div>
        )}
        <ActionForm action={submitApplicationAction} submitLabel={fee.feeCents > 0 ? t("apply.submit.pay") : t("apply.submit")} className="space-y-8">
          <EntryTypeProvider defaultKind="NEW">
          <ApplicationFields t={t} classOptions={classOptions} relOptions={relOptions} emailRequired={needsAccount} variant="site" />

          <fieldset className="space-y-4 border border-line bg-surface p-5 sm:p-7">
            <legend className="display px-2 text-3xl">{t("apf.files.title")}</legend>
            <p className="text-sm text-muted">{t("apply.files.body")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FileField name="photo" label={t("apf.photo.title")} accept="image/jpeg,image/png,image/webp" required={policy.applicationPhotoRequired} optionalLabel={t("common.optional")} hint={t("apf.photo.hint")} />
              {policy.requiredDocTypes.filter((d) => d !== "PASSPORT_PHOTO").map((d) => (
                <FileField key={d} name={`paper_${d}`} label={t(`doc.type.${d}` as "doc.type.OTHER")} accept="application/pdf,image/jpeg,image/png,image/webp" required hint={t("apf.papers.hint")} />
              ))}
              <WhenTransfer>
                {policy.transferDocTypes.filter((d) => d !== "PASSPORT_PHOTO" && !policy.requiredDocTypes.includes(d)).map((d) => (
                  <FileField key={d} name={`paper_${d}`} label={t(`doc.type.${d}` as "doc.type.OTHER")} accept="application/pdf,image/jpeg,image/png,image/webp" required hint={t("apf.papers.hint")} />
                ))}
              </WhenTransfer>
              <FileField name="paper_OTHER" label={t("apf.papers.other")} accept="application/pdf,image/jpeg,image/png,image/webp" optionalLabel={t("common.optional")} hint={t("apf.papers.hint")} />
            </div>
          </fieldset>
          </EntryTypeProvider>

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
