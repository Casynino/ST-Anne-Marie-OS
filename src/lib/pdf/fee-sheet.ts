import { PDFDocument, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { formatMoney } from "@/lib/finance/money";
import type { FeeSheetTable } from "@/lib/finance/fee-sheet";
import { GREEN, INK, LINE, MUTED, TINT, clean, draw, wrap, type Fonts } from "@/lib/pdf/common";
import { A4, fonts, header, logoOf, type PdfLogo, type SchoolHeader } from "@/lib/pdf/finance";

/*
 * The school's fee table as a printable sheet (A4): letterhead, the year, then one table per fee structure (a class, a level or everyone)
 * with the fee items down the side and the terms across, a total per term and for the year, then how to pay (exactly what the school
 * wrote in Fee settings) and places for the signature and the school stamp. Nothing is added that the school did not enter.
 */

export type FeeSheetSection = { name: string; scope: string; table: FeeSheetTable };
export type FeeSheetDoc = { school: SchoolHeader; currency: string; yearName: string; sections: FeeSheetSection[]; paymentInstructions: string; printedOn: string };
export type FeeSheetLabels = { title: string; item: string; total: string; yearTotal: string; amountsIn: string; howToPay: string; printedOn: string; signHead: string; stamp: string; noLines: string };

const num = (cents: number) => formatMoney(cents, "").trim();

export function renderFeeSheet(pdf: PDFDocument, f: Fonts, d: FeeSheetDoc, L: FeeSheetLabels, logo: PDFImage | null) {
  const M = 40;
  const W = A4[0] - 2 * M;
  const BOTTOM = 56;
  let page!: PDFPage;
  let y = 0;
  let pageNo = 0;

  const newPage = () => {
    page = pdf.addPage(A4);
    pageNo++;
    y = header(page, f, d.school, logo, M, W, A4[1] - M) - 14;
    if (pageNo === 1) {
      draw(page, `${L.title.toUpperCase()}  ${d.yearName}`, M, y, { font: f.bold, size: 14, color: INK, align: "center", width: W });
      y -= 16;
      draw(page, L.amountsIn.replace("{currency}", d.currency), M, y, { font: f.italic, size: 8.5, color: MUTED, align: "center", width: W });
      y -= 18;
    } else y -= 6;
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  newPage();

  if (d.sections.length === 0) draw(page, L.noLines, M, y, { font: f.italic, size: 10, color: MUTED });

  for (const sec of d.sections) {
    const t = sec.table;
    const cols = t.terms.length + 1;
    const numW = cols > 5 ? 62 : 78;
    const descW = W - cols * numW;
    const rowH = t.rows.length > 14 ? 14 : 16;
    const colHead = () => {
      page.drawRectangle({ x: M, y: y - 5, width: W, height: 17, color: TINT });
      draw(page, L.item, M + 6, y, { font: f.bold, size: 8.5, color: GREEN });
      t.terms.forEach((term, i) => draw(page, term.name, M + descW + i * numW, y, { font: f.bold, size: 8.5, color: GREEN, align: "right", width: numW - 6 }));
      draw(page, L.yearTotal, M + descW + t.terms.length * numW, y, { font: f.bold, size: 8.5, color: GREEN, align: "right", width: numW - 6 });
      y -= 4;
    };
    // The bar, the column heads and at least the first two rows stay together
    ensure(22 + 17 + rowH * Math.min(t.rows.length, 2) + 20);
    page.drawRectangle({ x: M, y: y - 6, width: W, height: 20, color: GREEN });
    draw(page, sec.name, M + 8, y, { font: f.bold, size: 10.5, color: rgb(1, 1, 1) });
    draw(page, sec.scope, M, y, { font: f.regular, size: 9, color: rgb(1, 1, 1), align: "right", width: W - 8 });
    y -= 22;
    colHead();
    t.rows.forEach((r, i) => {
      if (y - rowH - 20 < BOTTOM) { newPage(); colHead(); }
      y -= rowH;
      if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: rgb(0.975, 0.985, 0.98) });
      draw(page, r.name, M + 6, y, { font: f.regular, size: 9.5 });
      r.cells.forEach((c, k) => draw(page, c > 0 ? num(c) : "-", M + descW + k * numW, y, { font: f.regular, size: 9.5, color: c > 0 ? INK : MUTED, align: "right", width: numW - 6 }));
      draw(page, num(r.totalCents), M + descW + t.terms.length * numW, y, { font: f.bold, size: 9.5, align: "right", width: numW - 6 });
    });
    ensure(24);
    y -= rowH;
    page.drawRectangle({ x: M, y: y + rowH - 4, width: W, height: 1, color: GREEN });
    page.drawRectangle({ x: M, y: y - 5, width: W, height: rowH + 2, color: TINT });
    draw(page, L.total, M + 6, y, { font: f.bold, size: 10 });
    t.termTotals.forEach((c, k) => draw(page, num(c), M + descW + k * numW, y, { font: f.bold, size: 10, align: "right", width: numW - 6 }));
    draw(page, num(t.yearTotalCents), M + descW + t.terms.length * numW, y, { font: f.bold, size: 10, color: GREEN, align: "right", width: numW - 6 });
    y -= 26;
  }

  // How to pay: the school's own words, as entered in Fee settings
  const lines = d.paymentInstructions.trim() ? wrap(d.paymentInstructions, f.regular, 9.5, W).slice(0, 14) : [];
  ensure((lines.length ? 22 + lines.length * 12 : 0) + 70);
  if (lines.length) {
    draw(page, L.howToPay.toUpperCase(), M, y, { font: f.bold, size: 8.5, color: GREEN });
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 0.6, color: LINE });
    y -= 17;
    for (const ln of lines) { draw(page, ln, M, y, { font: f.regular, size: 9.5 }); y -= 12; }
    y -= 10;
  }
  // Signature and stamp
  page.drawRectangle({ x: M, y: y - 30, width: 190, height: 0.7, color: INK });
  draw(page, L.signHead, M, y - 42, { font: f.regular, size: 8.5, color: MUTED });
  page.drawRectangle({ x: M + W - 120, y: y - 52, width: 120, height: 66, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
  draw(page, L.stamp, M + W - 120, y - 18, { font: f.regular, size: 7.5, color: MUTED, align: "center", width: 120 });

  const pages = pdf.getPages();
  pages.forEach((p, i) => draw(p, `${L.printedOn.replace("{date}", d.printedOn)}${pages.length > 1 ? `   ${i + 1}/${pages.length}` : ""}`, M, 28, { font: f.regular, size: 7.5, color: MUTED, align: "right", width: W }));
}

export async function buildFeeSheetPdf(d: FeeSheetDoc, L: FeeSheetLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${clean(L.title)} ${clean(d.yearName)}`);
  renderFeeSheet(pdf, await fonts(pdf), d, L, await logoOf(pdf, logo));
  return pdf.save();
}
