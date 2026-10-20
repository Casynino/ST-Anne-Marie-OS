import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildReportCardsPdf, type PdfLabels } from "@/lib/pdf/report-card";
import { sameContent, type ReportSnapshot } from "@/lib/results/report-types";
import { pdfLabels } from "@/server/report-card-pdf";

const labels: PdfLabels = pdfLabels("EN");

function snap(i: number, subjects = 12, name = `Student Number ${i}`): ReportSnapshot {
  return {
    schema: 1,
    school: { name: "Test School", motto: "Motto", address: "Somewhere, Dar es Salaam", phone: "+255700000000", email: "info@test.example" },
    student: { id: `s${i}`, admissionNo: `T/2026/${String(i).padStart(4, "0")}`, name, gender: i % 2 ? "MALE" : "FEMALE", dateOfBirth: "2012-03-04" },
    term: { id: "t", name: "Term 3", year: "2026", startsOn: "2026-09-01", endsOn: "2026-12-04" },
    class: { id: "c", name: "Form I", stream: "A", level: "O-Level" },
    scale: { name: "Scale", bands: [{ grade: "A", min: 80, max: 100, points: 1 }, { grade: "B", min: 60, max: 79, points: 2 }, { grade: "F", min: 0, max: 59, points: 5 }], passMark: 40, divisionBestN: 7 },
    policy: { absentAs: "EXCLUDE", positionBy: "AVERAGE", decimals: 1 },
    exams: [{ id: "e1", name: "Midterm", weight: 40 }, { id: "e2", name: "Terminal", weight: 60 }],
    subjects: Array.from({ length: subjects }, (_, k) => ({
      subjectId: `sub${k}`, name: `Subject ${k + 1} with a fairly long name`, code: `S${k}`,
      exams: [
        { examId: "e1", examName: "Midterm", status: "SCORED" as const, score: 60 + (k % 30), maxMarks: 100, percent: 60 + (k % 30) },
        { examId: "e2", examName: "Terminal", status: k === 3 ? ("ABSENT" as const) : ("SCORED" as const), score: k === 3 ? null : 70, maxMarks: 100, percent: k === 3 ? null : 70 },
      ],
      percent: 68.5, grade: "B", points: 2, position: (i % 40) + 1, classMean: 61.2, classCount: 50,
    })),
    summary: { total: 800.5, average: 68.5, grade: "B", pointsSum: 24, division: "II", subjectCount: subjects, position: (i % 40) + 1, classSize: 50, streamPosition: 3, streamSize: 25 },
    attendance: { recorded: 60, present: 55, absent: 3, late: 1, excused: 1, ratePct: 91.7 },
    remarks: { class: "A hardworking learner. ".repeat(12), head: null },
    generatedAt: "2026-10-20T10:00:00.000Z",
  };
}

describe("report card PDF", () => {
  it("renders a class of 60 cards quickly, one page each", async () => {
    const t0 = Date.now();
    const bytes = await buildReportCardsPdf(Array.from({ length: 60 }, (_, i) => snap(i + 1)), labels, { generated: "2026-10-20" });
    const ms = Date.now() - t0;
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(60);
    expect(ms).toBeLessThan(20_000); // the requirement is 50 cards in under two minutes
    expect(bytes.length).toBeLessThan(5_000_000);
  });

  it("never fails on unusual text, many subjects, long words or missing data", async () => {
    const odd = snap(1, 22, "Zoë Ñandú 李雷 😀 " + "W".repeat(80));
    odd.remarks = { class: "😀 émoji and 李 and a looooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong word", head: "“quoted” – dash … ellipsis" };
    odd.school.motto = null;
    odd.attendance = { recorded: 0, present: 0, absent: 0, late: 0, excused: 0, ratePct: null };
    odd.summary = { ...odd.summary, position: null, streamPosition: null, streamSize: null, division: "INC", pointsSum: null };
    const few = snap(2, 1);
    const manyExams = snap(3, 5);
    manyExams.exams = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, name: `Exam ${i}`, weight: 10 }));
    const bytes = await buildReportCardsPdf([odd, few, manyExams], pdfLabels("SW"), { generated: "2026-10-20" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it("detects real changes but ignores key order and generation time", () => {
    const a = snap(1);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse()))) as ReportSnapshot; // different key order
    reordered.generatedAt = "2030-01-01T00:00:00.000Z";
    expect(sameContent(a, reordered)).toBe(true);
    const b = snap(1);
    b.remarks.head = "Changed";
    expect(sameContent(a, b)).toBe(false);
    const c = snap(1);
    c.subjects[0]!.percent = 69;
    expect(sameContent(a, c)).toBe(false);
  });
});
