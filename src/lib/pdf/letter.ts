import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { GREEN, INK, LINE, MUTED, clean, draw, wrap, type Fonts } from "@/lib/pdf/common";
import { A4, fonts, header, logoOf, type PdfLogo, type SchoolHeader } from "@/lib/pdf/finance";

/*
 * A message to parents as a formal school letter (A4): letterhead, reference and date, who it is for, the subject, the text, a closing,
 * the name and title of the person who sent it, and a place for the signature and the school stamp. The text is exactly what the school
 * wrote; the layout adds nothing to it.
 */

export type LetterDoc = {
  school: SchoolHeader; reference: string; date: string; to: string; subject: string; body: string;
  /** Who sent it: name and, when the school recorded one, their job title. */
  signer: { name: string; title: string | null };
};
export type LetterLabels = { ref: string; date: string; to: string; re: string; closing: string; signature: string; stamp: string };

export function renderLetter(pdf: PDFDocument, f: Fonts, d: LetterDoc, L: LetterLabels, logo: PDFImage | null) {
  const M = 56;
  const W = A4[0] - 2 * M;
  const BOTTOM = 70;
  let page!: PDFPage;
  let y = 0;
  const newPage = (first: boolean) => {
    page = pdf.addPage(A4);
    y = first ? header(page, f, d.school, logo, M, W, A4[1] - 44) - 22 : A4[1] - 60;
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(false); };
  newPage(true);

  draw(page, `${L.ref}: ${d.reference}`, M, y, { font: f.regular, size: 10, color: MUTED });
  draw(page, `${L.date}: ${d.date}`, M, y, { font: f.regular, size: 10, color: MUTED, align: "right", width: W });
  y -= 30;
  draw(page, `${L.to}: `, M, y, { font: f.regular, size: 11, color: MUTED });
  const toX = M + f.regular.widthOfTextAtSize(clean(`${L.to}:`), 11) + 8;
  const toLines = wrap(d.to, f.bold, 11, W - (toX - M));
  toLines.forEach((ln, i) => draw(page, ln, toX, y - i * 14, { font: f.bold, size: 11 }));
  y -= 14 * toLines.length + 14;

  const subject = wrap(`${L.re}: ${d.subject}`, f.bold, 12, W);
  subject.forEach((ln, i) => { draw(page, ln.toUpperCase(), M, y - i * 16, { font: f.bold, size: 12 }); });
  y -= 16 * subject.length;
  page.drawRectangle({ x: M, y: y + 6, width: W, height: 1.2, color: GREEN });
  y -= 14;

  // The text: paragraphs are kept as the school typed them; a numbered or lettered line hangs its text under itself
  for (const para of d.body.replace(/\r\n/g, "\n").split("\n")) {
    if (!para.trim()) { y -= 8; continue; }
    const m = /^(\s*(?:\d+[.)]|[a-z][.)]|[-•*])\s+)(.*)$/.exec(para);
    const indent = m ? Math.max(f.regular.widthOfTextAtSize(clean(m[1]!.trim()), 11) + 8, 18) : 0;
    const lines = wrap(m ? m[2]! : para, f.regular, 11, W - indent);
    lines.forEach((ln, i) => {
      ensure(16);
      if (m && i === 0) draw(page, m[1]!.trim(), M, y, { font: f.regular, size: 11 });
      draw(page, ln, M + indent, y, { font: f.regular, size: 11 });
      y -= 15;
    });
    y -= 4;
  }

  // Closing, signature and stamp stay together
  ensure(130);
  y -= 14;
  draw(page, L.closing, M, y, { font: f.regular, size: 11 });
  y -= 52;
  page.drawRectangle({ x: M, y, width: 190, height: 0.7, color: INK });
  draw(page, d.signer.name, M, y - 14, { font: f.bold, size: 10.5 });
  if (d.signer.title) draw(page, d.signer.title, M, y - 27, { font: f.regular, size: 9.5, color: MUTED });
  draw(page, L.signature, M, y - (d.signer.title ? 40 : 27), { font: f.regular, size: 8, color: MUTED });
  page.drawRectangle({ x: M + W - 120, y: y - 44, width: 120, height: 76, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
  draw(page, L.stamp, M + W - 120, y - 6, { font: f.regular, size: 7.5, color: MUTED, align: "center", width: 120 });
}

export async function buildLetterPdf(d: LetterDoc, L: LetterLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(d.subject));
  renderLetter(pdf, await fonts(pdf), d, L, await logoOf(pdf, logo));
  return pdf.save();
}
