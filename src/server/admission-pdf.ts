import { db } from "@/lib/db";
import { notFound, conflict } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import { requirePermission, requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { amountInWords } from "@/lib/finance/words";
import { formatDateOnly } from "@/lib/dates";
import { buildLetterPdf, type LetterDoc } from "@/lib/pdf/letter";
import { buildReceiptPdf, type ReceiptDoc } from "@/lib/pdf/finance";
import { getFeeSettings } from "@/server/fees";
import { letterLabels } from "@/server/letter";
import { receiptLabels } from "@/server/finance-pdf";
import { loadLogo } from "@/server/report-card-pdf";

const longDate = (d: Date, locale: Locale, timeZone: string) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(d);

/**
 * The offer of admission as a formal letter. It states only what the system holds: the place offered, the admission fee, how to pay (the
 * school's own words from Fee settings), the date the offer is valid until and any note the Admissions Office added.
 */
export async function offerLetterDocument(ctx: AuthContext, applicationId: string, locale: Locale): Promise<LetterDoc> {
  requirePermission(ctx, "admission.read");
  const t = makeT(locale);
  const app = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, include: { offer: true } });
  if (!app || !app.offer) throw notFound("Offer");
  if (app.offer.status === "PENDING_APPROVAL") throw conflict("The offer is waiting for approval, so no letter can be printed yet.");
  const [school, settings, cls, year, issuer, issuerStaff] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, timezone: true, currency: true } }),
    getFeeSettings(db, ctx.schoolId),
    app.offer.classOfferedId ? db.schoolClass.findFirst({ where: { id: app.offer.classOfferedId, schoolId: ctx.schoolId }, select: { name: true } }) : null,
    app.intakeYearId ? db.academicYear.findFirst({ where: { id: app.intakeYearId, schoolId: ctx.schoolId }, select: { name: true } }) : null,
    db.user.findFirst({ where: { id: app.offer.issuedById, schoolId: ctx.schoolId }, select: { fullName: true } }),
    db.staff.findFirst({ where: { userId: app.offer.issuedById, schoolId: ctx.schoolId }, select: { jobTitle: true } }),
  ]);
  const name = [app.firstName, app.middleName, app.lastName].filter(Boolean).join(" ");
  const fee = centsOf(app.offer.feeAmount);
  const lines = [
    t("adm.letter.intro", { name, school: school.name, place: cls ? (year ? t("adm.letter.place", { class: cls.name, year: year.name }) : t("adm.letter.placeNoYear", { class: cls.name })) : "" }).replace(/\s+\./, "."),
    "",
    ...(fee > 0 ? [`1. ${t("adm.letter.fee", { fee: formatMoney(fee, school.currency), words: amountInWords(fee, school.currency, locale) })}`] : [`1. ${t("adm.letter.noFee")}`]),
    ...(fee > 0 && settings.paymentInstructions.trim() ? [`2. ${t("adm.letter.how")}`, ...settings.paymentInstructions.trim().split("\n").map((l) => `   ${l}`)] : []),
    `${fee > 0 && settings.paymentInstructions.trim() ? "3" : "2"}. ${app.offer.expiresOn ? t("adm.letter.valid", { date: longDate(app.offer.expiresOn, locale, "UTC") }) : t("adm.letter.noExpiry")}`,
    ...(fee > 0 ? [`${fee > 0 && settings.paymentInstructions.trim() ? "4" : "3"}. ${t("adm.letter.verify")}`] : []),
    ...(app.offer.notes ? ["", app.offer.notes] : []),
  ];
  const guardian = (app.guardians as { fullName?: string }[])[0]?.fullName;
  return {
    school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    reference: app.offer.letterNo, date: longDate(app.offer.issuedAt, locale, school.timezone),
    to: guardian ? t("adm.letter.toGuardian", { guardian, name }) : t("adm.letter.toParent", { name }), subject: t("adm.letter.subject", { name }), body: lines.join("\n"),
    signer: { name: issuer?.fullName ?? "", title: issuerStaff?.jobTitle ?? null },
  };
}

export async function offerLetterPdf(ctx: AuthContext, applicationId: string, locale: Locale): Promise<Uint8Array> {
  return buildLetterPdf(await offerLetterDocument(ctx, applicationId, locale), letterLabels(locale), await loadLogo(ctx.schoolId));
}

/** The receipt for a verified admission payment (marked void when it was later reversed). The applicant takes the place of the student. */
export async function admissionReceiptDocument(ctx: AuthContext, paymentId: string, locale: Locale): Promise<ReceiptDoc> {
  requireAnyPermission(ctx, ["admission.payment.record", "admission.payment.verify", "admission.read"]);
  const p = await db.admissionPayment.findFirst({ where: { id: paymentId, schoolId: ctx.schoolId }, include: { application: { include: { offer: true } } } });
  if (!p) throw notFound("Receipt");
  if (!p.receiptNo || (p.status !== "VERIFIED" && p.status !== "REVERSED")) throw conflict("A receipt exists only for a verified payment.");
  const t = makeT(locale);
  const [school, all, cls, recorder] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, currency: true } }),
    db.admissionPayment.findMany({ where: { applicationId: p.applicationId, status: { in: ["VERIFIED", "REVERSED"] }, verifiedAt: { not: null } }, orderBy: { verifiedAt: "asc" } }),
    p.application.offer?.classOfferedId ? db.schoolClass.findFirst({ where: { id: p.application.offer.classOfferedId, schoolId: ctx.schoolId }, select: { name: true } }) : null,
    db.user.findFirst({ where: { id: p.recordedById, schoolId: ctx.schoolId }, select: { fullName: true } }),
  ]);
  const required = p.application.offer ? centsOf(p.application.offer.feeAmount) : 0;
  const idx = all.findIndex((x) => x.id === p.id);
  const before = all.slice(0, idx).reduce((n, x) => n + centsOf(x.amount), 0);
  const amount = centsOf(p.amount);
  return {
    number: p.receiptNo, issuedAt: (p.verifiedAt ?? p.recordedAt).toISOString(), school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    student: { name: [p.application.firstName, p.application.middleName, p.application.lastName].filter(Boolean).join(" "), admissionNo: p.application.applicationNo }, payer: p.payerName, currency: school.currency, amountCents: amount,
    method: t(`fin.method.${p.method}` as never), reference: p.reference, receivedOn: formatDateOnly(p.paidOn), creditAddedCents: 0,
    outstandingBeforeCents: Math.max(0, required - before), outstandingAfterCents: Math.max(0, required - before - amount),
    payingFor: [{ number: p.application.offer?.letterNo ?? "", description: t("adm.pay.admissionFee"), amountCents: amount }], className: cls?.name ?? null, receivedBy: recorder?.fullName ?? null,
    amountWords: amountInWords(amount, school.currency, locale), voided: p.status === "REVERSED", voidReason: p.reverseReason,
  };
}

export async function admissionReceiptPdf(ctx: AuthContext, paymentId: string, locale: Locale): Promise<Uint8Array> {
  const t = makeT(locale);
  return buildReceiptPdf(await admissionReceiptDocument(ctx, paymentId, locale), { ...receiptLabels(locale), student: t("adm.applicant"), admissionNo: t("adm.applicationNo") }, await loadLogo(ctx.schoolId));
}
