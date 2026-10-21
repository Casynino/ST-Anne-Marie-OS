import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { conflict, notFound } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { amountInWords } from "@/lib/finance/words";
import { formatDateOnly } from "@/lib/dates";
import { buildApplicationFormPdf, type ApplicationFormDoc } from "@/lib/pdf/application-form";
import { buildReceiptPdf, type ReceiptDoc } from "@/lib/pdf/finance";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { getFeeSettings } from "@/server/fees";
import { draftForDownload } from "@/server/application-fee";
import { receiptLabels } from "@/server/finance-pdf";
import type { StoredForm } from "@/server/online-application";
import { loadLogo } from "@/server/report-card-pdf";

const longDate = (d: Date, locale: Locale, timeZone: string) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(d);

async function schoolOf(schoolId: string) {
  return db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, timezone: true, currency: true } });
}


type Source = {
  p: StoredForm; applicationNo: string | null; reference: string | null; at: Date; docsWhere: { draftId: string } | { applicationId: string };
  draft: Awaited<ReturnType<typeof draftForDownload>> | null;
};

/** What the form is built from: the draft (the family's, or one filled in at the office) or, for any other application, the application's own record. */
async function formSource(ctx: AuthContext, id: string): Promise<Source> {
  const found = await db.applicationDraft.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { id: true } });
  if (found) {
    const draft = await draftForDownload(ctx, id);
    const submitted = draft.status === "SUBMITTED" && !!draft.application;
    const officeUnpaid = ctx.userType === "STAFF" && draft.channel === "OFFICE" && draft.status === "AWAITING_PAYMENT";
    if (!submitted && !officeUnpaid) throw conflict("The application form is available once the application has been submitted.");
    return { p: draft.payload as unknown as StoredForm, applicationNo: draft.application?.applicationNo ?? null, reference: draft.reference, at: draft.paidAt ?? draft.createdAt, docsWhere: { draftId: draft.id }, draft };
  }
  if (ctx.userType !== "STAFF") throw notFound("Application");
  requireAnyPermission(ctx, ["admission.read"]);
  const app = await db.application.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!app) throw notFound("Application");
  const g = app.guardians as { fullName?: string; phone?: string; email?: string; occupation?: string; relationship?: string }[];
  const ec = app.emergencyContact as { name?: string; phone?: string; relationship?: string } | null;
  const p = {
    firstName: app.firstName, middleName: app.middleName ?? undefined, lastName: app.lastName, dateOfBirth: app.dateOfBirth.toISOString(), gender: app.gender, classAppliedId: app.classAppliedId ?? "", entryType: app.entryType as "NEW" | "TRANSFER",
    previousSchool: app.previousSchool ?? undefined, previousClass: app.previousClass ?? undefined, transferReason: app.transferReason ?? undefined, previousAdmissionNo: app.previousAdmissionNo ?? undefined,
    nationality: app.nationality ?? undefined, religion: app.religion ?? undefined, birthCertificateNo: app.birthCertificateNo ?? undefined, address: app.address ?? undefined,
    // Health information is medical: it goes on the printed form only for people allowed to read medical notes.
    healthNotes: ctx.permissions.has("student.medical.read") ? (app.healthNotes ?? undefined) : undefined,
    g1_fullName: g[0]?.fullName ?? "", g1_phone: g[0]?.phone ?? "", g1_email: g[0]?.email, g1_occupation: g[0]?.occupation, g1_relationship: (g[0]?.relationship ?? "OTHER") as StoredForm["g1_relationship"],
    g2_fullName: g[1]?.fullName, g2_phone: g[1]?.phone, g2_email: g[1]?.email, g2_occupation: g[1]?.occupation, g2_relationship: g[1]?.relationship as StoredForm["g2_relationship"],
    ec_name: ec?.name, ec_phone: ec?.phone, ec_relationship: ec?.relationship, consent: true,
  } as StoredForm;
  const linked = await db.applicationDraft.findUnique({ where: { applicationId: app.id }, include: { application: { select: { applicationNo: true, status: true } } } });
  return { p, applicationNo: app.applicationNo, reference: linked?.reference ?? null, at: linked?.paidAt ?? app.createdAt, docsWhere: { applicationId: app.id }, draft: linked };
}

