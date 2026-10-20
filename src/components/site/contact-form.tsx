import type { Translate } from "@/lib/i18n";
import { ActionForm, Field } from "@/components/form";
import { submitEnquiryAction } from "@/app/(site)/contact/actions";

/** Public contact form. Saved to the school's enquiry inbox on the server; errors and success come from the real result. */
export function ContactForm({ t, idPrefix = "" }: { t: Translate; idPrefix?: string }) {
  return (
    <ActionForm action={submitEnquiryAction} submitLabel={t("site.form.send")} className="space-y-4" successTitle={t("site.form.sentTitle")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label={t("site.form.name")} required autoComplete="name" />
        <Field name="topic" label={t("site.form.topic")} type="select" placeholder={t("common.select")} options={[{ value: "Admissions", label: t("site.form.topic.admissions") }, { value: "General", label: t("site.form.topic.general") }, { value: "Other", label: t("site.form.topic.other") }]} />
        <Field name="phone" label={t("site.form.phone")} type="tel" autoComplete="tel" hint={t("site.form.contactHint")} />
        <Field name="email" label={t("site.form.email")} type="email" autoComplete="email" />
      </div>
      <Field name="message" label={t("site.form.message")} type="textarea" rows={5} required />
      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <Field name="consent" type="checkbox" label={t("site.form.consent")} required />
      <input type="hidden" name="idPrefix" value={idPrefix} />
    </ActionForm>
  );
}
