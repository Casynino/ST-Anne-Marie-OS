import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { GREEN, INK, LINE, MUTED, clean, draw, wrap, type Fonts } from "@/lib/pdf/common";
import { gradeFor } from "@/lib/results/engine";
import type { ReportSnapshot } from "@/lib/results/report-types";

/** Every visible word comes from the caller (EN/SW). */
export type PdfLabels = {
  title: string; student: string; admissionNo: string; class: string; term: string; sex: string; dob: string; male: string; female: string;
  subject: string; score: string; grade: string; points: string; position: string; classAvg: string; absent: string; exempt: string;
  total: string; average: string; division: string; classPosition: string; streamPosition: string; of: string;
  attendance: string; attDays: string; attPresent: string; attAbsent: string; attLate: string; attExcused: string; attRate: string; attNone: string;
  remarkClass: string; remarkHead: string; noRemark: string; signClass: string; signHead: string; signParent: string; stamp: string; date: string;
  key: string; generated: string; incNote: string;
  ref: string; name: string; dear: string; re: string; marks: string; gradeRow: string; termResult: string; classMean: string; subjectPos: string; tot: string; av: string; div: string; pts: string;
  veryGood: string; good: string; weak: string; fail: string; commentClass: string; commentLead: string; teacherName: string; signature: string; headName: string; officialStamp: string; cut: string;
  ackTitle: string; ack: string; ackName: string;
};
export type PdfLogo = { bytes: Uint8Array; type: "png" | "jpg" };

const A4: [number, number] = [595.28, 841.89];
const M = 36;

const fmt = (n: number | null, d: number) => (n === null ? "-" : n.toFixed(d));

const BORDER = rgb(0.25, 0.28, 0.27);
const HEAD_FILL = rgb(0.9, 0.95, 0.92);
const TERM_FILL = rgb(0.84, 0.93, 0.88);

const fmtN = (n: number | null, d: number) => (n === null ? "-" : Number.isInteger(n) ? String(n) : n.toFixed(d));
const dmy = (iso: string) => { const [y, m, d] = iso.split("-"); return y && m && d ? `${d}-${m}-${y}` : iso; };
/** Sum of the best `n` (lowest) points: the figure a division is decided by. */
const bestSum = (points: number[], n: number | null) => (n && points.length >= n ? [...points].sort((a, b) => a - b).slice(0, n).reduce((t, p) => t + p, 0) : null);

/**
 * The school's own paper layout (annual results and evaluation report): letterhead, reference and date, the student and class,
 * "Dear Parent/Guardian", a results grid with the subjects across the top and one pair of rows (marks in %, grade) for every exam,
 * then the term result with total, average, division and points; the grading and division key; the class teacher's comments, the head
 * teacher's remarks, signature and stamp places; and a slip the parent tears off and returns. The grid's columns narrow (and
 * their text shrinks to fit) for classes with many subjects, so one student is always one page.
 */
