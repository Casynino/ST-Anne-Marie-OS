import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import * as students from "@/server/students";
import * as portal from "@/server/portal";
import { childProgressTable, studentAttendanceTable, studentFeesTable, studentMarksTable, studentSummaryTable } from "@/server/student-exports";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/* One student's reports as downloads: staff get what they may see (no fees without fee access), a parent gets their own child's progress from
 * PUBLISHED cards only, and another family's child is "not found". */

let admin: AuthContext, registrar: AuthContext, teacher: AuthContext, parent: AuthContext, otherParent: AuthContext;
let kidId: string, otherKidId: string;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

async function family(setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>, n: number) {
  const kid = await students.createStudent(registrar, studentInput(n, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  const g = (await db.studentGuardian.findFirstOrThrow({ where: { studentId: kid.id }, select: { guardianId: true } })).guardianId;
  await portal.createGuardianAccount(admin, g);
  const ctx = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g } })).userId!);
  return { kid, ctx };
}

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  const setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  const base = 8_200_000 + Math.floor(Math.random() * 700_000);
  const a = await family(setup, base), b = await family(setup, base + 1);
  kidId = a.kid.id; parent = a.ctx; otherKidId = b.kid.id; otherParent = b.ctx;
  const mk = (studentId: string, status: "PUBLISHED" | "GENERATED") => db.reportCard.create({ data: {
    schoolId: school.id, studentId, termId: setup.term.id, classId: setup.cls.id, status, generatedById: admin.userId, generatedAt: new Date(), version: 1,
    ...(status === "PUBLISHED" ? { publishedById: admin.userId, publishedAt: new Date() } : {}),
    snapshot: { schema: 1, exams: [], term: { id: setup.term.id, name: "Term 1", year: "2026", startsOn: "2026-01-05", endsOn: "2026-06-26" }, class: { id: setup.cls.id, name: "Standard I", stream: "A", level: "Primary" },
      subjects: [{ subjectId: setup.cls.id, name: "Mathematics", code: "MATH", exams: [], percent: 71.5, grade: "B", points: null, position: 3, classMean: 60, classCount: 10 }],
      summary: { total: 71.5, average: 71.5, grade: "B", pointsSum: null, division: null, subjectCount: 1, position: 3, classSize: 10, streamPosition: null, streamSize: null },
      attendance: { recorded: 0, present: 0, absent: 0, late: 0, excused: 0, ratePct: null }, remarks: { class: null, head: null }, generatedAt: new Date().toISOString() },
  } as never });
  await mk(kidId, "PUBLISHED");
  await mk(otherKidId, "GENERATED"); // not published: the other family must see nothing, and nobody sees it through the parent route
});

describe("a student's downloads", () => {
  it("staff: the progress summary and marks hold what the person may see; fees need fee access", async () => {
    const sum = await studentSummaryTable(registrar, kidId);
    expect(sum.rows.some((r) => r[1] === "Student ID")).toBe(true);
    expect(sum.rows.some((r) => r[0] === "Fees")).toBe(false); // the registrar has no fee access
    const marks = await studentMarksTable(registrar, kidId);
    expect(marks.rows.some((r) => r[1] === "Mathematics" && r[2] === 71.5)).toBe(true);
    expect((await studentAttendanceTable(registrar, kidId)).title).toContain("Attendance");
    expect(await code(studentFeesTable(registrar, kidId))).toBe("FORBIDDEN");
    expect((await studentFeesTable(admin, kidId)).title).toContain("Fee statement");
  });

  it("a teacher outside the student's classes cannot download anything about the student", async () => {
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(await code(studentSummaryTable(teacher, kidId)));
  });

  it("a parent gets their own child's progress from published cards; another family's child is not found", async () => {
    const t = await childProgressTable(parent, kidId);
    expect(t.rows.some((r) => r[1] === "Mathematics" && r[2] === 71.5)).toBe(true);
    expect(await code(childProgressTable(parent, otherKidId))).toBe("NOT_FOUND");
    expect((await childProgressTable(otherParent, otherKidId)).rows).toHaveLength(0); // their own card is not published yet
  });
});
