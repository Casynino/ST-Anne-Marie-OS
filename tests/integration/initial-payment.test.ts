import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as fees from "@/server/fees";
import * as payments from "@/server/payments";
import * as prog from "@/server/progression";
import * as annualFees from "@/server/annual-fees";
import * as reg from "@/server/annual-registration";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/*
 * The school's initial payment for annual registration: a share of the first term's bill that VERIFIED payments must cover before a returning
 * student counts as cleared. It follows each grade's own fee, and without it the fixed limit applies as before.
 */

let admin: AuthContext, accountant: AuthContext, registrar: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let nextYear: { id: string };
let kid: { id: string };
let std2: { id: string };
let n = 900000 + Math.floor(Math.random() * 6_000_000);

const state = async () => (await annualFees.annualFeeBoard(accountant, { yearId: nextYear.id })).rows.find((r) => r.studentId === kid.id)!;

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  std2 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2 });
  const y = setup.yearNo + 1;
  nextYear = await academics.createAcademicYear(admin, { name: `${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31` });
  await academics.createTerm(admin, { academicYearId: nextYear.id, name: "Term 1", sequence: 1, startsOn: `${y}-01-05`, endsOn: `${y}-12-20` });
  const tuition = await fees.createFeeItem(accountant, { name: "Tuition", category: "TUITION" });
  await fees.createStructure(accountant, { academicYearId: nextYear.id, name: "Std II next", classId: std2.id, lines: [{ feeItemId: tuition.id, amount: "200000", termSequence: null }] });
  kid = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  await prog.decideProgressions(admin, { yearId: setup.year.id, studentIds: [kid.id], outcome: "PROMOTED", toClassId: std2.id, exceptionReason: "Test: results not finalised" });
  const live = await db.studentProgression.findFirstOrThrow({ where: { studentId: kid.id, fromAcademicYearId: setup.year.id, status: { not: "SUPERSEDED" } } });
  await prog.approveProgressions(admin, { ids: [live.id] });
  const r = await db.annualRegistration.findUniqueOrThrow({ where: { studentId_academicYearId: { studentId: kid.id, academicYearId: nextYear.id } } });
  await reg.placeReturning(registrar, { registrationId: r.id, classId: std2.id }); // billing follows the placement
  await annualFees.billReturningStudents(accountant, { yearId: nextYear.id, dueDate: `${y}-03-31` });
});

describe("initial payment for annual registration", () => {
  it("without a percentage the fixed limit (0) applies: only the full bill clears", async () => {
    expect((await state()).state).toBe("OUTSTANDING");
  });

  it("with 25% set, the student is cleared only once VERIFIED payments reach 25% of THIS grade's first-term bill", async () => {
    await fees.updateFeeSettings(accountant, { defaultDueDays: "14", clearanceMaxOutstanding: "0", initialPaymentPct: "25" });
    expect((await fees.getFeeSettings(db, admin.schoolId)).initialPaymentPct).toBe(25);
    await payments.recordPayment(accountant, { studentId: kid.id, amount: "30000", method: "CASH" });
    expect((await state()).state).toBe("OUTSTANDING"); // 30,000 of 200,000 is 15%
    await payments.recordPayment(accountant, { studentId: kid.id, amount: "20000", method: "CASH" });
    const s = await state();
    expect(s.state).toBe("CLEARED"); // 50,000 is exactly 25%
    expect(s.firstTerm).toMatchObject({ charged: 20_000_000, paid: 5_000_000, outstanding: 15_000_000 }); // the balance itself is untouched
  });

  it("leaving it empty turns the rule off again", async () => {
    await fees.updateFeeSettings(accountant, { defaultDueDays: "14", clearanceMaxOutstanding: "0", initialPaymentPct: "" });
    expect((await fees.getFeeSettings(db, admin.schoolId)).initialPaymentPct).toBeNull();
    expect((await state()).state).toBe("OUTSTANDING");
  });
});
