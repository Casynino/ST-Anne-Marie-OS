import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { GREEN, INK, LINE, MUTED, TINT, clean, draw, wrap, type Fonts } from "@/lib/pdf/common";
import { A4, fonts, header, logoOf, type PdfLogo, type SchoolHeader } from "@/lib/pdf/finance";

/*
 * The joining instructions of an accepted applicant (A4): the school's letterhead, who was accepted and into which class, the entrance results,
 * what has to be paid and how, what to bring, when to report, and what happens next. Every figure and sentence comes from the school's records
 * and settings; the layout only arranges them.
 */

export type JoiningDoc = {
  school: SchoolHeader; date: string; applicant: string; applicationNo: string; className: string | null; acceptedOn: string | null; letterNo: string | null;
  results: { subject: string; mark: string }[]; average: string | null;
  fee: { required: string; paid: string; balance: string; reference: string; howToPay: string; statusText: string; settled: boolean; none: boolean };
  bring: string[]; reportingDate: string | null; reportingNote: string; notes: string;
};
export type JoiningLabels = Record<
  "title" | "date" | "applicant" | "appNo" | "class" | "accepted" | "offer" | "congrats" | "results" | "subject" | "mark" | "average" | "pay" | "fee" | "paid" | "balance" | "reference" | "howToPay" | "howToPayNone" | "payNote" | "noFee" | "bring" | "report" | "next" | "step1" | "step2" | "step3" | "step4" | "notes" | "contact" | "present",
  string
>;

const M = 52;

