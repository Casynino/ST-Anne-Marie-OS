import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { conflict } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import type { AuthContext } from "@/lib/auth/context";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { amountInWords } from "@/lib/finance/words";
import { formatDateOnly } from "@/lib/dates";
import { buildApplicationFormPdf, type ApplicationFormDoc } from "@/lib/pdf/application-form";
import { buildReceiptPdf, type ReceiptDoc } from "@/lib/pdf/finance";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { draftForDownload } from "@/server/application-fee";
import { receiptLabels } from "@/server/finance-pdf";
import type { StoredForm } from "@/server/online-application";
import { loadLogo } from "@/server/report-card-pdf";

const longDate = (d: Date, locale: Locale, timeZone: string) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(d);

async function schoolOf(schoolId: string) {
  return db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, timezone: true, currency: true } });
}

/** The online application as the family entered it, with its number and the fee that was paid. Available once the application has been submitted. */
export async function applicationFormDocument(ctx: AuthContext, draftId: string, locale: Locale): Promise<ApplicationFormDoc> {
  const draft = await draftForDownload(ctx, draftId);
  if (draft.status !== "SUBMITTED" || !draft.application) throw conflict("The application form is available once the application has been submitted.");
  const t = makeT(locale);
  const p = draft.payload as unknown as StoredForm;
  const [school, cls, policy, files] = await Promise.all([
    schoolOf(ctx.schoolId),
    db.schoolClass.findFirst({ where: { id: p.classAppliedId, schoolId: ctx.schoolId }, select: { name: true } }),
    getAdmissionPolicy(db, ctx.schoolId),
    db.document.findMany({ where: { schoolId: ctx.schoolId, draftId: draft.id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { docType: true, fileName: true, mimeType: true, storageKey: true } }),
  ]);
  // The photo goes onto the form when it is a JPEG or PNG; the file list always names everything that was added.
  const photoDoc = files.find((x) => x.docType === "PASSPORT_PHOTO" && (x.mimeType === "image/jpeg" || x.mimeType === "image/png"));
  const photoBytes = photoDoc ? await getStorage()?.get(photoDoc.storageKey).catch(() => null) : null;
  const rel = (r: string) => t(`student.rel.${r}` as "student.rel.FATHER");
  const fee = draft.paidAt && draft.receiptNo ? { amount: formatMoney(centsOf(draft.paidAmount ?? draft.feeAmount), school.currency), paidOn: longDate(draft.paidAt, locale, school.timezone), reference: draft.reference, receiptNo: draft.receiptNo, test: draft.paymentProvider === "sandbox" } : null;
  return {
    school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    applicationNo: draft.application.applicationNo, submittedOn: longDate(draft.paidAt ?? draft.createdAt, locale, school.timezone), className: cls?.name ?? null,
    child: { name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), dateOfBirth: longDate(new Date(p.dateOfBirth), locale, "UTC"), gender: t(p.gender === "MALE" ? "student.male" : "student.female"), nationality: p.nationality ?? null, religion: p.religion ?? null, birthCertificateNo: p.birthCertificateNo ?? null, previousSchool: p.previousSchool ?? null, previousClass: p.previousClass ?? null, address: p.address ?? null, healthNotes: p.healthNotes ?? null },
    photo: photoDoc && photoBytes ? { bytes: new Uint8Array(photoBytes), type: photoDoc.mimeType === "image/png" ? "png" : "jpg" } : null,
    emergency: p.ec_name && p.ec_phone ? { name: p.ec_name, relationship: p.ec_relationship ?? "", phone: p.ec_phone } : null,
    files: files.map((x) => ({ label: t(x.docType === "PASSPORT_PHOTO" ? "apf.pdf.photoAdded" : (`doc.type.${x.docType}` as "doc.type.OTHER")), fileName: x.fileName })),
    guardians: [
      { name: p.g1_fullName, relationship: rel(p.g1_relationship), phone: p.g1_phone, email: p.g1_email ?? null, occupation: p.g1_occupation ?? null },
      ...(p.g2_fullName ? [{ name: p.g2_fullName, relationship: p.g2_relationship ? rel(p.g2_relationship) : "", phone: p.g2_phone ?? "", email: p.g2_email ?? null, occupation: p.g2_occupation ?? null }] : []),
    ],
    fee, documents: policy.requiredDocTypes.map((d) => t(`doc.type.${d}` as "doc.type.BIRTH_CERTIFICATE")),
  };
}

