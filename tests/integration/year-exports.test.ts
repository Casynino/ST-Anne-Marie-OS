import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as prog from "@/server/progression";
import * as reg from "@/server/annual-registration";
import { annualFeesTable, progressionTable, registrationTable, yearSummaryTable } from "@/server/year-exports";
import { updateLifecycleSettings } from "@/server/lifecycle-settings";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/* The next-year progress as downloads: every row (not one page), the screen's permissions, no money for people who may not read fees,
 * and a reopened registration forgets the old "registered on" date. */

let admin: AuthContext, registrar: AuthContext, teacher: AuthContext;
let regId: string, setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  const y = setup.yearNo + 1;
  await academics.createAcademicYear(admin, { name: `${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, registrationOpensOn: `${y - 1}-01-01`, registrationClosesOn: `${y}-01-31` });
  await updateLifecycleSettings(admin, { requireHeadApproval: "", promotionMinAverage: "", feePolicy: "INFORM_ONLY", previousDebtCounts: "" });
  const base = 8_000_000 + Math.floor(Math.random() * 1_000_000);
  for (let i = 0; i < 3; i++) {
    const kid = await students.createStudent(registrar, studentInput(base + i, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
    await prog.decideProgressions(admin, { yearId: setup.year.id, studentIds: [kid.id], outcome: "REPEAT", toClassId: setup.cls.id, exceptionReason: "Test: no results yet" });
    const live = await db.studentProgression.findFirstOrThrow({ where: { studentId: kid.id, status: { not: "SUPERSEDED" } } });
    await prog.approveProgressions(admin, { ids: [live.id] });
    if (i === 0) regId = (await db.annualRegistration.findFirstOrThrow({ where: { studentId: kid.id } })).id;
  }
});

describe("next-year downloads", () => {
  it("the registration list has every student, with the screen's filters, and no money for the registrar", async () => {
    const all = await registrationTable(registrar, {});
    expect(all.rows).toHaveLength(3);
    expect(all.columns.map((c) => c.label)).not.toContain("First term owed");
    expect(all.rows[0]).toContain("Repeating");
    const none = await registrationTable(registrar, { stage: "ACTIVE" });
    expect(none.rows).toHaveLength(0);
    expect((await registrationTable(admin, {})).columns.map((c) => c.label)).toContain("First term owed");
  });

  it("the decisions list and the progress summary", async () => {
    const t = await progressionTable(admin, {});
    expect(t.rows.length).toBeGreaterThanOrEqual(3);
    expect(t.rows.some((r) => r.includes("Repeating") && r.includes("Approved"))).toBe(true);
    const s = await yearSummaryTable(admin);
    expect(s.rows.some((r) => r[1] === "Approved to repeat" && r[2] === 3)).toBe(true);
  });

  it("the fee list needs fee access; the lists need their own permissions", async () => {
    expect(await code(annualFeesTable(registrar, {}))).toBe("FORBIDDEN");
    expect((await annualFeesTable(admin, {})).rows.length).toBe(3);
    expect(await code(registrationTable(teacher, {}))).toBe("FORBIDDEN");
    expect(await code(progressionTable(teacher, {}))).toBe("FORBIDDEN");
  });

  it("a reopened registration forgets the old registered date", async () => {
    await reg.placeReturning(registrar, { registrationId: regId, classId: setup.cls.id, streamId: setup.streams[0]!.id });
    await reg.confirmRegistration(registrar, { registrationId: regId, confirmed: "on" });
    expect((await db.annualRegistration.findUniqueOrThrow({ where: { id: regId } })).registeredAt).not.toBeNull();
    await reg.cancelRegistration(registrar, { registrationId: regId, reason: "Test: the family asked to start again" });
    await reg.reopenRegistration(registrar, { registrationId: regId });
    expect(await db.annualRegistration.findUniqueOrThrow({ where: { id: regId } })).toMatchObject({ status: "PENDING", registeredAt: null, registeredById: null });
  });
});
