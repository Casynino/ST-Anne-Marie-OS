import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { formatMoney } from "@/lib/finance/money";
import { GREEN, INK, LINE, MUTED, RED, TINT, draw, watermark, wrap, type Fonts } from "@/lib/pdf/common";

export type SchoolHeader = { name: string; motto: string | null; address: string | null; phone: string | null; email: string | null };
export type PdfLogo = { bytes: Uint8Array; type: "png" | "jpg" };

export type ReceiptDoc = {
  number: string; issuedAt: string; school: SchoolHeader; student: { name: string; admissionNo: string }; payer: string | null; currency: string; amountCents: number;
  method: string; reference: string | null; receivedOn: string; appliedTo: { number: string; amountCents: number }[]; creditAddedCents: number; outstandingBeforeCents: number; outstandingAfterCents: number;
  voided: boolean; voidReason: string | null;
};
export type ReceiptLabels = {
  title: string; number: string; date: string; receivedFrom: string; student: string; admissionNo: string; amount: string; method: string; reference: string; appliedTo: string; credit: string;
  before: string; after: string; receivedBy: string; stamp: string; void: string; thanks: string;
};

export type InvoiceDoc = {
  number: string; issueDate: string; dueDate: string; school: SchoolHeader; student: { name: string; admissionNo: string }; className: string | null; termName: string | null; currency: string;
  lines: { description: string; kind: "CHARGE" | "DISCOUNT"; amountCents: number }[]; totalCents: number; paidCents: number; outstandingCents: number;
  schedule: { dueDate: string; amountCents: number; paidCents: number }[]; paymentInstructions: string; voided: boolean; voidReason: string | null;
};
export type InvoiceLabels = {
  title: string; number: string; issued: string; due: string; billTo: string; student: string; admissionNo: string; class: string; term: string; description: string; amount: string; subtotal: string; discounts: string;
  total: string; paid: string; outstanding: string; schedule: string; instalmentDue: string; instalmentPaid: string; howToPay: string; void: string; credit: string;
};

function header(page: PDFPage, f: Fonts, school: SchoolHeader, logo: PDFImage | null, M: number, W: number, top: number): number {
  const textLeft = logo ? M + 50 : M;
  const width = M + W - textLeft;
  if (logo) {
    const s = Math.min(42 / logo.width, 42 / logo.height);
    page.drawImage(logo, { x: M, y: top - logo.height * s, width: logo.width * s, height: logo.height * s });
  }
  draw(page, school.name.toUpperCase(), textLeft, top - 12, { font: f.bold, size: 13, color: GREEN, align: "center", width });
  let y = top - 25;
  if (school.motto) { draw(page, school.motto, textLeft, y, { font: f.italic, size: 8, color: MUTED, align: "center", width }); y -= 10; }
  const contact = [school.address, school.phone, school.email].filter(Boolean).join("  |  ");
  if (contact) { draw(page, contact, textLeft, y, { font: f.regular, size: 7.5, color: MUTED, align: "center", width }); y -= 10; }
  y = (logo ? Math.min(y, top - 48) : y) - 4;
  page.drawRectangle({ x: M, y, width: W, height: 1.5, color: GREEN });
  return y - 6;
}

const A5: [number, number] = [419.53, 595.28];
const A4: [number, number] = [595.28, 841.89];