export function applicationFormLabels(locale: Locale) {
  const t = makeT(locale);
  return {
    title: t("apf.pdf.title"), applicationNo: t("adm.applicationNo"), submitted: t("apf.pdf.submitted"), classApplied: t("apply.class"), child: t("apply.child"), name: t("apf.pdf.name"), dateOfBirth: t("student.dob"), gender: t("student.gender"),
    nationality: t("student.nationality"), previousSchool: t("student.previousSchool"), address: t("common.address"), guardians: t("apply.guardian"), relationship: t("apply.relationship"), phone: t("common.phone"), email: t("common.email"),
    religion: t("apf.pdf.religion"), birthCert: t("apf.pdf.birthCert"), previousClass: t("apf.pdf.previousClass"), health: t("apf.pdf.health"), occupation: t("apf.pdf.occupation"), emergency: t("apf.pdf.emergency"), guardian2: t("apf.pdf.guardian2"), files: t("apf.pdf.files"),
    fee: t("apf.pdf.fee"), amountPaid: t("apf.pdf.amountPaid"), paidOn: t("apf.pdf.paidOn"), reference: t("fin.pdf.reference"), receiptNo: t("fin.pdf.receiptNo"), testNote: t("apf.pdf.testNote"),
    documents: t("apf.pdf.documents"), documentsIntro: t("apf.pdf.documentsIntro"), consent: t("apf.pdf.consent"), keep: t("apf.pdf.keep"),
  };
}

export async function applicationFormPdf(ctx: AuthContext, draftId: string, locale: Locale): Promise<Uint8Array> {
  return buildApplicationFormPdf(await applicationFormDocument(ctx, draftId, locale), applicationFormLabels(locale), await loadLogo(ctx.schoolId));
}

/** The receipt for an online application fee the provider confirmed. */
export async function applicationReceiptDocument(ctx: AuthContext, draftId: string, locale: Locale): Promise<ReceiptDoc> {
  const draft = await draftForDownload(ctx, draftId);
  if (!draft.paidAt || !draft.receiptNo || !draft.paidAmount) throw conflict("A receipt exists only for a fee that has been paid.");
  const t = makeT(locale);
  const p = draft.payload as unknown as StoredForm;
  const [school, cls] = await Promise.all([schoolOf(ctx.schoolId), db.schoolClass.findFirst({ where: { id: p.classAppliedId, schoolId: ctx.schoolId }, select: { name: true } })]);
  const amount = centsOf(draft.paidAmount);
  const test = draft.paymentProvider === "sandbox";
  return {
    number: draft.receiptNo, issuedAt: draft.paidAt.toISOString(), school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    student: { name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), admissionNo: draft.application?.applicationNo ?? draft.reference }, payer: p.g1_fullName, currency: school.currency, amountCents: amount,
    method: test ? t("apf.pdf.testMethod") : t("fin.method.MOBILE_MONEY"), reference: draft.reference, receivedOn: formatDateOnly(draft.paidAt), creditAddedCents: 0, outstandingBeforeCents: 0, outstandingAfterCents: 0,
    payingFor: [{ number: draft.reference, description: t("apf.pdf.feeFor"), amountCents: amount }], className: cls?.name ?? null, receivedBy: null, amountWords: amountInWords(amount, school.currency, locale), voided: false, voidReason: null,
  };
}

export async function applicationReceiptPdf(ctx: AuthContext, draftId: string, locale: Locale): Promise<Uint8Array> {
  const t = makeT(locale);
  return buildReceiptPdf(await applicationReceiptDocument(ctx, draftId, locale), { ...receiptLabels(locale), student: t("adm.applicant"), admissionNo: t("adm.applicationNo") }, await loadLogo(ctx.schoolId));
}
