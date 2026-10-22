import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as prog from "@/server/progression";
import { registrationWhy } from "@/server/annual-registration";
import { updateLifecycleSettings } from "@/server/lifecycle-settings";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/* The registration page explains the decision: who made it, the note, any exception, the report card and the teachers' comments. */

let admin: AuthContext, registrar: AuthContext, teacher: AuthContext;
let regId: string, otherSchoolRegistrar: AuthContext;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  const setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  const y = setup.yearNo + 1;
  await academics.createAcademicYear(admin, { name: `${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, registrationOpensOn: `${y - 1}-01-01`, registrationClosesOn: `${y}-01-31` });
  await updateLifecycleSettings(admin, { requireHeadApproval: "", promotionMinAverage: "", feePolicy: "INFORM_ONLY", previousDebtCounts: "" });
  const kid = await students.createStudent(registrar, studentInput(990001, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  await prog.decideProgressions(admin, { yearId: setup.year.id, studentIds: [kid.id], outcome: "REPEAT", toClassId: setup.cls.id, note: "Needs another year in this grade", exceptionReason: "Test: no results yet" });
  const live = await db.studentProgression.findFirstOrThrow({ where: { studentId: kid.id, status: { not: "SUPERSEDED" } } });
  await prog.approveProgressions(admin, { ids: [live.id] });
  regId = (await db.annualRegistration.findFirstOrThrow({ where: { studentId: kid.id } })).id;
  otherSchoolRegistrar = (await createTestUser((await createTestSchool()).id, ["registrar"])).ctx;
});

describe("why this decision", () => {
  it("shows the decision, who made it, the note and the exception; no report card yet", async () => {
    const w = await registrationWhy(registrar, regId);
    expect(w.decision).toMatchObject({ outcome: "REPEAT", status: "APPROVED", note: "Needs another year in this grade", exceptionReason: expect.stringContaining("no results yet"), preparedBy: expect.any(String), approvedBy: expect.any(String) });
    expect(w.decision.toClass).toBe(w.decision.fromClass); // repeating the same grade
    expect(w.canSeeMarks).toBe(true); // the registrar may read report cards (read-only)
    expect(w.card).toBeNull();
  });

  it("shows the latest report card with the teachers' comments exactly as printed", async () => {
    const reg = await db.annualRegistration.findUniqueOrThrow({ where: { id: regId }, include: { student: true } });
    const term = await db.term.findFirstOrThrow({ where: { schoolId: reg.schoolId }, orderBy: { startsOn: "desc" } });
    const snapshot = {
      schema: 1, term: { id: term.id, name: "Term 1", year: "2026", startsOn: "2026-01-05", endsOn: "2026-06-26" }, class: { id: reg.progressionId, name: "Standard I", stream: "A", level: "Primary" },
      subjects: [{ subjectId: reg.studentId, name: "Mathematics", code: "MATH", exams: [], percent: 71.5, grade: "B", points: null, position: 3, classMean: 60, classCount: 10 }],
      summary: { total: 71.5, average: 71.5, grade: "B", pointsSum: null, division: null, subjectCount: 1, position: 3, classSize: 10, streamPosition: null, streamSize: null },
      attendance: { recorded: 20, present: 18, absent: 2, late: 0, excused: 0, ratePct: 90 }, remarks: { class: "Works well when focused.", head: "Keep it up." }, generatedAt: new Date().toISOString(),
    };
    await db.reportCard.create({ data: { schoolId: reg.schoolId, studentId: reg.studentId, termId: term.id, classId: (await db.schoolClass.findFirstOrThrow({ where: { schoolId: reg.schoolId } })).id, status: "GENERATED", snapshot, generatedAt: new Date(), generatedById: admin.userId, version: 1 } as never });
    const w = await registrationWhy(registrar, regId);
    expect(w.card).toMatchObject({ term: "Term 1 · 2026", summary: { average: 71.5, grade: "B", position: 3, classSize: 10 }, remarks: { class: "Works well when focused.", head: "Keep it up." }, attendance: { ratePct: 90, present: 18, recorded: 20 } });
    expect(w.card!.subjects[0]).toMatchObject({ name: "Mathematics", percent: 71.5, classMean: 60 });
  });

  it("needs registration.read, and never reaches another school's registration", async () => {
    expect(await code(registrationWhy(teacher, regId))).toBe("FORBIDDEN");
    expect(await code(registrationWhy(otherSchoolRegistrar, regId))).toBe("NOT_FOUND");
  });
});