export function renderReceipt(pdf: PDFDocument, f: Fonts, r: ReceiptDoc, L: ReceiptLabels, logo: PDFImage | null) {
  const page = pdf.addPage(A5);
  const M = 30;
  const W = A5[0] - 2 * M;
  let y = header(page, f, r.school, logo, M, W, A5[1] - M) - 16;
  draw(page, L.title.toUpperCase(), M, y, { font: f.bold, size: 12, align: "center", width: W });
  y -= 22;
  const row = (label: string, value: string, bold = false) => {
    draw(page, label, M, y, { font: f.regular, size: 8.5, color: MUTED });
    draw(page, value, M + 92, y, { font: bold ? f.bold : f.regular, size: 9.5 });
    y -= 15;
  };
  row(L.number, r.number, true);
  row(L.date, r.receivedOn);
  row(L.student, r.student.name, true);
  row(L.admissionNo, r.student.admissionNo);
  if (r.payer) row(L.receivedFrom, r.payer);
  row(L.method, r.method);
  if (r.reference) row(L.reference, r.reference);
  y -= 18; // the amount box rises 26pt above this baseline: keep it clear of the last row
  page.drawRectangle({ x: M, y: y - 14, width: W, height: 40, color: TINT });
  draw(page, L.amount, M + 10, y + 12, { font: f.regular, size: 8.5, color: MUTED });
  draw(page, formatMoney(r.amountCents, r.currency), M + 10, y - 8, { font: f.bold, size: 18, color: GREEN });
  y -= 36;
  if (r.appliedTo.length || r.creditAddedCents > 0) {
    draw(page, L.appliedTo.toUpperCase(), M, y, { font: f.bold, size: 8, color: GREEN });
    y -= 13;
    for (const a of r.appliedTo) {
      draw(page, a.number, M, y, { font: f.regular, size: 9 });
      draw(page, formatMoney(a.amountCents, r.currency), M, y, { font: f.regular, size: 9, align: "right", width: W });
      y -= 12;
    }
    if (r.creditAddedCents > 0) {
      draw(page, L.credit, M, y, { font: f.regular, size: 9 });
      draw(page, formatMoney(r.creditAddedCents, r.currency), M, y, { font: f.regular, size: 9, align: "right", width: W });
      y -= 12;
    }
    y -= 6;
  }
  page.drawRectangle({ x: M, y: y + 10, width: W, height: 0.6, color: LINE });
  draw(page, `${L.before}: ${formatMoney(r.outstandingBeforeCents, r.currency)}`, M, y - 4, { font: f.regular, size: 9 });
  draw(page, `${L.after}: ${formatMoney(r.outstandingAfterCents, r.currency)}`, M, y - 4, { font: f.bold, size: 9.5, align: "right", width: W });
  y -= 50;
  page.drawRectangle({ x: M, y, width: 150, height: 0.7, color: INK });
  draw(page, L.receivedBy, M, y - 10, { font: f.regular, size: 8, color: MUTED });
  page.drawRectangle({ x: A5[0] - M - 70, y: y - 14, width: 70, height: 50, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
  draw(page, L.stamp, A5[0] - M - 70, y + 4, { font: f.regular, size: 7.5, color: MUTED, align: "center", width: 70 });
  draw(page, L.thanks, M, M - 8, { font: f.italic, size: 8, color: MUTED, align: "center", width: W });
  if (r.voided) {
    watermark(page, f.bold, L.void);
    if (r.voidReason) for (const [i, ln] of wrap(r.voidReason, f.regular, 8, W).slice(0, 2).entries()) draw(page, ln, M, M + 8 - i * 10, { font: f.regular, size: 8, color: RED });
  }
}

export function renderInvoice(pdf: PDFDocument, f: Fonts, inv: InvoiceDoc, L: InvoiceLabels, logo: PDFImage | null) {
  const page = pdf.addPage(A4);
  const M = 40;
  const W = A4[0] - 2 * M;
  let y = header(page, f, inv.school, logo, M, W, A4[1] - M) - 18;
  draw(page, L.title.toUpperCase(), M, y, { font: f.bold, size: 15, color: INK });
  draw(page, inv.number, M, y, { font: f.bold, size: 12, color: GREEN, align: "right", width: W });
  y -= 18;
  draw(page, `${L.issued}: ${inv.issueDate}     ${L.due}: ${inv.dueDate}`, M, y, { font: f.regular, size: 9, color: MUTED, align: "right", width: W });
  y -= 22;
  page.drawRectangle({ x: M, y: y - 36, width: W, height: 52, color: TINT });
  draw(page, L.billTo.toUpperCase(), M + 10, y + 5, { font: f.bold, size: 7.5, color: GREEN });
  draw(page, inv.student.name, M + 10, y - 9, { font: f.bold, size: 11 });
  draw(page, `${L.admissionNo}: ${inv.student.admissionNo}${inv.className ? `   ${L.class}: ${inv.className}` : ""}${inv.termName ? `   ${L.term}: ${inv.termName}` : ""}`, M + 10, y - 24, { font: f.regular, size: 8.5, color: MUTED });
  y -= 56;

  page.drawRectangle({ x: M, y: y - 4, width: W, height: 16, color: GREEN });
  draw(page, L.description, M + 6, y, { font: f.bold, size: 8.5, color: rgb(1, 1, 1) });
  draw(page, L.amount, M, y, { font: f.bold, size: 8.5, color: rgb(1, 1, 1), align: "right", width: W - 6 });
  y -= 4;
  const rowH = inv.lines.length > 18 ? 13 : 16;
  inv.lines.forEach((l, i) => {
    y -= rowH;
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: rgb(0.975, 0.985, 0.98) });
    draw(page, l.description, M + 6, y, { font: f.regular, size: 9, color: l.kind === "DISCOUNT" ? GREEN : INK });
    draw(page, `${l.kind === "DISCOUNT" ? "-" : ""}${formatMoney(l.amountCents, inv.currency)}`, M, y, { font: f.regular, size: 9, color: l.kind === "DISCOUNT" ? GREEN : INK, align: "right", width: W - 6 });
  });
  y -= 14;
  const charges = inv.lines.filter((l) => l.kind === "CHARGE").reduce((n, l) => n + l.amountCents, 0);
  const discounts = inv.lines.filter((l) => l.kind === "DISCOUNT").reduce((n, l) => n + l.amountCents, 0);
  const total = (label: string, value: string, o: { bold?: boolean } = {}) => {
    draw(page, label, M, y, { font: o.bold ? f.bold : f.regular, size: o.bold ? 10.5 : 9, align: "right", width: W - 120 });
    draw(page, value, M, y, { font: o.bold ? f.bold : f.regular, size: o.bold ? 10.5 : 9, align: "right", width: W - 6 });
    y -= o.bold ? 17 : 14;
  };
  if (discounts > 0) { total(L.subtotal, formatMoney(charges, inv.currency)); total(L.discounts, `-${formatMoney(discounts, inv.currency)}`); }
  total(L.total, formatMoney(inv.totalCents, inv.currency), { bold: true });
  total(L.paid, formatMoney(inv.paidCents, inv.currency));
  page.drawRectangle({ x: M + W - 220, y: y + 10, width: 220, height: 0.6, color: LINE });
  y -= 2;
  total(L.outstanding, formatMoney(inv.outstandingCents, inv.currency), { bold: true });
  y -= 6;
  if (inv.schedule.length > 1) {
    draw(page, L.schedule.toUpperCase(), M, y, { font: f.bold, size: 8, color: GREEN });
    y -= 13;
    for (const s of inv.schedule) {
      draw(page, `${L.instalmentDue} ${s.dueDate}`, M, y, { font: f.regular, size: 9 });
      draw(page, `${formatMoney(s.amountCents, inv.currency)}   (${L.instalmentPaid}: ${formatMoney(s.paidCents, inv.currency)})`, M, y, { font: f.regular, size: 9, align: "right", width: W });
      y -= 12;
    }
    y -= 8;
  }
  if (inv.paymentInstructions.trim()) {
    draw(page, L.howToPay.toUpperCase(), M, y, { font: f.bold, size: 8, color: GREEN });
    y -= 12;
    for (const ln of wrap(inv.paymentInstructions, f.regular, 9, W).slice(0, 8)) { draw(page, ln, M, y, { font: f.regular, size: 9 }); y -= 11; }
  }
  if (inv.voided) {
    watermark(page, f.bold, L.void);
    if (inv.voidReason) draw(page, inv.voidReason, M, M, { font: f.regular, size: 8.5, color: RED });
  }
}

async function fonts(pdf: PDFDocument): Promise<Fonts> {
  return { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
}
async function logoOf(pdf: PDFDocument, logo?: PdfLogo | null): Promise<PDFImage | null> {
  if (!logo) return null;
  try { return logo.type === "png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes); } catch { return null; }
}

export async function buildReceiptPdf(r: ReceiptDoc, L: ReceiptLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Receipt ${r.number}`);
  renderReceipt(pdf, await fonts(pdf), r, L, await logoOf(pdf, logo));
  return pdf.save();
}
export async function buildInvoicePdf(i: InvoiceDoc, L: InvoiceLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${i.number}`);
  renderInvoice(pdf, await fonts(pdf), i, L, await logoOf(pdf, logo));
  return pdf.save();
}