export function renderReportCard(pdf: PDFDocument, f: Fonts, snap: ReportSnapshot, L: PdfLabels, logo: PDFImage | null, generated: string) {
  const subs = snap.subjects;
  const n = Math.max(1, subs.length);
  const size = A4;
  const page = pdf.addPage(size);
  const PW = size[0], PH = size[1];
  const M = 28;
  const W = PW - 2 * M;
  const d = snap.policy.decimals;
  const bands = snap.scale.bands;
  const rules = snap.scale.divisions ?? [];
  const bestN = snap.scale.divisionBestN;
  let y = PH - M;

  // ── Letterhead: emblem left, name and contact centred, a green rule ──
  const lh = 58;
  if (logo) {
    const sc = Math.min(lh / logo.width, lh / logo.height);
    page.drawImage(logo, { x: M, y: y - logo.height * sc, width: logo.width * sc, height: logo.height * sc });
  }
  const tl = logo ? M + lh + 8 : M;
  const tw = PW - M - tl;
  draw(page, snap.school.name.toUpperCase(), tl, y - 16, { font: f.bold, size: 17, color: GREEN, align: "center", width: tw });
  let hy = y - 31;
  if (snap.school.motto) { draw(page, snap.school.motto, tl, hy, { font: f.italic, size: 9, color: MUTED, align: "center", width: tw }); hy -= 12; }
  for (const part of [snap.school.address, [snap.school.phone, snap.school.email].filter(Boolean).join("   |   ")].filter(Boolean) as string[]) { draw(page, part, tl, hy, { font: f.regular, size: 8.5, color: INK, align: "center", width: tw }); hy -= 11; }
  y = Math.min(hy, y - lh) - 6;
  page.drawRectangle({ x: M, y, width: W, height: 2, color: GREEN });
  y -= 20;

  // ── Reference, date, name, class ──
  const ref = `${snap.term.name.replace(/\s+/g, "").toUpperCase()}/${snap.term.year}/${snap.student.admissionNo}`;
  draw(page, `${L.ref} ${ref}`, M, y, { font: f.bold, size: 9 });
  draw(page, `${L.date}:  ${dmy(generated)}`, M, y, { font: f.bold, size: 9, align: "right", width: W });
  y -= 22;
  draw(page, `${L.name.toUpperCase()}:`, M, y, { font: f.regular, size: 9 });
  draw(page, snap.student.name.toUpperCase(), M + 44, y, { font: f.bold, size: 11 });
  const clsText = `${snap.class.name}${snap.class.stream ? ` ${snap.class.stream}` : ""}`.toUpperCase();
  draw(page, `${L.class.toUpperCase()}:  ${clsText}`, M, y, { font: f.bold, size: 10, align: "right", width: W });
  y -= 18;
  draw(page, L.dear.toUpperCase(), M, y, { font: f.bold, size: 9 });
  y -= 18;
  const re = `${L.re}  ${clsText} - ${snap.term.name.toUpperCase()} ${snap.term.year}`;
  draw(page, re, M, y, { font: f.bold, size: 9.5, align: "center", width: W });
  page.drawRectangle({ x: M + (W - f.bold.widthOfTextAtSize(clean(re), 9.5)) / 2, y: y - 2, width: f.bold.widthOfTextAtSize(clean(re), 9.5), height: 0.7, color: INK });
  y -= 14;

  // ── The results grid ──
  const lblW = 64, subLblW = 56, sumW = 27;
  const subjW = (W - lblW - subLblW - 4 * sumW) / n;
  const xSub = M + lblW, xFirst = xSub + subLblW, xSum = xFirst + n * subjW;
  const box = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: BORDER, borderWidth: 0.5, ...(fill ? { color: fill } : {}) });
  const fit = (text: string, w: number, font: typeof f.bold, max: number, min = 5) => { let sz = max; while (sz > min && font.widthOfTextAtSize(clean(text), sz) > w - 3) sz -= 0.25; return sz; };
  const put = (text: string, x: number, yy: number, w: number, h: number, o: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "center" | "right" } = {}) => {
    const font = o.bold ? f.bold : f.regular;
    const sz = fit(text, w, font, o.size ?? 8);
    draw(page, text, x + 1.5, yy + (h - sz) / 2 + 1, { font, size: sz, color: o.color, align: o.align ?? "center", width: w - 3 });
  };
  const row = (yy: number, h: number, sub: string, cells: string[], sums: string[], o: { fill?: ReturnType<typeof rgb>; bold?: boolean; muted?: boolean }) => {
    box(xSub, yy, subLblW, h, o.fill);
    put(sub, xSub, yy, subLblW, h, { bold: o.bold, size: 6.5, color: o.muted ? MUTED : INK, align: "left" });
    cells.forEach((c, i) => { box(xFirst + i * subjW, yy, subjW, h, o.fill); put(c, xFirst + i * subjW, yy, subjW, h, { bold: o.bold, size: 8, color: o.muted ? MUTED : INK }); });
    sums.forEach((c, i) => { box(xSum + i * sumW, yy, sumW, h, o.fill); put(c, xSum + i * sumW, yy, sumW, h, { bold: o.bold, size: 8 }); });
  };

  // header: subject codes and the four summary columns
  const hh = 20;
  y -= hh;
  box(M, y, lblW + subLblW, hh, HEAD_FILL);
  subs.forEach((s, i) => { box(xFirst + i * subjW, y, subjW, hh, HEAD_FILL); put((s.code || s.name).toUpperCase(), xFirst + i * subjW, y, subjW, hh, { bold: true, size: 7 }); });
  [L.tot, L.av, L.div, L.pts].forEach((h, i) => { box(xSum + i * sumW, y, sumW, hh, HEAD_FILL); put(h, xSum + i * sumW, y, sumW, hh, { bold: true, size: 7 }); });

  // one pair of rows per exam
  const h1 = 18, h2 = 15;
  for (const e of snap.exams) {
    const per = subs.map((s) => s.exams.find((m) => m.examId === e.id));
    const scored = per.map((m) => (m && m.status === "SCORED" && m.percent !== null ? m.percent : null));
    const vals = scored.filter((v): v is number => v !== null);
    const tot = vals.reduce((t, v) => t + v, 0);
    const av = vals.length ? tot / vals.length : null;
    const pts = vals.map((v) => gradeFor(v, bands)?.points).filter((p): p is number => typeof p === "number");
    const sum = bestSum(pts, bestN);
    const div = sum === null ? null : rules.find((r) => sum >= r.minPoints && sum <= r.maxPoints)?.division ?? null;
    y -= h1;
    box(M, y - h2, lblW, h1 + h2);
    const nameLines = wrap(e.name.toUpperCase(), f.bold, 6.5, lblW - 6).slice(0, 3);
    nameLines.forEach((ln, i) => draw(page, ln, M + 3, y - h2 + (h1 + h2) / 2 + ((nameLines.length - 1) / 2 - i) * 8 - 2.5, { font: f.bold, size: 6.5, align: "center", width: lblW - 6 }));
    row(y, h1, L.marks, per.map((m) => (!m ? "-" : m.status === "ABSENT" ? L.absent : m.status === "EXEMPT" ? L.exempt : m.percent === null ? "-" : fmtN(m.percent, d))), [fmtN(vals.length ? tot : null, d), fmtN(av === null ? null : Math.round(av * 10 ** d) / 10 ** d, d), div ?? "", sum === null ? "" : String(sum)], {});
    y -= h2;
    row(y, h2, L.gradeRow, scored.map((v) => (v === null ? "" : gradeFor(v, bands)?.grade ?? "")), ["", av === null ? "" : gradeFor(av, bands)?.grade ?? "", "", ""], {});
  }

  // the term result
  const t1 = 19, t2 = 16;
  y -= t1;
  box(M, y - t2, lblW, t1 + t2, TERM_FILL);
  const trLines = wrap(L.termResult.toUpperCase(), f.bold, 6.5, lblW - 6).slice(0, 3);
  trLines.forEach((ln, i) => draw(page, ln, M + 3, y - t2 + (t1 + t2) / 2 + ((trLines.length - 1) / 2 - i) * 8 - 2.5, { font: f.bold, size: 6.5, align: "center", width: lblW - 6 }));
  const sm = snap.summary;
  row(y, t1, L.marks, subs.map((s) => fmtN(s.percent, d)), [fmtN(sm.total, d), fmtN(sm.average, d), sm.division ?? "", sm.pointsSum === null ? "" : String(sm.pointsSum)], { fill: TERM_FILL, bold: true });
  y -= t2;
  row(y, t2, L.gradeRow, subs.map((s) => s.grade ?? ""), ["", sm.grade ?? "", "", ""], { fill: TERM_FILL, bold: true });
  // class average and position in each subject: extra information the paper form does not have
  if (subs.some((s) => s.classMean !== null)) { y -= 14; box(M, y, lblW, 14); row(y, 14, L.classMean, subs.map((s) => fmtN(s.classMean, d)), ["", "", "", ""], { muted: true }); }
  if (subs.some((s) => s.position !== null)) { y -= 14; box(M, y, lblW, 14); row(y, 14, L.subjectPos, subs.map((s) => (s.position === null ? "-" : `${s.position}/${s.classCount}`)), ["", "", "", ""], { muted: true }); }

  // ── Key: grades (with the school's words) and divisions ──
  y -= 24;
  const desc: Record<string, string> = { A: L.veryGood, B: L.good, C: L.average, D: L.weak, F: L.fail };
  draw(page, L.key.toUpperCase(), M, y, { font: f.bold, size: 8, color: GREEN });
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  sorted.forEach((b, i) => {
    const yy = y - 13 - i * 11;
    draw(page, b.grade, M + 4, yy, { font: f.bold, size: 8.5 });
    draw(page, `${b.min} - ${b.max}`, M + 28, yy, { font: f.regular, size: 8.5 });
    if (desc[b.grade]) draw(page, `- ${desc[b.grade]!.toUpperCase()}`, M + 78, yy, { font: f.regular, size: 8.5, color: MUTED });
  });
  if (rules.length) {
    const dx = M + W * 0.52;
    draw(page, L.division.toUpperCase(), dx, y, { font: f.bold, size: 8, color: GREEN });
    [...rules].sort((a, b) => a.minPoints - b.minPoints).forEach((r, i) => {
      const yy = y - 13 - i * 11;
      draw(page, `${L.div} ${r.division}`, dx + 4, yy, { font: f.bold, size: 8.5 });
      draw(page, `${L.pts} ${r.minPoints} - ${r.maxPoints}`, dx + 66, yy, { font: f.regular, size: 8.5 });
    });
  }
  y -= 13 + Math.max(sorted.length, rules.length) * 11 + 24;

  // ── Result line: division, points, position ──
  const sum = snap.summary;
  const cells: [string, string][] = [
    ...(bestN ? ([[L.division, sum.division ?? "-"], [L.points, sum.pointsSum === null ? "-" : String(sum.pointsSum)]] as [string, string][]) : []),
    [L.average, fmtN(sum.average, d)],
    [L.classPosition, sum.position === null ? "-" : `${sum.position} ${L.of} ${sum.classSize}`],
    ...(sum.streamPosition !== null && sum.streamSize ? ([[L.streamPosition, `${sum.streamPosition} ${L.of} ${sum.streamSize}`]] as [string, string][]) : []),
  ];
  const cw = W / cells.length;
  page.drawRectangle({ x: M, y: y - 10, width: W, height: 34, borderColor: GREEN, borderWidth: 1 });
  cells.forEach(([label, value], i) => {
    const x = M + i * cw;
    if (i > 0) page.drawRectangle({ x, y: y - 10, width: 0.5, height: 34, color: LINE });
    draw(page, label.toUpperCase(), x, y + 12, { font: f.regular, size: 7, color: MUTED, align: "center", width: cw });
    draw(page, value, x, y - 4, { font: f.bold, size: 12, align: "center", width: cw });
  });
  y -= 28;
  if (bestN && sum.division === "INC") { draw(page, L.incNote, M, y, { font: f.italic, size: 7, color: MUTED }); y -= 10; }

  // attendance
  y -= 4;
  const a = snap.attendance;
  const attText = a.recorded === 0 ? L.attNone : `${L.attDays}: ${a.recorded}   |   ${L.attPresent}: ${a.present}   |   ${L.attAbsent}: ${a.absent}   |   ${L.attLate}: ${a.late}   |   ${L.attExcused}: ${a.excused}   |   ${L.attRate}: ${a.ratePct === null ? "-" : `${a.ratePct}%`}`;
  draw(page, `${L.attendance.toUpperCase()}:  ${attText}`, M, y, { font: f.regular, size: 8 });
  y -= 16;

  // ── Comments and signatures, numbered like the paper form ──
  const comment = (no: number, title: string, text: string | null, lead?: string) => {
    draw(page, `${no}.  ${title.toUpperCase()}:`, M, y, { font: f.bold, size: 8.5 });
    if (lead) draw(page, lead, M + 190, y, { font: f.regular, size: 8.5, color: MUTED });
    y -= 13;
    const lines = wrap(text ?? "", f.bold, 9.5, W - 20).slice(0, 3);
    if (lines.length === 0) { page.drawRectangle({ x: M + 8, y: y - 2, width: W - 16, height: 0.5, color: LINE }); y -= 13; }
    lines.forEach((ln) => { draw(page, ln, M + 10, y, { font: f.bold, size: 9.5 }); page.drawRectangle({ x: M + 8, y: y - 2, width: W - 16, height: 0.5, color: LINE }); y -= 13; });
    y -= 2;
  };
  const sign = (no: number, title: string, stamp = false) => {
    draw(page, `${no}.  ${title.toUpperCase()}:`, M, y, { font: f.bold, size: 8.5 });
    page.drawRectangle({ x: M + 150, y: y - 2, width: 170, height: 0.6, color: INK });
    draw(page, `${L.signature}`, M + 328, y, { font: f.regular, size: 8.5 });
    page.drawRectangle({ x: M + 372, y: y - 2, width: 120, height: 0.6, color: INK });
    if (stamp) {
      page.drawRectangle({ x: PW - M - 62, y: y - 36, width: 62, height: 54, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
      draw(page, L.officialStamp, PW - M - 62, y - 30, { font: f.regular, size: 6.5, color: MUTED, align: "center", width: 62 });
    }
    y -= stamp ? 40 : 18;
  };
  comment(2, L.commentClass, snap.remarks.class, L.commentLead);
  sign(3, L.teacherName);
  comment(4, L.remarkHead, snap.remarks.head);
  sign(5, L.headName, true);

  // ── Tear-off slip for the parent ──
  y -= 14;
  for (let x = M; x < PW - M; x += 9) page.drawRectangle({ x, y, width: 5, height: 0.6, color: MUTED });
  draw(page, L.cut, M, y + 3, { font: f.regular, size: 6.5, color: MUTED, align: "center", width: W });
  y -= 14;
  draw(page, L.ackTitle.toUpperCase(), M, y, { font: f.bold, size: 8 });
  y -= 12;
  draw(page, L.ack.replace("{name}", snap.student.name).replace("{class}", clsText).replace("{term}", `${snap.term.name} ${snap.term.year}`), M, y, { font: f.regular, size: 8.5 });
  y -= 18;
  const slip = [[L.ackName, 200], [L.signature, 150], [L.date, 100]] as const;
  let sx = M;
  for (const [label, w] of slip) { draw(page, `${label}:`, sx, y, { font: f.regular, size: 8 }); page.drawRectangle({ x: sx + f.regular.widthOfTextAtSize(clean(label), 8) + 6, y: y - 2, width: w - f.regular.widthOfTextAtSize(clean(label), 8) - 10, height: 0.6, color: INK }); sx += w + 14; }
  draw(page, L.generated.replace("{date}", generated), M, 14, { font: f.regular, size: 6.5, color: MUTED });
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
