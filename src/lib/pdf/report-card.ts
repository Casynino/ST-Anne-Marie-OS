import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { GREEN, INK, LINE, MUTED, TINT, clean, draw, wrap, type Fonts } from "@/lib/pdf/common";
import type { ReportSnapshot } from "@/lib/results/report-types";

/** Every visible word comes from the caller (EN/SW). */
export type PdfLabels = {
  title: string; student: string; admissionNo: string; class: string; term: string; sex: string; dob: string; male: string; female: string;
  subject: string; score: string; grade: string; points: string; position: string; classAvg: string; absent: string; exempt: string;
  total: string; average: string; division: string; classPosition: string; streamPosition: string; of: string;
  attendance: string; attDays: string; attPresent: string; attAbsent: string; attLate: string; attExcused: string; attRate: string; attNone: string;
  remarkClass: string; remarkHead: string; noRemark: string; signClass: string; signHead: string; signParent: string; stamp: string; date: string;
  key: string; generated: string; incNote: string;
};
export type PdfLogo = { bytes: Uint8Array; type: "png" | "jpg" };

const A4: [number, number] = [595.28, 841.89];
const M = 36;

const fmt = (n: number | null, d: number) => (n === null ? "-" : n.toFixed(d));

export function renderReportCard(pdf: PDFDocument, f: Fonts, snap: ReportSnapshot, L: PdfLabels, logo: PDFImage | null, generated: string) {
  const page = pdf.addPage(A4);
  const W = A4[0] - 2 * M;
  const d = snap.policy.decimals;
  let y = A4[1] - M;

  // Header
  const textLeft = logo ? M + 64 : M;
  if (logo) {
    const s = Math.min(54 / logo.width, 54 / logo.height);
    page.drawImage(logo, { x: M, y: y - logo.height * s, width: logo.width * s, height: logo.height * s });
  }
  draw(page, snap.school.name.toUpperCase(), textLeft, y - 14, { font: f.bold, size: 15, color: GREEN, align: "center", width: A4[0] - M - textLeft });
  let hy = y - 28;
  if (snap.school.motto) { draw(page, snap.school.motto, textLeft, hy, { font: f.italic, size: 9, color: MUTED, align: "center", width: A4[0] - M - textLeft }); hy -= 12; }
  const contact = [snap.school.address, snap.school.phone, snap.school.email].filter(Boolean).join("  |  ");
  if (contact) { draw(page, contact, textLeft, hy, { font: f.regular, size: 8, color: MUTED, align: "center", width: A4[0] - M - textLeft }); hy -= 11; }
  y = (logo ? Math.min(hy, y - 58) : hy) - 6;
  page.drawRectangle({ x: M, y, width: W, height: 1.5, color: GREEN });
  y -= 18;
  draw(page, L.title.toUpperCase(), M, y, { font: f.bold, size: 12, align: "center", width: W });
  y -= 20;

  // Student block
  const blockH = 52;
  page.drawRectangle({ x: M, y: y - blockH + 12, width: W, height: blockH, color: TINT });
  const col = W / 2;
  const row = (label: string, value: string, x: number, yy: number) => {
    draw(page, label, x, yy, { font: f.regular, size: 8, color: MUTED });
    draw(page, value, x + 78, yy, { font: f.bold, size: 9.5 });
  };
  row(L.student, snap.student.name, M + 8, y);
  row(L.admissionNo, snap.student.admissionNo, M + 8, y - 15);
  row(L.dob, snap.student.dateOfBirth, M + 8, y - 30);
  row(L.class, `${snap.class.name}${snap.class.stream ? ` ${snap.class.stream}` : ""}`, M + col, y);
  row(L.term, `${snap.term.name}, ${snap.term.year}`, M + col, y - 15);
  row(L.sex, snap.student.gender === "MALE" ? L.male : snap.student.gender === "FEMALE" ? L.female : "-", M + col, y - 30);
  y -= blockH + 6;

  // Subjects table
  const showExams = snap.exams.length > 0 && snap.exams.length <= 3;
  const examCols = showExams ? snap.exams : [];
  const fixed = { pct: 48, grade: 38, pts: 32, pos: 38, avg: 52 };
  const examW = 52;
  const subjW = W - (fixed.pct + fixed.grade + fixed.pts + fixed.pos + fixed.avg) - examCols.length * examW;
  const cols: { key: string; label: string; w: number; align: "left" | "right" | "center" }[] = [
    { key: "subject", label: L.subject, w: subjW, align: "left" },
    ...examCols.map((e) => ({ key: `exam:${e.id}`, label: e.name, w: examW, align: "right" as const })),
    { key: "pct", label: L.score, w: fixed.pct, align: "right" },
    { key: "grade", label: L.grade, w: fixed.grade, align: "center" },
    { key: "pts", label: L.points, w: fixed.pts, align: "center" },
    { key: "pos", label: L.position, w: fixed.pos, align: "center" },
    { key: "avg", label: L.classAvg, w: fixed.avg, align: "right" },
  ];
  const n = snap.subjects.length;
  const rowH = n <= 12 ? 18 : n <= 16 ? 16 : n <= 20 ? 14 : 12.5;
  const fs = rowH >= 16 ? 9 : 8;
  page.drawRectangle({ x: M, y: y - 4, width: W, height: 16, color: GREEN });
  let cx = M;
  for (const c of cols) {
    const label = clean(c.label);
    // Header labels shrink to fit their column.
    let hs = 7.5;
    while (hs > 5.5 && f.bold.widthOfTextAtSize(label, hs) > c.w - 6) hs -= 0.5;
    draw(page, label, cx + 3, y, { font: f.bold, size: hs, color: rgb(1, 1, 1), align: c.align, width: c.w - 6 });
    cx += c.w;
  }
  y -= 4;
  snap.subjects.forEach((s, i) => {
    y -= rowH;
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: rgb(0.975, 0.985, 0.98) });
    let x = M;
    for (const c of cols) {
      let v = "";
      let bold = false;
      if (c.key === "subject") v = s.name;
      else if (c.key.startsWith("exam:")) {
        const m = s.exams.find((e) => e.examId === c.key.slice(5));
        v = !m ? "-" : m.status === "ABSENT" ? L.absent : m.status === "EXEMPT" ? L.exempt : `${m.score}/${m.maxMarks}`;
      } else if (c.key === "pct") { v = fmt(s.percent, d); bold = true; }
      else if (c.key === "grade") { v = s.grade ?? "-"; bold = true; }
      else if (c.key === "pts") v = s.points === null ? "-" : String(s.points);
      else if (c.key === "pos") v = s.position === null ? "-" : `${s.position}/${s.classCount}`;
      else if (c.key === "avg") v = fmt(s.classMean, d);
      let size = fs;
      while (size > 6 && (bold ? f.bold : f.regular).widthOfTextAtSize(clean(v), size) > c.w - 6) size -= 0.5;
      draw(page, v, x + 3, y, { font: bold ? f.bold : f.regular, size, align: c.align, width: c.w - 6 });
      x += c.w;
    }
    page.drawRectangle({ x: M, y: y - 5, width: W, height: 0.4, color: LINE });
  });
  y -= 42; // clear of the last table row: the summary box rises 26pt above this baseline

  // Summary
  const sum = snap.summary;
  const cells: [string, string][] = [
    [L.total, fmt(sum.total, d)],
    [L.average, fmt(sum.average, d)],
    [L.grade, sum.grade ?? "-"],
    ...(snap.scale.divisionBestN ? ([[L.division, sum.division ? `${sum.division}${sum.pointsSum !== null ? ` (${sum.pointsSum})` : ""}` : "-"]] as [string, string][]) : []),
    [L.classPosition, sum.position === null ? "-" : `${sum.position} ${L.of} ${sum.classSize}`],
    ...(sum.streamPosition !== null && sum.streamSize ? ([[L.streamPosition, `${sum.streamPosition} ${L.of} ${sum.streamSize}`]] as [string, string][]) : []),
  ];
  const cw = W / cells.length;
  page.drawRectangle({ x: M, y: y - 8, width: W, height: 34, borderColor: GREEN, borderWidth: 1 });
  cells.forEach(([label, value], i) => {
    const x = M + i * cw;
    if (i > 0) page.drawRectangle({ x, y: y - 8, width: 0.5, height: 34, color: LINE });
    draw(page, label, x, y + 14, { font: f.regular, size: 7.5, color: MUTED, align: "center", width: cw });
    draw(page, value, x, y - 2, { font: f.bold, size: 11, align: "center", width: cw });
  });
  y -= 20;
  if (snap.scale.divisionBestN && sum.division === "INC") { draw(page, L.incNote, M, y, { font: f.italic, size: 7, color: MUTED }); y -= 10; }

  // Attendance
  y -= 8;
  draw(page, L.attendance.toUpperCase(), M, y, { font: f.bold, size: 8.5, color: GREEN });
  y -= 13;
  const a = snap.attendance;
  const attText = a.recorded === 0 ? L.attNone : `${L.attDays}: ${a.recorded}   |   ${L.attPresent}: ${a.present}   |   ${L.attAbsent}: ${a.absent}   |   ${L.attLate}: ${a.late}   |   ${L.attExcused}: ${a.excused}   |   ${L.attRate}: ${a.ratePct === null ? "-" : `${a.ratePct}%`}`;
  draw(page, attText, M, y, { font: f.regular, size: 8.5 });
  y -= 16;

  // Remarks
  const remark = (title: string, text: string | null) => {
    draw(page, title.toUpperCase(), M, y, { font: f.bold, size: 8.5, color: GREEN });
    y -= 12;
    const lines = wrap(text ?? L.noRemark, text ? f.regular : f.italic, 9, W - 12).slice(0, 4);
    const h = lines.length * 11 + 8;
    page.drawRectangle({ x: M, y: y - h + 9, width: W, height: h, borderColor: LINE, borderWidth: 0.7 });
    lines.forEach((ln, i) => draw(page, ln, M + 6, y - 2 - i * 11, { font: text ? f.regular : f.italic, size: 9, color: text ? INK : MUTED }));
    y -= h + 6;
  };
  remark(L.remarkClass, snap.remarks.class);
  remark(L.remarkHead, snap.remarks.head);

  // Signatures and stamp (tighter on cards with many subjects so everything stays on one page)
  y -= n > 16 ? 12 : 28;
  const sx = [M, M + 150, M + 300];
  [L.signClass, L.signHead, L.signParent].forEach((label, i) => {
    page.drawRectangle({ x: sx[i]!, y, width: 130, height: 0.7, color: INK });
    draw(page, label, sx[i]!, y - 10, { font: f.regular, size: 8, color: MUTED });
    draw(page, `${L.date}: ____ / ____ / ______`, sx[i]!, y - 22, { font: f.regular, size: 7.5, color: MUTED });
  });
  page.drawRectangle({ x: A4[0] - M - 70, y: y - 24, width: 70, height: 56, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
  draw(page, L.stamp, A4[0] - M - 70, y + 4, { font: f.regular, size: 7.5, color: MUTED, align: "center", width: 70 });

  // Grading key
  y -= 44;
  draw(page, `${L.key}: ${snap.scale.name}`, M, y, { font: f.bold, size: 7.5, color: MUTED });
  y -= 10;
  const keyText = snap.scale.bands.map((b) => `${b.grade} ${b.min}-${b.max}${b.points !== null ? ` (${b.points})` : ""}`).join("   ");
  for (const ln of wrap(keyText, f.regular, 7.5, W)) { draw(page, ln, M, y, { font: f.regular, size: 7.5, color: MUTED }); y -= 9; }
  draw(page, L.generated.replace("{date}", generated), M, M - 14, { font: f.regular, size: 7, color: MUTED });
}

/** One PDF with one page per report card. Fonts and logo are embedded once, so a class of 50 stays small and fast. */
export async function buildReportCardsPdf(snaps: ReportSnapshot[], labels: PdfLabels, opts: { logo?: PdfLogo | null; generated: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setProducer("St Anne Marie Schools OS");
  pdf.setCreator("St Anne Marie Schools OS");
  const fonts: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
  let logo: PDFImage | null = null;
  if (opts.logo) {
    try { logo = opts.logo.type === "png" ? await pdf.embedPng(opts.logo.bytes) : await pdf.embedJpg(opts.logo.bytes); } catch { logo = null; }
  }
  for (const s of snaps) renderReportCard(pdf, fonts, s, labels, logo, opts.generated);
  pdf.setTitle(snaps.length === 1 ? `${snaps[0]!.student.name} - ${snaps[0]!.term.name} ${snaps[0]!.term.year}` : `Report cards (${snaps.length})`);
  return pdf.save();
}
