import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import { centsOf } from "@/lib/finance/money";
import { amountInWords } from "@/lib/finance/words";
import { formatDateOnly } from "@/lib/dates";
import { buildInvoicePdf, buildReceiptPdf, type InvoiceDoc, type InvoiceLabels, type ReceiptDoc, type ReceiptLabels } from "@/lib/pdf/finance";
import { loadStudentFinance } from "@/server/balances";
import { getFeeSettings } from "@/server/fees";
import type { ReceiptSnapshot } from "@/server/payments";
import { loadLogo } from "@/server/report-card-pdf";

const methodLabel = (locale: Locale, m: string) => makeT(locale)(`fin.method.${m}` as never);

export function receiptLabels(locale: Locale): ReceiptLabels {
  const t = makeT(locale);
  return {
    title: t("fin.pdf.receipt"), number: t("fin.pdf.receiptNo"), date: t("fin.pdf.date"), receivedFrom: t("fin.pdf.receivedFrom"), student: t("rc.student"), admissionNo: t("rc.admissionNo"), class: t("rc.class"), sumOf: t("fin.pdf.sumOf"),
    amount: t("fin.pdf.amountReceived"), method: t("fin.pdf.method"), reference: t("fin.pdf.reference"), payingFor: t("fin.pdf.payingFor"), credit: t("fin.pdf.credit"), before: t("fin.pdf.balanceBefore"), after: t("fin.pdf.balanceAfter"),
    receivedBy: t("fin.pdf.receivedBy"), signature: t("fin.pdf.signature"), stamp: t("rc.stamp"), void: t("fin.pdf.void"), thanks: t("fin.pdf.thanksFull"), more: t("fin.pdf.more"),
  };
}

export function invoiceLabels(locale: Locale): InvoiceLabels {
  const t = makeT(locale);
  return {
    title: t("fin.pdf.invoice"), number: t("fin.pdf.invoiceNo"), issued: t("fin.pdf.issued"), due: t("fin.pdf.due"), billTo: t("fin.pdf.billTo"), student: t("rc.student"), admissionNo: t("rc.admissionNo"), class: t("rc.class"), term: t("rc.term"),
    description: t("fin.pdf.description"), amount: t("fin.pdf.amount"), subtotal: t("fin.pdf.subtotal"), discounts: t("fin.pdf.discounts"), total: t("fin.pdf.total"), paid: t("fin.pdf.paid"), outstanding: t("fin.pdf.outstanding"),
    schedule: t("fin.pdf.schedule"), instalmentDue: t("fin.pdf.instalmentDue"), instalmentPaid: t("fin.pdf.instalmentPaid"), howToPay: t("fin.pdf.howToPay"), void: t("fin.pdf.void"), credit: t("fin.pdf.credit"),
  };
}

/**
 * The receipt document. The stored receipt (`snap`) is never changed; what a printed receipt adds is looked up here: the student's class on the
 * day of payment, a plain description of each invoice paid, the person who received the money, and the amount in words.
 */
