import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatMoney } from "@/lib/finance/money";
import { GREEN, INK, LINE, MUTED, RED, TINT, clean, draw, watermark, wrap, type Fonts } from "@/lib/pdf/common";

export type SchoolHeader = { name: string; motto: string | null; address: string | null; phone: string | null; email: string | null };
export type PdfLogo = { bytes: Uint8Array; type: "png" | "jpg" };

export type ReceiptDoc = {
  number: string; issuedAt: string; school: SchoolHeader; student: { name: string; admissionNo: string }; payer: string | null; currency: string; amountCents: number;
  method: string; reference: string | null; receivedOn: string; creditAddedCents: number; outstandingBeforeCents: number; outstandingAfterCents: number;
  /** What the money paid for: the invoice number, a plain description (for example "School fees - Term 2") and the part of this payment applied to it. */
  payingFor: { number: string; description: string; amountCents: number }[];
  /** Looked up when the receipt is printed (the stored receipt is never changed): class at the date of payment, the person who received the money, the amount in words. */
  className: string | null; receivedBy: string | null; amountWords: string;
  voided: boolean; voidReason: string | null;
};
export type ReceiptLabels = {
  title: string; number: string; date: string; receivedFrom: string; student: string; admissionNo: string; class: string; sumOf: string; amount: string; method: string; reference: string; payingFor: string; credit: string;
  before: string; after: string; receivedBy: string; signature: string; stamp: string; void: string; thanks: string; more: string;
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

const A5_LANDSCAPE: [number, number] = [595.28, 419.53];
const A4: [number, number] = [595.28, 841.89];

/** Shrinks a line of text until it fits the width (a long school name or a very large amount must never run off the page). */
function fitSize(font: PDFFont, text: string, size: number, maxWidth: number, min = 6): number {
  let sz = size;
  while (sz > min && font.widthOfTextAtSize(clean(text), sz) > maxWidth) sz -= 0.25;
  return sz;
}

/** Cuts a line with "..." when even the smallest size would not fit, so a long description never runs into the amount beside it. */
function ellipsize(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const t = clean(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let cut = t.length;
  while (cut > 1 && font.widthOfTextAtSize(`${t.slice(0, cut).trimEnd()}...`, size) > maxWidth) cut--;
  return `${t.slice(0, cut).trimEnd()}...`;
}

/*
 * The school's paper receipt, improved: A5 landscape, letterhead, receipt number and date at the top right, handwritten-style lines
 * (received from, student, the sum of ... in words, being payment for, method), the PAID box with the balance before and after,
 * a place for the school stamp and for the signature of the person who received the money.
 */
export function renderReceipt(pdf: PDFDocument, f: Fonts, r: ReceiptDoc, L: ReceiptLabels, logo: PDFImage | null) {
  const [PW, PH] = A5_LANDSCAPE;
  const page = pdf.addPage(A5_LANDSCAPE);
  const M = 30; // inside the border
  const left = M, right = PW - M;
  const colGap = 18, rightW = 156;
  const leftW = right - left - rightW - colGap;
  const rightX = right - rightW;

  page.drawRectangle({ x: 14, y: 14, width: PW - 28, height: PH - 28, borderColor: GREEN, borderWidth: 1.2 });
  page.drawRectangle({ x: 18, y: 18, width: PW - 36, height: PH - 36, borderColor: LINE, borderWidth: 0.5 });

  // Letterhead (left) and receipt number / date (right)
  const top = PH - M;
  const logoW = logo ? 50 : 0;
  if (logo) {
    const sc = Math.min(46 / logo.width, 46 / logo.height);
    page.drawImage(logo, { x: left, y: top - logo.height * sc, width: logo.width * sc, height: logo.height * sc });
  }
  const headX = left + logoW, headW = leftW + colGap - logoW - 6;
  const name = r.school.name.toUpperCase();
  draw(page, name, headX, top - 14, { font: f.bold, size: fitSize(f.bold, name, 16, headW), color: GREEN, align: "center", width: headW });
  let hy = top - 27;
  if (r.school.motto) { draw(page, r.school.motto, headX, hy, { font: f.italic, size: 8, color: MUTED, align: "center", width: headW }); hy -= 10; }
  const addr = r.school.address ? wrap(r.school.address, f.regular, 7.5, headW)[0] ?? "" : "";
  const contact = [addr, r.school.phone, r.school.email].filter(Boolean).join("  |  ");
  if (contact) draw(page, contact, headX, hy, { font: f.regular, size: fitSize(f.regular, contact, 7.5, headW), color: MUTED, align: "center", width: headW });

  page.drawRectangle({ x: rightX, y: top - 20, width: rightW, height: 20, color: GREEN });
  draw(page, L.title.toUpperCase(), rightX, top - 14, { font: f.bold, size: fitSize(f.bold, L.title.toUpperCase(), 10.5, rightW - 8), color: rgb(1, 1, 1), align: "center", width: rightW });
  draw(page, L.number, rightX, top - 35, { font: f.regular, size: 8, color: MUTED });
  const numW = rightW - f.regular.widthOfTextAtSize(clean(L.number), 8) - 8;
  draw(page, r.number, rightX, top - 35, { font: f.bold, size: fitSize(f.bold, r.number, 11, numW), align: "right", width: rightW });
  draw(page, L.date, rightX, top - 50, { font: f.regular, size: 8, color: MUTED });
  draw(page, r.receivedOn, rightX, top - 50, { font: f.bold, size: 10, align: "right", width: rightW });

  const ruleY = top - 62;
  page.drawRectangle({ x: left, y: ruleY, width: right - left, height: 1.5, color: GREEN });

  // Handwritten-style lines (left column)
  let y = ruleY - 22;
  const labelW = Math.max(92, ...[L.receivedFrom, L.student, L.admissionNo, L.sumOf, L.payingFor, L.method].map((x) => f.regular.widthOfTextAtSize(clean(x), 8) + 10));
  const valueX = left + labelW, valueW = leftW - labelW;
  const line = (label: string, value: string, o: { bold?: boolean; size?: number } = {}) => {
    draw(page, label, left, y, { font: f.regular, size: 8, color: MUTED });
    draw(page, value, valueX, y, { font: o.bold ? f.bold : f.regular, size: fitSize(o.bold ? f.bold : f.regular, value, o.size ?? 10, valueW) });
    page.drawRectangle({ x: valueX, y: y - 4, width: valueW, height: 0.5, color: LINE });
    y -= 25;
  };
  if (r.payer) line(L.receivedFrom, r.payer, { bold: true });
  line(L.student, r.student.name, { bold: true });
  // Admission number and class share a row
  draw(page, L.admissionNo, left, y, { font: f.regular, size: 8, color: MUTED });
  draw(page, r.student.admissionNo, valueX, y, { font: f.regular, size: 10 });
  const admW = Math.min(104, valueW * 0.46);
  page.drawRectangle({ x: valueX, y: y - 4, width: admW, height: 0.5, color: LINE });
  if (r.className) {
    const cx = valueX + admW + 12, clW = f.regular.widthOfTextAtSize(clean(L.class), 8) + 8;
    draw(page, L.class, cx, y, { font: f.regular, size: 8, color: MUTED });
    const cw = left + leftW - (cx + clW);
    draw(page, r.className, cx + clW, y, { font: f.regular, size: fitSize(f.regular, r.className, 10, cw) });
    page.drawRectangle({ x: cx + clW, y: y - 4, width: cw, height: 0.5, color: LINE });
  }
  y -= 25;

  // The sum of ... (words), up to three lines (Kiswahili numbers are long)
  draw(page, L.sumOf, left, y, { font: f.regular, size: 8, color: MUTED });
  const words = wrap(r.amountWords, f.bold, 9.5, valueW).slice(0, 3);
  words.forEach((ln, i) => {
    draw(page, ln, valueX, y - i * 12, { font: f.bold, size: 9.5 });
    page.drawRectangle({ x: valueX, y: y - i * 12 - 4, width: valueW, height: 0.5, color: LINE });
  });
  y -= 12 * words.length + 13;

  // Being payment for: one line per invoice, then any credit left over. Only as many lines as fit above the signature; the rest become "+ N more".
  const creditRow = r.creditAddedCents > 0 ? 1 : 0;
  const allowed = Math.max(2, Math.floor((y - 109) / 12));
  const visible = r.payingFor.length + creditRow > allowed ? Math.max(1, allowed - creditRow - 1) : r.payingFor.length;
  const hidden = r.payingFor.length - visible;
  const entries = [...r.payingFor.slice(0, visible).map((p) => ({ text: `${p.number}  ${p.description}`.trim(), cents: p.amountCents })), ...(creditRow ? [{ text: L.credit, cents: r.creditAddedCents }] : [])];
  if (entries.length > 0) {
    draw(page, L.payingFor, left, y, { font: f.regular, size: 8, color: MUTED });
    const amtW = Math.max(...entries.map((e) => f.regular.widthOfTextAtSize(clean(formatMoney(e.cents, r.currency)), 9))) + 8;
    entries.forEach((e, i) => {
      draw(page, ellipsize(f.regular, e.text, 9, valueW - amtW), valueX, y - i * 12, { font: f.regular, size: 9 });
      draw(page, formatMoney(e.cents, r.currency), valueX, y - i * 12, { font: f.regular, size: 9, align: "right", width: valueW });
      page.drawRectangle({ x: valueX, y: y - i * 12 - 4, width: valueW, height: 0.4, color: LINE });
    });
    if (hidden > 0) draw(page, `+ ${hidden} ${L.more}`, valueX, y - entries.length * 12, { font: f.italic, size: 8, color: MUTED });
    y -= 12 * (entries.length + (hidden > 0 ? 1 : 0)) + 13;
  }

  // Payment method and reference
  const how = [r.method, r.reference].filter(Boolean).join("  |  ");
  draw(page, L.method, left, y, { font: f.regular, size: 8, color: MUTED });
  draw(page, how, valueX, y, { font: f.regular, size: fitSize(f.regular, how, 10, valueW), });
  page.drawRectangle({ x: valueX, y: y - 4, width: valueW, height: 0.5, color: LINE });

  // Right column: amount paid, balances, stamp
  let ry = ruleY - 14;
  const boxH = 52;
  page.drawRectangle({ x: rightX, y: ry - boxH, width: rightW, height: boxH, color: TINT, borderColor: GREEN, borderWidth: 0.8 });
  draw(page, L.amount.toUpperCase(), rightX + 8, ry - 14, { font: f.bold, size: 7.5, color: GREEN });
  const amt = formatMoney(r.amountCents, r.currency);
  draw(page, amt, rightX + 8, ry - 38, { font: f.bold, size: fitSize(f.bold, amt, 17, rightW - 16, 8), color: GREEN });
  ry -= boxH + 16;
  const bal = (label: string, cents: number, bold = false) => {
    draw(page, label, rightX, ry, { font: f.regular, size: 8, color: MUTED });
    ry -= 12;
    draw(page, formatMoney(cents, r.currency), rightX, ry, { font: bold ? f.bold : f.regular, size: fitSize(bold ? f.bold : f.regular, formatMoney(cents, r.currency), bold ? 11 : 10, rightW) });
    ry -= 17;
  };
  bal(L.before, r.outstandingBeforeCents);
  bal(L.after, r.outstandingAfterCents, true);

  // Signature (left) and stamp (right) at the bottom
  const sigY = 74;
  page.drawRectangle({ x: left, y: sigY, width: 190, height: 0.7, color: INK });
  draw(page, L.receivedBy, left, sigY - 11, { font: f.regular, size: 8, color: MUTED });
  if (r.receivedBy) draw(page, r.receivedBy, left, sigY + 5, { font: f.regular, size: fitSize(f.regular, r.receivedBy, 10, 190) });
  page.drawRectangle({ x: left + 210, y: sigY, width: 110, height: 0.7, color: INK });
  draw(page, L.signature, left + 210, sigY - 11, { font: f.regular, size: 8, color: MUTED });
  const stampH = 76;
  page.drawRectangle({ x: rightX, y: 36, width: rightW, height: stampH, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
  draw(page, L.stamp, rightX, 36 + stampH / 2 - 3, { font: f.regular, size: 7.5, color: MUTED, align: "center", width: rightW });
  draw(page, L.thanks, left, 30, { font: f.italic, size: 9, color: GREEN });

  if (r.voided) {
    watermark(page, f.bold, L.void);
    if (r.voidReason) for (const [i, ln] of wrap(r.voidReason, f.regular, 8, leftW).slice(0, 2).entries()) draw(page, ln, left, 50 - i * 10, { font: f.regular, size: 8, color: RED });
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