/** The application as entered (online by the family, or at the office), with its number and the fee that was paid or is still to pay. Printable before the fee is paid only for applications filled in at the office. */
export async function applicationFormDocument(ctx: AuthContext, id: string, locale: Locale): Promise<ApplicationFormDoc> {
  const src = await formSource(ctx, id);
  const draft = src.draft;
  const t = makeT(locale);
  const p = src.p;
  const [school, cls, policy, files] = await Promise.all([
    schoolOf(ctx.schoolId),
    db.schoolClass.findFirst({ where: { id: p.classAppliedId, schoolId: ctx.schoolId }, select: { name: true } }),
    getAdmissionPolicy(db, ctx.schoolId),
    db.document.findMany({ where: { schoolId: ctx.schoolId, deletedAt: null, ...src.docsWhere }, orderBy: { createdAt: "asc" }, select: { docType: true, fileName: true, mimeType: true, storageKey: true } }),
  ]);
  // The photo goes onto the form when it is a JPEG or PNG; the file list always names everything that was added.
  const photoDoc = files.find((x) => x.docType === "PASSPORT_PHOTO" && (x.mimeType === "image/jpeg" || x.mimeType === "image/png"));
  const photoBytes = photoDoc ? await getStorage()?.get(photoDoc.storageKey).catch(() => null) : null;
  const rel = (r: string) => t(`student.rel.${r}` as "student.rel.FATHER");
  const owed = draft && draft.status === "AWAITING_PAYMENT" ? await getFeeSettings(db, ctx.schoolId) : null;
  const fee = draft?.paidAt && draft.receiptNo ? { amount: formatMoney(centsOf(draft.paidAmount ?? draft.feeAmount), school.currency), paidOn: longDate(draft.paidAt, locale, school.timezone), reference: draft.reference, receiptNo: draft.receiptNo, test: draft.paymentProvider === "sandbox" } : null;
  return {
    school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    applicationNo: src.applicationNo ?? src.reference ?? "", submittedOn: longDate(src.at, locale, school.timezone), className: cls?.name ?? null,
    child: { entry: t(p.entryType === "TRANSFER" ? "apply.entry.transfer" : "apply.entry.new"), transferReason: p.entryType === "TRANSFER" ? (p.transferReason ?? null) : null, previousAdmissionNo: p.entryType === "TRANSFER" ? (p.previousAdmissionNo ?? null) : null, name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), dateOfBirth: longDate(new Date(p.dateOfBirth), locale, "UTC"), gender: t(p.gender === "MALE" ? "student.male" : "student.female"), nationality: p.nationality ?? null, religion: p.religion ?? null, birthCertificateNo: p.birthCertificateNo ?? null, previousSchool: p.previousSchool ?? null, previousClass: p.previousClass ?? null, address: p.address ?? null, healthNotes: p.healthNotes ?? null },
    photo: photoDoc && photoBytes ? { bytes: new Uint8Array(photoBytes), type: photoDoc.mimeType === "image/png" ? "png" : "jpg" } : null,
    emergency: p.ec_name && p.ec_phone ? { name: p.ec_name, relationship: p.ec_relationship ?? "", phone: p.ec_phone } : null,
    files: files.map((x) => ({ label: t(x.docType === "PASSPORT_PHOTO" ? "apf.pdf.photoAdded" : (`doc.type.${x.docType}` as "doc.type.OTHER")), fileName: x.fileName })),
    guardians: [
      { name: p.g1_fullName, relationship: rel(p.g1_relationship), phone: p.g1_phone, email: p.g1_email ?? null, occupation: p.g1_occupation ?? null },
      ...(p.g2_fullName ? [{ name: p.g2_fullName, relationship: p.g2_relationship ? rel(p.g2_relationship) : "", phone: p.g2_phone ?? "", email: p.g2_email ?? null, occupation: p.g2_occupation ?? null }] : []),
    ],
    fee,
    pay: draft && owed ? { amount: formatMoney(centsOf(draft.feeAmount), school.currency), reference: draft.reference, instructions: owed.paymentInstructions.trim() || null } : null,
    documents: policy.requiredDocTypes.map((d) => t(`doc.type.${d}` as "doc.type.BIRTH_CERTIFICATE")),
  };
}