export async function receiptDocument(schoolId: string, snap: ReceiptSnapshot, voided: { reason: string | null } | null, locale: Locale): Promise<ReceiptDoc> {
  const t = makeT(locale);
  const day = new Date(`${snap.receivedOn}T00:00:00Z`);
  const [enrolment, invoices, receipt] = await Promise.all([
    db.studentEnrollment.findFirst({
      where: { schoolId, studentId: snap.student.id, startedOn: { lte: day }, OR: [{ endedOn: null }, { endedOn: { gt: day } }] },
      orderBy: { startedOn: "desc" }, select: { class: { select: { name: true } }, stream: { select: { name: true } } },
    }),
    snap.appliedTo.length ? db.invoice.findMany({ where: { schoolId, studentId: snap.student.id, number: { in: snap.appliedTo.map((a) => a.number) } }, select: { number: true, type: true, termId: true, lines: { where: { kind: "CHARGE" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { description: true } } } }) : [],
    db.receipt.findFirst({ where: { schoolId, number: snap.number }, select: { issuedById: true } }),
  ]);
  const termIds = [...new Set(invoices.map((i) => i.termId).filter((x): x is string => !!x))];
  const [terms, recorder] = await Promise.all([
    termIds.length ? db.term.findMany({ where: { id: { in: termIds } }, select: { id: true, name: true } }) : [],
    receipt?.issuedById ? db.user.findFirst({ where: { id: receipt.issuedById, schoolId }, select: { fullName: true } }) : null,
  ]);
  const termName = new Map(terms.map((x) => [x.id, x.name]));
  const describe = (number: string) => {
    const inv = invoices.find((i) => i.number === number);
    if (!inv) return "";
    if (inv.type === "TERM_FEES") return [t("fin.pdf.schoolFees"), inv.termId ? termName.get(inv.termId) : null].filter(Boolean).join(" - ");
    return inv.lines[0]?.description ?? "";
  };
  const className = enrolment ? [enrolment.class.name, enrolment.stream?.name].filter(Boolean).join(" ") : null;
  return {
    ...snap, method: [methodLabel(locale, snap.method), snap.provider].filter(Boolean).join(" - "), voided: !!voided, voidReason: voided?.reason ?? null,
    payingFor: snap.appliedTo.map((a) => ({ number: a.number, description: describe(a.number), amountCents: a.amountCents })),
    className, receivedBy: recorder?.fullName ?? null, amountWords: amountInWords(snap.amountCents, snap.currency, locale),
  };
}

export async function receiptPdf(schoolId: string, snap: ReceiptSnapshot, voided: { reason: string | null } | null, locale: Locale): Promise<Uint8Array> {
  return buildReceiptPdf(await receiptDocument(schoolId, snap, voided, locale), receiptLabels(locale), await loadLogo(schoolId));
}

/** The invoice document. The caller has already checked that the viewer may see this invoice. */
export async function invoiceDocument(schoolId: string, invoiceId: string): Promise<InvoiceDoc> {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, schoolId }, include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } });
  if (!inv) throw notFound("Invoice");
  const [student, school, settings, term, cls, fin] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: inv.studentId }, select: { firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, currency: true } }),
    getFeeSettings(db, schoolId),
    inv.termId ? db.term.findUnique({ where: { id: inv.termId }, select: { name: true } }) : null,
    inv.classId ? db.schoolClass.findUnique({ where: { id: inv.classId }, select: { name: true } }) : null,
    inv.status === "ISSUED" ? loadStudentFinance(db, schoolId, inv.studentId) : null,
  ]);
  const b = fin?.ledger.invoices.get(inv.id);
  const total = inv.lines.reduce((n, l) => n + (l.kind === "CHARGE" ? centsOf(l.amount) : -centsOf(l.amount)), 0);
  return {
    number: inv.number, issueDate: formatDateOnly(inv.issueDate), dueDate: formatDateOnly(inv.dueDate), school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    student: { name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "), admissionNo: student.admissionNo }, className: cls?.name ?? null, termName: term?.name ?? null, currency: school.currency,
    lines: inv.lines.map((l) => ({ description: l.description, kind: l.kind, amountCents: centsOf(l.amount) })), totalCents: total, paidCents: b?.paid ?? 0, outstandingCents: b?.outstanding ?? total,
    schedule: (b?.schedule ?? []).map((s) => ({ dueDate: s.dueDate, amountCents: s.amount, paidCents: s.paid })), paymentInstructions: settings.paymentInstructions, voided: inv.status === "VOID", voidReason: inv.voidReason,
  };
}

export async function invoicePdf(schoolId: string, invoiceId: string, locale: Locale): Promise<Uint8Array> {
  return buildInvoicePdf(await invoiceDocument(schoolId, invoiceId), invoiceLabels(locale), await loadLogo(schoolId));
}
