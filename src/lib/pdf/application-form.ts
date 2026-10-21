import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { GREEN, LINE, MUTED, TINT, clean, draw, wrap, type Fonts } from "@/lib/pdf/common";
import { A4, fonts, header, logoOf, type PdfLogo, type SchoolHeader } from "@/lib/pdf/finance";

/*
 * A copy of an online application for the family to keep: the school's letterhead, the application number, what was entered about the child
 * and the guardians, the application fee and its receipt number, the papers the school asks for, and the consent the family gave. It states
 * only what the system holds; nothing about the outcome of the application is promised.
 */

export type ApplicationFormDoc = {
  school: SchoolHeader; applicationNo: string; submittedOn: string; className: string | null;
  child: { name: string; dateOfBirth: string; gender: string; nationality: string | null; previousSchool: string | null; address: string | null };
  guardians: { name: string; relationship: string; phone: string; email: string | null }[];
  fee: { amount: string; paidOn: string; reference: string; receiptNo: string; test: boolean } | null;
  documents: string[];
};
export type ApplicationFormLabels = {
  title: string; applicationNo: string; submitted: string; classApplied: string; child: string; name: string; dateOfBirth: string; gender: string; nationality: string; previousSchool: string; address: string;
  guardians: string; relationship: string; phone: string; email: string; fee: string; amountPaid: string; paidOn: string; reference: string; receiptNo: string; testNote: string;
  documents: string; documentsIntro: string; consent: string; keep: string;
};

export function renderApplicationForm(pdf: PDFDocument, f: Fonts, d: ApplicationFormDoc, L: ApplicationFormLabels, logo: PDFImage | null) {
  const M = 48;
  const W = A4[0] - 2 * M;
  const BOTTOM = 60;
  let page!: PDFPage;
  let y = 0;
  const newPage = (first: boolean) => {
    page = pdf.addPage(A4);
    y = first ? header(page, f, d.school, logo, M, W, A4[1] - 40) - 18 : A4[1] - 56;
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(false); };
  newPage(true);

  // Title bar
  page.drawRectangle({ x: M, y: y - 6, width: W, height: 28, color: TINT });
  draw(page, L.title.toUpperCase(), M + 10, y + 3, { font: f.bold, size: 13, color: GREEN });
  draw(page, `${L.applicationNo}: ${d.applicationNo}`, M, y + 3, { font: f.bold, size: 12, align: "right", width: W - 10 });
  y -= 26;
  draw(page, `${L.submitted}: ${d.submittedOn}`, M, y, { font: f.regular, size: 9.5, color: MUTED });
  y -= 22;

  const section = (title: string) => {
    ensure(40);
    draw(page, title.toUpperCase(), M, y, { font: f.bold, size: 9.5, color: GREEN });
    y -= 5;
    page.drawRectangle({ x: M, y, width: W, height: 0.8, color: GREEN });
    y -= 15;
  };
  const row = (label: string, value: string | null | undefined) => {
    if (!value) return;
    const lines = wrap(value, f.bold, 10.5, W - 160);
    ensure(16 * lines.length + 2);
    draw(page, label, M, y, { font: f.regular, size: 9.5, color: MUTED });
    lines.forEach((ln, i) => draw(page, ln, M + 160, y - i * 14, { font: f.bold, size: 10.5 }));
    y -= 15 * lines.length + 3;
  };

  section(L.child);
  row(L.name, d.child.name);
  row(L.classApplied, d.className);
  row(L.dateOfBirth, d.child.dateOfBirth);
  row(L.gender, d.child.gender);
  row(L.nationality, d.child.nationality);
  row(L.previousSchool, d.child.previousSchool);
  row(L.address, d.child.address);
  y -= 8;

  section(L.guardians);
  d.guardians.forEach((g, i) => {
    if (i > 0) { page.drawRectangle({ x: M, y: y + 6, width: W, height: 0.5, color: LINE }); y -= 6; }
    row(L.name, g.name);
    row(L.relationship, g.relationship);
    row(L.phone, g.phone);
    row(L.email, g.email);
  });
  y -= 8;

  if (d.fee) {
    section(L.fee);
    row(L.amountPaid, d.fee.amount);
    row(L.paidOn, d.fee.paidOn);
    row(L.reference, d.fee.reference);
    row(L.receiptNo, d.fee.receiptNo);
    if (d.fee.test) { ensure(18); draw(page, L.testNote, M, y, { font: f.italic, size: 9, color: MUTED }); y -= 16; }
    y -= 8;
  }

  if (d.documents.length > 0) {
    section(L.documents);
    wrap(L.documentsIntro, f.regular, 10, W).forEach((ln) => { ensure(14); draw(page, ln, M, y, { font: f.regular, size: 10 }); y -= 14; });
    y -= 2;
    for (const doc of d.documents) { ensure(15); draw(page, `-  ${doc}`, M + 8, y, { font: f.regular, size: 10.5 }); y -= 15; }
    y -= 8;
  }

  ensure(70);
  wrap(L.consent, f.italic, 9, W).forEach((ln) => { draw(page, ln, M, y, { font: f.italic, size: 9, color: MUTED }); y -= 12; });
  y -= 6;
  wrap(L.keep, f.regular, 9, W).forEach((ln) => { draw(page, ln, M, y, { font: f.regular, size: 9, color: MUTED }); y -= 12; });
}

export async function buildApplicationFormPdf(d: ApplicationFormDoc, L: ApplicationFormLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`${L.title} ${d.applicationNo}`));
  renderApplicationForm(pdf, await fonts(pdf), d, L, await logoOf(pdf, logo));
  return pdf.save();
}
