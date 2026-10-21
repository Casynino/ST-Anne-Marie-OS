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
  child: { entry: string; transferReason: string | null; previousAdmissionNo: string | null; name: string; dateOfBirth: string; gender: string; nationality: string | null; religion: string | null; birthCertificateNo: string | null; previousSchool: string | null; previousClass: string | null; address: string | null; healthNotes: string | null };
  /** The child's passport photo when it is a JPEG or PNG (the PDF format cannot embed other picture types). */
  photo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  guardians: { name: string; relationship: string; phone: string; email: string | null; occupation: string | null }[];
  emergency: { name: string; relationship: string; phone: string } | null;
  /** What the family added: the kind of each file and its name. */
  files: { label: string; fileName: string }[];
  /** The interview, once a date is set (set by the school in advance, or given by the office). */
  interview: { when: string; venue: string | null } | null;
  fee: { amount: string; paidOn: string; reference: string; receiptNo: string; test: boolean } | null;
  /** The fee still to be paid (a form filled in at the office before the family has paid): the amount, the reference to quote and how to pay. */
  pay: { amount: string; reference: string; instructions: string | null } | null;
  documents: string[];
};
export type ApplicationFormLabels = {
  title: string; applicationNo: string; submitted: string; classApplied: string; child: string; name: string; dateOfBirth: string; gender: string; nationality: string; previousSchool: string; address: string;
  entry: string; transferReason: string; previousAdmissionNo: string; guardians: string; relationship: string; phone: string; email: string; religion: string; birthCert: string; previousClass: string; health: string; occupation: string; emergency: string; guardian2: string; files: string; fee: string; amountPaid: string; paidOn: string; reference: string; receiptNo: string; testNote: string;
  interview: string; interviewWhen: string; venue: string;
  documents: string; documentsIntro: string; consent: string; keep: string;
  payTitle: string; payAmount: string; payHow: string; payBring: string; notSubmitted: string; signGuardian: string; signOffice: string;
};