export function applicationFormLabels(locale: Locale) {
  const t = makeT(locale);
  return {
    title: t("apf.pdf.title"), applicationNo: t("adm.applicationNo"), submitted: t("apf.pdf.submitted"), classApplied: t("apply.class"), child: t("apply.child"), name: t("apf.pdf.name"), dateOfBirth: t("student.dob"), gender: t("student.gender"),
    nationality: t("student.nationality"), previousSchool: t("student.previousSchool"), address: t("common.address"), guardians: t("apply.guardian"), relationship: t("apply.relationship"), phone: t("common.phone"), email: t("common.email"),
    entry: t("apply.entry.title"), transferReason: t("apply.transfer.reason"), previousAdmissionNo: t("apply.transfer.admissionNo"),
    religion: t("apf.pdf.religion"), birthCert: t("apf.pdf.birthCert"), previousClass: t("apf.pdf.previousClass"), health: t("apf.pdf.health"), occupation: t("apf.pdf.occupation"), emergency: t("apf.pdf.emergency"), guardian2: t("apf.pdf.guardian2"), files: t("apf.pdf.files"),
    fee: t("apf.pdf.fee"), amountPaid: t("apf.pdf.amountPaid"), paidOn: t("apf.pdf.paidOn"), reference: t("fin.pdf.reference"), receiptNo: t("fin.pdf.receiptNo"), testNote: t("apf.pdf.testNote"),
    documents: t("apf.pdf.documents"), documentsIntro: t("apf.pdf.documentsIntro"), consent: t("apf.pdf.consent"), keep: t("apf.pdf.keep"),
    payTitle: t("apf.pdf.payTitle"), payAmount: t("apf.pdf.payAmount"), payHow: t("apf.pdf.payHow"), payBring: t("apf.pdf.payBring"), notSubmitted: t("apf.pdf.notSubmitted"), signGuardian: t("apf.pdf.signGuardian"), signOffice: t("apf.pdf.signOffice"),
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
  const receiver = draft.paymentRecordedById ? await db.user.findFirst({ where: { id: draft.paymentRecordedById, schoolId: ctx.schoolId }, select: { fullName: true } }) : null;
  return {
    number: draft.receiptNo, issuedAt: draft.paidAt.toISOString(), school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    student: { name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), admissionNo: draft.application?.applicationNo ?? draft.reference }, payer: p.g1_fullName, currency: school.currency, amountCents: amount,
    method: test ? t("apf.pdf.testMethod") : t(`fin.method.${(draft.paymentMethod ?? "MOBILE_MONEY") as "MOBILE_MONEY"}`), reference: draft.reference, receivedOn: formatDateOnly(draft.paidAt), creditAddedCents: 0, outstandingBeforeCents: 0, outstandingAfterCents: 0,
    payingFor: [{ number: draft.reference, description: t("apf.pdf.feeFor"), amountCents: amount }], className: cls?.name ?? null, receivedBy: receiver?.fullName ?? null, amountWords: amountInWords(amount, school.currency, locale), voided: false, voidReason: null,
  };
}

export async function applicationReceiptPdf(ctx: AuthContext, draftId: string, locale: Locale): Promise<Uint8Array> {
  const t = makeT(locale);
  return buildReceiptPdf(await applicationReceiptDocument(ctx, draftId, locale), { ...receiptLabels(locale), student: t("adm.applicant"), admissionNo: t("adm.applicationNo") }, await loadLogo(ctx.schoolId));
}
