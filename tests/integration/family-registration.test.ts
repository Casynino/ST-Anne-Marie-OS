import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext } from "@/lib/auth/context";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as portal from "@/server/portal";
import * as reg from "@/server/annual-registration";
import * as prog from "@/server/progression";
import { updateLifecycleSettings } from "@/server/lifecycle-settings";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/*
 * The family registers their own child for next year: the decision must be final, the registration window open, the class not full and the
 * school's fee rule met; the child is placed in the decided grade and confirmed in one step; nobody else's child can be registered.
 */

let admin: AuthContext, registrar: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let std2: { id: string };
let nextYear: { id: string };
let n = 700000 + Math.floor(Math.random() * 6_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const setPolicy = (feePolicy = "INFORM_ONLY") => updateLifecycleSettings(admin, { requireHeadApproval: "", promotionMinAverage: "", feePolicy, previousDebtCounts: "" });

/** A student in Standard I with a parent account, and (optionally) an approved PROMOTED decision to Standard II. */
async function child(opts: { decide?: boolean; outcome?: "PROMOTED" | "REPEAT" } = {}) {
  const kid = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  const g = (await db.studentGuardian.findFirstOrThrow({ where: { studentId: kid.id }, select: { guardianId: true } })).guardianId;
  await portal.createGuardianAccount(registrar, g);
  const parent = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g } })).userId!);
  if (opts.decide !== false) {
    const outcome = opts.outcome ?? "PROMOTED";
    await prog.decideProgressions(admin, { yearId: setup.year.id, studentIds: [kid.id], outcome, toClassId: outcome === "PROMOTED" ? std2.id : setup.cls.id, exceptionReason: "Test: results not finalised" });
    const live = await db.studentProgression.findFirstOrThrow({ where: { studentId: kid.id, fromAcademicYearId: setup.year.id, status: { not: "SUPERSEDED" } } });
    await prog.approveProgressions(admin, { ids: [live.id] });
  }
  return { kid, parent };
}
const regOf = (studentId: string) => db.annualRegistration.findUniqueOrThrow({ where: { studentId_academicYearId: { studentId, academicYearId: nextYear.id } } });

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  std2 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2, capacity: "2" });
  await academics.createStream(admin, std2.id, "A");
  await academics.createStream(admin, std2.id, "B");
  const y = setup.yearNo + 1;
  nextYear = await academics.createAcademicYear(admin, { name: `${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, registrationOpensOn: `${y - 1}-01-01`, registrationClosesOn: `${y}-01-31` });
  await setPolicy();
});

describe("a family registers its own child for next year", () => {
  it("shows nothing until the Academic Office's decision is final", async () => {
    const { kid, parent } = await child({ decide: false });
    expect(await reg.familyRegistrationView(parent, kid.id)).toBeNull();
    expect(await code(reg.registerMyChild(parent, kid.id, { confirmed: "on" }))).toBe("CONFLICT");
  });

  it("registers in one step: placed in the decided grade, confirmed, audited as the parent; a second press changes nothing", async () => {
    const { kid, parent } = await child();
    const before = await reg.familyRegistrationView(parent, kid.id);
    expect(before).toMatchObject({ state: "OPEN", outcome: "PROMOTED", toClassName: "Standard II" });
    expect(await code(reg.registerMyChild(parent, kid.id, {}))).toBe("VALIDATION"); // the confirmation tick is required
    const r1 = await reg.registerMyChild(parent, kid.id, { confirmed: "on" });
    expect(r1.already).toBe(false);
    const row = await regOf(kid.id);
    expect(row).toMatchObject({ status: "REGISTERED", classId: std2.id, registeredById: parent.userId, placedById: parent.userId });
    expect(row.streamId).not.toBeNull(); // the stream with the fewest students
    expect((row.confirmations as { via: string }).via).toBe("FAMILY_PORTAL");
    expect(await db.auditLog.count({ where: { entityId: row.id, actorId: parent.userId } })).toBeGreaterThanOrEqual(2);
    expect((await reg.registerMyChild(parent, kid.id, { confirmed: "on" })).already).toBe(true);
    expect((await reg.familyRegistrationView(parent, kid.id))?.state).toBe("REGISTERED");
    // Joining the roster is a separate step that waits for the year to start.
    expect(await db.studentEnrollment.count({ where: { studentId: kid.id, academicYearId: nextYear.id } })).toBe(0);
  });

  it("keeps the placement Admissions already made", async () => {
    const { kid, parent } = await child();
    const st = await db.stream.findFirstOrThrow({ where: { classId: std2.id } });
    await reg.placeReturning(registrar, { registrationId: (await regOf(kid.id)).id, classId: std2.id, streamId: st.id });
    await reg.registerMyChild(parent, kid.id, { confirmed: "on" });
    expect((await regOf(kid.id)).placedById).toBe(registrar.userId);
  });

  it("refuses anyone who is not the child's family, and staff", async () => {
    const a = await child();
    const b = await child();
    expect(await code(reg.registerMyChild(b.parent, a.kid.id, { confirmed: "on" }))).toBe("NOT_FOUND");
    expect(await code(reg.familyRegistrationView(b.parent, a.kid.id))).toBe("NOT_FOUND");
    expect(await code(reg.registerMyChild(registrar, a.kid.id, { confirmed: "on" }))).not.toBeNull();
    expect((await regOf(a.kid.id)).status).toBe("PENDING");
  });

  it("a repeat decision registers for the same grade", async () => {
    const { kid, parent } = await child({ outcome: "REPEAT" });
    expect(await reg.familyRegistrationView(parent, kid.id)).toMatchObject({ state: "OPEN", outcome: "REPEAT", toClassName: setup.cls.name });
    await reg.registerMyChild(parent, kid.id, { confirmed: "on" });
    expect((await regOf(kid.id)).classId).toBe(setup.cls.id);
  });

  it("refuses a full class (never overridden) and registers nothing", async () => {
    // Standard II holds 2 places; the earlier tests took them (promoted and placed). The next family is refused.
    const { kid, parent } = await child();
    const full = await code(reg.registerMyChild(parent, kid.id, { confirmed: "on" }));
    expect(full).toBe("CONFLICT");
    expect((await regOf(kid.id)).status).toBe("PENDING");
    expect((await regOf(kid.id)).classId).toBeNull();
  });

  it("follows the registration window and the school's fee rule", async () => {
    await db.academicYear.update({ where: { id: nextYear.id }, data: { registrationOpensOn: new Date(Date.UTC(setup.yearNo + 5, 0, 1)) } });
    const w = await child({ outcome: "REPEAT" });
    expect((await reg.familyRegistrationView(w.parent, w.kid.id))?.state).toBe("NOT_YET");
    expect(await code(reg.registerMyChild(w.parent, w.kid.id, { confirmed: "on" }))).toBe("CONFLICT");
    await db.academicYear.update({ where: { id: nextYear.id }, data: { registrationOpensOn: new Date(Date.UTC(setup.yearNo, 0, 1)), registrationClosesOn: new Date(Date.UTC(setup.yearNo, 0, 2)) } });
    expect((await reg.familyRegistrationView(w.parent, w.kid.id))?.state).toBe("CLOSED");
    await db.academicYear.update({ where: { id: nextYear.id }, data: { registrationOpensOn: new Date(Date.UTC(setup.yearNo, 0, 1)), registrationClosesOn: new Date(Date.UTC(setup.yearNo + 5, 0, 1)) } });
    await setPolicy("BLOCK_REGISTRATION");
    const f = await child({ outcome: "REPEAT" });
    // Not billed means not cleared under this policy: the family is refused and Finance is told.
    expect((await reg.familyRegistrationView(f.parent, f.kid.id))?.state).toBe("FEES");
    expect(await code(reg.registerMyChild(f.parent, f.kid.id, { confirmed: "on" }))).toBe("CONFLICT");
    expect((await regOf(f.kid.id)).status).toBe("PENDING");
    expect(await db.workflowTask.count({ where: { schoolId: admin.schoolId, kind: "RETURNING_FEE", relatedId: (await regOf(f.kid.id)).id } })).toBe(1);
    await setPolicy();
  });
});