export async function renderApplicationForm(pdf: PDFDocument, f: Fonts, d: ApplicationFormDoc, L: ApplicationFormLabels, logo: PDFImage | null) {
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
  draw(page, `${d.pay ? L.reference : L.applicationNo}: ${d.applicationNo}`, M, y + 3, { font: f.bold, size: 12, align: "right", width: W - 10 });
  y -= 26;
  draw(page, `${d.pay ? L.notSubmitted : L.submitted}: ${d.submittedOn}`, M, y, { font: f.regular, size: 9.5, color: MUTED });
  y -= 22;

  const section = (title: string) => {
    ensure(40);
    draw(page, title.toUpperCase(), M, y, { font: f.bold, size: 9.5, color: GREEN });
    y -= 5;
    page.drawRectangle({ x: M, y, width: W, height: 0.8, color: GREEN });
    y -= 15;
  };
  const row = (label: string, value: string | null | undefined, narrow = 0) => {
    if (!value) return;
    const lines = wrap(value, f.bold, 10.5, W - 160 - narrow);
    ensure(16 * lines.length + 2);
    draw(page, label, M, y, { font: f.regular, size: 9.5, color: MUTED });
    lines.forEach((ln, i) => draw(page, ln, M + 160, y - i * 14, { font: f.bold, size: 10.5 }));
    y -= 15 * lines.length + 3;
  };

  section(L.child);
  const photoTop = y + 6;
  let narrow = 0;
  if (d.photo) {
    try {
      const img = d.photo.type === "png" ? await pdf.embedPng(d.photo.bytes) : await pdf.embedJpg(d.photo.bytes);
      const scale = Math.min(84 / img.width, 108 / img.height);
      const w = img.width * scale, h = img.height * scale;
      page.drawRectangle({ x: M + W - 88, y: photoTop - 112, width: 88, height: 112, borderColor: LINE, borderWidth: 0.8 });
      page.drawImage(img, { x: M + W - 88 + (88 - w) / 2, y: photoTop - 112 + (112 - h) / 2, width: w, height: h });
      narrow = 100;
    } catch { /* an unreadable picture is simply left out */ }
  }
  row(L.entry, d.child.entry, narrow);
  row(L.name, d.child.name, narrow);
  row(L.classApplied, d.className, narrow);
  row(L.dateOfBirth, d.child.dateOfBirth, narrow);
  row(L.gender, d.child.gender, narrow);
  row(L.nationality, d.child.nationality, narrow);
  row(L.religion, d.child.religion, narrow);
  row(L.birthCert, d.child.birthCertificateNo, narrow);
  row(L.previousSchool, d.child.previousSchool, narrow);
  row(L.previousClass, d.child.previousClass);
  row(L.previousAdmissionNo, d.child.previousAdmissionNo);
  row(L.transferReason, d.child.transferReason);
  row(L.address, d.child.address);
  row(L.health, d.child.healthNotes);
  if (narrow && y > photoTop - 118) y = photoTop - 118; // keep the next section below the photo
  y -= 8;

  section(L.guardians);
  d.guardians.forEach((g, i) => {
    if (i > 0) { page.drawRectangle({ x: M, y: y + 6, width: W, height: 0.5, color: LINE }); y -= 6; draw(page, L.guardian2, M, y, { font: f.italic, size: 9, color: MUTED }); y -= 14; }
    row(L.name, g.name);
    row(L.relationship, g.relationship);
    row(L.phone, g.phone);
    row(L.email, g.email);
    row(L.occupation, g.occupation);
  });
  y -= 8;

  if (d.emergency) {
    section(L.emergency);
    row(L.name, d.emergency.name);
    row(L.relationship, d.emergency.relationship);
    row(L.phone, d.emergency.phone);
    y -= 8;
  }

  if (d.interview) {
    section(L.interview);
    row(L.interviewWhen, d.interview.when);
    row(L.venue, d.interview.venue);
    y -= 8;
  }

  if (d.fee) {
    section(L.fee);
    row(L.amountPaid, d.fee.amount);
    row(L.paidOn, d.fee.paidOn);
    row(L.reference, d.fee.reference);
    row(L.receiptNo, d.fee.receiptNo);
    if (d.fee.test) { ensure(18); draw(page, L.testNote, M, y, { font: f.italic, size: 9, color: MUTED }); y -= 16; }
    y -= 8;
  }

  if (d.pay) {
    section(L.payTitle);
    row(L.payAmount, d.pay.amount);
    row(L.reference, d.pay.reference);
    row(L.payHow, d.pay.instructions);
    wrap(L.payBring, f.regular, 10, W).forEach((ln) => { ensure(14); draw(page, ln, M, y, { font: f.regular, size: 10 }); y -= 14; });
    y -= 8;
  }

  if (d.documents.length > 0 && d.pay) {
    // The copy handed over at the office stays on one page: the papers are listed on a single line.
    section(L.documents);
    wrap(d.documents.join(",  "), f.regular, 10.5, W).forEach((ln) => { ensure(14); draw(page, ln, M, y, { font: f.regular, size: 10.5 }); y -= 14; });
    y -= 8;
  } else if (d.documents.length > 0) {
    section(L.documents);
    wrap(L.documentsIntro, f.regular, 10, W).forEach((ln) => { ensure(14); draw(page, ln, M, y, { font: f.regular, size: 10 }); y -= 14; });
    y -= 2;
    for (const doc of d.documents) { ensure(15); draw(page, `-  ${doc}`, M + 8, y, { font: f.regular, size: 10.5 }); y -= 15; }
    y -= 8;
  }

  if (d.files.length > 0) {
    section(L.files);
    for (const file of d.files) { ensure(15); draw(page, `-  ${file.label}: ${file.fileName}`, M + 8, y, { font: f.regular, size: 10 }); y -= 14; }
    y -= 8;
  }

  if (d.pay) {
    ensure(60);
    y -= 18;
    page.drawRectangle({ x: M, y, width: W / 2 - 20, height: 0.6, color: MUTED });
    page.drawRectangle({ x: M + W / 2 + 20, y, width: W / 2 - 20, height: 0.6, color: MUTED });
    draw(page, L.signGuardian, M, y - 12, { font: f.regular, size: 9, color: MUTED });
    draw(page, L.signOffice, M + W / 2 + 20, y - 12, { font: f.regular, size: 9, color: MUTED });
    y -= 28;
  }
  ensure(50);
  wrap(L.consent, f.italic, 9, W).forEach((ln) => { draw(page, ln, M, y, { font: f.italic, size: 9, color: MUTED }); y -= 12; });
  y -= 6;
  wrap(L.keep, f.regular, 9, W).forEach((ln) => { draw(page, ln, M, y, { font: f.regular, size: 9, color: MUTED }); y -= 12; });
}

export async function buildApplicationFormPdf(d: ApplicationFormDoc, L: ApplicationFormLabels, logo?: PdfLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`${L.title} ${d.applicationNo}`));
  await renderApplicationForm(pdf, await fonts(pdf), d, L, await logoOf(pdf, logo));
  return pdf.save();
}