export function renderJoining(pdf: PDFDocument, f: Fonts, d: JoiningDoc, L: JoiningLabels, logo: PDFImage | null) {
  const W = A4[0] - 2 * M;
  const BOTTOM = 40;
  let page!: PDFPage;
  let y = 0;
  const newPage = (first: boolean) => {
    page = pdf.addPage(A4);
    y = first ? header(page, f, d.school, logo, M, W, A4[1] - 44) - 18 : A4[1] - 56;
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(false); };
  newPage(true);

  const section = (title: string) => {
    ensure(40);
    y -= 4;
    draw(page, title.toUpperCase(), M, y, { font: f.bold, size: 9.5, color: GREEN });
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 1, color: LINE });
    y -= 17;
  };
  const para = (text: string, o: { size?: number; font?: "regular" | "bold"; color?: typeof INK; indent?: number; gap?: number } = {}) => {
    const size = o.size ?? 10.5;
    for (const line of wrap(text, f[o.font ?? "regular"], size, W - (o.indent ?? 0))) {
      ensure(size + 5);
      draw(page, line, M + (o.indent ?? 0), y, { font: f[o.font ?? "regular"], size, color: o.color ?? INK });
      y -= size + 4;
    }
    y -= o.gap ?? 2;
  };

  // Title band
  const bandH = 54;
  page.drawRectangle({ x: M, y: y - bandH, width: W, height: bandH, color: GREEN });
  draw(page, L.title.toUpperCase(), M + 16, y - 22, { font: f.bold, size: 15, color: TINT });
  draw(page, d.applicant, M + 16, y - 41, { font: f.bold, size: 11.5, color: TINT });
  draw(page, `${L.date}: ${d.date}`, M, y - 24, { font: f.regular, size: 9.5, color: TINT, align: "right", width: W - 16 });
  if (d.letterNo) draw(page, `${L.offer}: ${d.letterNo}`, M, y - 38, { font: f.regular, size: 9.5, color: TINT, align: "right", width: W - 16 });
  y -= bandH + 14;

  // Who and where
  const rows: [string, string][] = [[L.appNo, d.applicationNo], [L.class, d.className ?? "—"], [L.accepted, d.acceptedOn ?? "—"]];
  const colW = W / rows.length;
  rows.forEach(([k, v], i) => {
    const x = M + i * colW;
    draw(page, k.toUpperCase(), x, y, { font: f.regular, size: 8, color: MUTED });
    draw(page, v, x, y - 14, { font: f.bold, size: 11 });
  });
  y -= 32;
  para(L.congrats.replace("{name}", d.applicant).replace("{class}", d.className ?? ""), { gap: 6 });

  // Entrance results
  if (d.results.length > 0) {
    section(L.results);
    const rowH = 17;
    page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: TINT });
    draw(page, L.subject, M + 10, y + 2, { font: f.bold, size: 9.5 });
    draw(page, L.mark, M, y + 2, { font: f.bold, size: 9.5, align: "right", width: W - 10 });
    y -= rowH;
    for (const r of d.results) {
      ensure(rowH + 4);
      draw(page, r.subject, M + 10, y + 2, { font: f.regular, size: 10.5 });
      draw(page, r.mark, M, y + 2, { font: f.regular, size: 10.5, align: "right", width: W - 10 });
      page.drawRectangle({ x: M, y: y - 5, width: W, height: 0.6, color: LINE });
      y -= rowH;
    }
    if (d.average) { draw(page, `${L.average}: ${d.average}`, M + 10, y + 2, { font: f.bold, size: 10.5 }); y -= rowH; }
    y -= 4;
  }

  // What to pay
  section(L.pay);
  if (d.fee.none) para(L.noFee, { gap: 6 });
  else {
    ensure(110);
    const boxH = 66;
    page.drawRectangle({ x: M, y: y - boxH + 8, width: W, height: boxH, color: TINT, borderColor: LINE, borderWidth: 0.8 });
    const cw = W / 3;
    [[L.fee, d.fee.required], [L.paid, d.fee.paid], [L.balance, d.fee.balance]].forEach(([k, v], i) => {
      draw(page, k!.toUpperCase(), M + 14 + i * cw, y - 10, { font: f.regular, size: 8, color: MUTED });
      draw(page, v!, M + 14 + i * cw, y - 28, { font: f.bold, size: i === 2 && !d.fee.settled ? 15 : 13, color: i === 2 && !d.fee.settled ? GREEN : INK });
    });
    draw(page, `${L.reference}: ${d.fee.reference}`, M + 14, y - 49, { font: f.bold, size: 10.5 });
    draw(page, d.fee.statusText, M, y - 49, { font: f.regular, size: 9.5, color: MUTED, align: "right", width: W - 14 });
    y -= boxH + 8;
    draw(page, L.howToPay.toUpperCase(), M, y, { font: f.bold, size: 8.5, color: MUTED });
    y -= 14;
    if (d.fee.howToPay) for (const line of d.fee.howToPay.replace(/\r\n/g, "\n").split("\n")) para(line.trim() === "" ? " " : line, { gap: 0 });
    else para(L.howToPayNone, { color: MUTED });
    para(L.payNote, { size: 9.5, color: MUTED, gap: 6 });
  }

  // What to bring
  if (d.bring.length > 0) {
    section(L.bring);
    for (const item of d.bring) {
      ensure(16);
      page.drawRectangle({ x: M + 1, y: y - 1, width: 8, height: 8, borderColor: GREEN, borderWidth: 1 });
      const lines = wrap(item, f.regular, 10.5, W - 24);
      lines.forEach((ln, i) => { if (i > 0) ensure(14); draw(page, ln, M + 20, y, { font: f.regular, size: 10.5 }); y -= 14; });
    }
    y -= 2;
  }

  // Reporting
  if (d.reportingDate || d.reportingNote) {
    section(L.report);
    if (d.reportingDate) para(d.reportingDate, { font: "bold", size: 13, color: GREEN, gap: 2 });
    if (d.reportingNote) para(d.reportingNote, { gap: 6 });
  }

  // What happens next
  section(L.next);
  [L.step1, L.step2, L.step3, L.step4].forEach((txt, i) => {
    ensure(30);
    page.drawRectangle({ x: M, y: y - 5, width: 18, height: 18, color: GREEN });
    draw(page, String(i + 1), M, y + 0, { font: f.bold, size: 10, color: TINT, align: "center", width: 18 });
    const lines = wrap(txt, f.regular, 10.5, W - 32);
    lines.forEach((ln, j) => { if (j > 0) ensure(14); draw(page, ln, M + 28, y, { font: f.regular, size: 10.5 }); y -= 14; });
    y -= 2;
  });

  if (d.notes) { section(L.notes); para(d.notes, { gap: 6 }); }

  // Closing: contact and the line to show when reporting
  ensure(28);
  page.drawRectangle({ x: M, y: y + 2, width: W, height: 0.8, color: LINE });
  y -= 10;
  const contact = [d.school.phone, d.school.email, d.school.address].filter(Boolean).join("  ·  ");
  if (contact) { draw(page, `${L.contact}: ${contact}`, M, y, { font: f.regular, size: 9, color: MUTED }); y -= 12; }
  draw(page, L.present, M, y, { font: f.italic, size: 9, color: MUTED });
  void clean;
}

export async function buildJoiningPdf(d: JoiningDoc, L: JoiningLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${L.title} ${d.applicationNo}`);
  renderJoining(pdf, await fonts(pdf), d, L, await logoOf(pdf, logo));
  return pdf.save();
}
