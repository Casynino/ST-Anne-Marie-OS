import { makeT, type Locale } from "@/lib/i18n";
import type { AuthContext } from "@/lib/auth/context";
import { formatMoney } from "@/lib/finance/money";
import { buildJoiningPdf, type JoiningDoc, type JoiningLabels } from "@/lib/pdf/joining";
import { joiningView } from "@/server/joining";
import { loadLogo } from "@/server/report-card-pdf";

const longDate = (d: Date, locale: Locale, timeZone: string) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(d);
const dayOnly = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

export function joiningLabels(locale: Locale): JoiningLabels {
  const t = makeT(locale);
  return {
    title: t("join.title"), date: t("join.date"), applicant: t("join.applicant"), appNo: t("join.appNo"), class: t("join.class"), accepted: t("join.accepted"), offer: t("join.offer"), congrats: t("join.congrats", { name: "{name}", class: "{class}" }),
    results: t("join.results"), subject: t("join.subject"), mark: t("join.mark"), average: t("join.average"), pay: t("join.pay"), fee: t("join.fee"), paid: t("join.paid"), balance: t("join.balance"), reference: t("join.reference"),
    howToPay: t("join.howToPay"), howToPayNone: t("join.howToPayNone"), payNote: t("join.payNote"), noFee: t("join.noFee"), bring: t("join.bring"), report: t("join.report"), next: t("join.next"),
    step1: t("join.step1"), step2: t("join.step2"), step3: t("join.step3"), step4: t("join.step4"), notes: t("join.notes"), contact: t("join.contact"), present: t("join.present"),
  };
}

/** The joining instructions as the document's data (shared by the PDF), in the person's language. */
export async function joiningDocument(ctx: AuthContext, id: string, locale: Locale): Promise<JoiningDoc> {
  const v = await joiningView(ctx, id);
  const t = makeT(locale);
  const cur = v.school.currency;
  const settled = v.fee.status === "PAID" || v.fee.status === "WAIVED" || v.fee.status === "NOT_REQUIRED";
  return {
    school: { name: v.school.name, motto: v.school.motto, address: v.school.address, phone: v.school.phone, email: v.school.email },
    date: longDate(new Date(), locale, v.school.timezone), applicant: v.applicantName, applicationNo: v.applicationNo, className: v.className,
    acceptedOn: v.acceptedOn ? longDate(v.acceptedOn, locale, v.school.timezone) : null, letterNo: v.letterNo,
    results: v.results.map((r) => ({ subject: r.subject, mark: r.mark !== null ? `${r.mark} / ${r.maxMark}` : r.outcome ?? "—" })),
    average: v.average !== null ? `${v.average}%${v.passMark !== null ? ` (${t("join.passMark", { pass: String(v.passMark) })})` : ""}` : null,
    fee: {
      required: formatMoney(v.fee.requiredCents, cur), paid: formatMoney(v.fee.verifiedCents, cur), balance: formatMoney(v.fee.balanceCents, cur), reference: v.fee.reference, howToPay: v.fee.howToPay,
      statusText: t(`adm.pay.status.${v.fee.status}` as "adm.pay.status.PAID"), settled, none: v.fee.requiredCents <= 0,
    },
    bring: v.settings.bringList, reportingDate: v.settings.reportingOn ? dayOnly(v.settings.reportingOn, locale) : null, reportingNote: v.settings.reportingNote, notes: v.settings.notes,
  };
}

export async function joiningPdf(ctx: AuthContext, id: string, locale: Locale): Promise<Uint8Array> {
  const doc = await joiningDocument(ctx, id, locale);
  return buildJoiningPdf(doc, joiningLabels(locale), await loadLogo(ctx.schoolId));
}
