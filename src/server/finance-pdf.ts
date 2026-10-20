import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import { centsOf } from "@/lib/finance/money";
import { formatDateOnly } from "@/lib/dates";
import { buildInvoicePdf, buildReceiptPdf, type InvoiceDoc, type InvoiceLabels, type ReceiptLabels } from "@/lib/pdf/finance";
import { loadStudentFinance } from "@/server/balances";
import { getFeeSettings } from "@/server/fees";
import type { ReceiptSnapshot } from "@/server/payments";
import { loadLogo } from "@/server/report-card-pdf";

const methodLabel = (locale: Locale, m: string) => makeT(locale)(`fin.method.${m}` as never);

export function receiptLabels(locale: Locale): ReceiptLabels {
  const t = makeT(locale);
  return {
    title: t("fin.pdf.receipt"), number: t("fin.pdf.receiptNo"), date: t("fin.pdf.date"), receivedFrom: t("fin.pdf.receivedFrom"), student: t("rc.student"), admissionNo: t("rc.admissionNo"), amount: t("fin.pdf.amountReceived"),
    method: t("fin.pdf.method"), reference: t("fin.pdf.reference"), appliedTo: t("fin.pdf.appliedTo"), credit: t("fin.pdf.credit"), before: t("fin.pdf.balanceBefore"), after: t("fin.pdf.balanceAfter"),
    receivedBy: t("fin.pdf.receivedBy"), stamp: t("rc.stamp"), void: t("fin.pdf.void"), thanks: t("fin.pdf.thanks"),
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

export async function receiptPdf(schoolId: string, snap: ReceiptSnapshot, voided: { reason: string | null } | null, locale: Locale): Promise<Uint8Array> {
  return buildReceiptPdf(
    { ...snap, method: methodLabel(locale, snap.method), voided: !!voided, voidReason: voided?.reason ?? null },
    receiptLabels(locale), await loadLogo(schoolId),
  );
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
