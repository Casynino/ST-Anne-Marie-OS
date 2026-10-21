import type { ReactNode } from "react";
import type { Translate } from "@/lib/i18n";
import { Field } from "@/components/form";
import type { StoredForm } from "@/server/online-application";
import { EntryTypeChoice, PreviousSchoolSection } from "@/components/site/entry-type";

type Option = { value: string; label: string };

/**
 * The details of an application: the child, the parents or guardians, a health note and an emergency contact. One component for the public
 * form and for the family's edit page, so both ask exactly the same questions. `site` is the public website's look, `portal` the family area's.
 */
export function ApplicationFields({ t, classOptions, relOptions, d = {}, emailRequired, variant }: { t: Translate; classOptions: Option[]; relOptions: Option[]; d?: Partial<StoredForm>; emailRequired?: boolean; variant: "site" | "portal" }) {
  const box = variant === "site" ? "space-y-4 border border-line bg-surface p-5 sm:p-7" : "space-y-4 rounded-2xl border border-line bg-surface p-5";
  const legend = variant === "site" ? "display px-2 text-3xl" : "px-2 text-base font-semibold";
  const summary = variant === "site" ? "display min-h-11 cursor-pointer text-3xl" : "min-h-11 cursor-pointer text-base font-semibold";
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <fieldset className={box}><legend className={legend}>{title}</legend>{children}</fieldset>
  );
  const hasSecond = Boolean(d.g2_fullName || d.g2_phone);
  const hasEmergency = Boolean(d.ec_name || d.ec_phone);
  return (
    <>
      <Section title={t("apply.entry.title")}>
        <EntryTypeChoice labels={{ name: t("apply.entry.title"), newTitle: t("apply.entry.new"), newBody: t("apply.entry.new.body"), transferTitle: t("apply.entry.transfer"), transferBody: t("apply.entry.transfer.body") }} />
      </Section>

      <Section title={t("apply.child")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="firstName" label={t("student.firstName")} defaultValue={d.firstName} required autoComplete="off" />
          <Field name="middleName" label={t("student.middleName")} defaultValue={d.middleName} optionalLabel={t("common.optional")} />
          <Field name="lastName" label={t("student.lastName")} defaultValue={d.lastName} required />
          <Field name="dateOfBirth" label={t("student.dob")} type="date" defaultValue={d.dateOfBirth?.slice(0, 10)} required />
          <Field name="gender" label={t("student.gender")} type="select" defaultValue={d.gender} options={[{ value: "MALE", label: t("student.male") }, { value: "FEMALE", label: t("student.female") }]} placeholder={t("common.select")} required />
          <Field name="classAppliedId" label={t("apply.class")} type="select" defaultValue={d.classAppliedId} options={classOptions} placeholder={t("common.select")} required />
          <Field name="nationality" label={t("student.nationality")} defaultValue={d.nationality} optionalLabel={t("common.optional")} />
          <Field name="religion" label={t("student.religion")} defaultValue={d.religion} optionalLabel={t("common.optional")} />
          <Field name="birthCertificateNo" label={t("student.birthCert")} defaultValue={d.birthCertificateNo} optionalLabel={t("common.optional")} />
          <Field name="address" label={t("common.address")} defaultValue={d.address} optionalLabel={t("common.optional")} className="sm:col-span-3" />
          <Field name="healthNotes" label={t("apply.health")} type="textarea" defaultValue={d.healthNotes} optionalLabel={t("common.optional")} hint={t("apply.health.hint")} className="sm:col-span-3" />
        </div>
      </Section>

      <PreviousSchoolSection
        box={box}
        legend={legend}
        d={d}
        labels={{ title: t("apply.previous.title"), hintNew: t("apply.previous.hintNew"), hintTransfer: t("apply.previous.hintTransfer"), school: t("student.previousSchool"), class: t("apply.previousClass"), classHint: t("apply.previousClass.hint"), reason: t("apply.transfer.reason"), reasonHint: t("apply.transfer.reason.hint"), admissionNo: t("apply.transfer.admissionNo"), optional: t("common.optional") }}
      />

      <Section title={t("apply.guardian")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="g1_fullName" label={t("apply.guardian.name")} defaultValue={d.g1_fullName} required />
          <Field name="g1_relationship" label={t("apply.relationship")} type="select" defaultValue={d.g1_relationship} options={relOptions} placeholder={t("common.select")} required />
          <Field name="g1_phone" label={t("apply.guardian.phone")} type="tel" defaultValue={d.g1_phone} hint={t("apply.guardian.phone.hint")} required />
          <Field name="g1_email" label={t("apply.guardian.email")} type="email" defaultValue={d.g1_email} hint={emailRequired ? t("apply.account.emailHint") : undefined} required={emailRequired} optionalLabel={emailRequired ? undefined : t("common.optional")} />
          <Field name="g1_occupation" label={t("apply.occupation")} defaultValue={d.g1_occupation} optionalLabel={t("common.optional")} className="sm:col-span-2" />
        </div>
      </Section>

      <details className={box} open={hasSecond}>
        <summary className={summary}>{t("apply.guardian2")}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field name="g2_fullName" label={t("apply.guardian.name")} defaultValue={d.g2_fullName} />
          <Field name="g2_relationship" label={t("apply.relationship")} type="select" defaultValue={d.g2_relationship} options={relOptions} placeholder={t("common.select")} />
          <Field name="g2_phone" label={t("apply.guardian.phone")} type="tel" defaultValue={d.g2_phone} />
          <Field name="g2_email" label={t("apply.guardian.email")} type="email" defaultValue={d.g2_email} optionalLabel={t("common.optional")} />
          <Field name="g2_occupation" label={t("apply.occupation")} defaultValue={d.g2_occupation} optionalLabel={t("common.optional")} className="sm:col-span-2" />
        </div>
      </details>

      <details className={box} open={hasEmergency}>
        <summary className={summary}>{t("apply.emergency")}</summary>
        <p className="mt-2 text-sm text-muted">{t("apply.emergency.hint")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field name="ec_name" label={t("apply.guardian.name")} defaultValue={d.ec_name} />
          <Field name="ec_relationship" label={t("apply.relationship")} defaultValue={d.ec_relationship} />
          <Field name="ec_phone" label={t("apply.guardian.phone")} type="tel" defaultValue={d.ec_phone} />
        </div>
      </details>
    </>
  );
}
