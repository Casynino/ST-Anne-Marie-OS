import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as reg from "@/server/annual-registration";
import * as prog from "@/server/progression";
import { addRegistrationFollowUp, registrationFollowUps } from "@/server/registration-followups";
import { updateLifecycleSettings } from "@/server/lifecycle-settings";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/*
 * Follow-up notes for returning students who have not registered: only Admissions (registration.manage) writes them, only while the
 * registration is still pending, they are history, and they never change the registration or withdraw anyone.
 */

let admin: AuthContext, registrar: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let nextYear: { id: string };
let n = 900000 + Math.floor(Math.random() * 6_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

async function pending() {
  const kid = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  await prog.decideProgressions(admin, { yearId: setup.year.id, studentIds: [kid.id], outcome: "REPEAT", toClassId: setup.cls.id, exceptionReason: "Test: results not finalised" });
  const live = await db.studentProgression.findFirstOrThrow({ where: { studentId: kid.id, fromAcademicYearId: setup.year.id, status: { not: "SUPERSEDED" } } });
  await prog.approveProgressions(admin, { ids: [live.id] });
  return db.annualRegistration.findUniqueOrThrow({ where: { studentId_academicYearId: { studentId: kid.id, academicYearId: nextYear.id } } });
}

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  const y = setup.yearNo + 1;
  nextYear = await academics.createAcademicYear(admin, { name: `${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, registrationOpensOn: `${y - 1}-01-01`, registrationClosesOn: `${y - 1}-02-01` });
  await updateLifecycleSettings(admin, { requireHeadApproval: "", promotionMinAverage: "", feePolicy: "INFORM_ONLY", previousDebtCounts: "" });
});

describe("follow-up notes for students who have not registered", () => {
  it("records a note, lists it newest first, shows it on the board and audits it; the registration itself does not change", async () => {
    const r = await pending();
    await addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: "NO_ANSWER" });
    await addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: "WILL_RETURN", note: "Father will come on Monday" });
    const notes = await registrationFollowUps(registrar, r.id);
    expect(notes.map((x) => x.outcome)).toEqual(["WILL_RETURN", "NO_ANSWER"]);
    expect(notes[0]).toMatchObject({ note: "Father will come on Monday", by: expect.any(String) });
    const row = (await reg.returningBoard(registrar, { yearId: nextYear.id })).rows.find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ notRegistered: true, followUps: 2, followUp: { outcome: "WILL_RETURN" } });
    expect(await db.auditLog.count({ where: { entityId: r.id, action: "registration.follow_up" } })).toBe(2);
    expect((await db.annualRegistration.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING"); // never withdrawn or cancelled by a note
  });

  it("'Not returning' and 'Something else' need a note; the not-registered filter and counts follow", async () => {
    const r = await pending();
    expect(await code(addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: "NOT_RETURNING" }))).toBe("CONFLICT");
    await addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: "NOT_RETURNING", note: "Moving to another town" });
    const all = await reg.returningBoard(registrar, { yearId: nextYear.id });
    const only = await reg.returningBoard(registrar, { yearId: nextYear.id, notRegistered: true });
    expect(only.rows.every((x) => x.notRegistered)).toBe(true);
    expect(only.total).toBe(all.counts.notRegistered);
    expect(all.counts.contacted).toBeGreaterThanOrEqual(1);
    expect(all.windowClosed).toBe(true);
  });

  it("only Admissions writes notes, only while the registration is pending; notes cannot be edited or deleted", async () => {
    const r = await pending();
    expect(await code(addRegistrationFollowUp(teacher, { registrationId: r.id, outcome: "NO_ANSWER" }))).toBe("FORBIDDEN");
    await addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: "NO_ANSWER" });
    const note = await db.registrationFollowUp.findFirstOrThrow({ where: { registrationId: r.id } });
    await expect(db.registrationFollowUp.update({ where: { id: note.id }, data: { note: "changed" } })).rejects.toThrow();
    await expect(db.registrationFollowUp.delete({ where: { id: note.id } })).rejects.toThrow();
    await reg.cancelRegistration(registrar, { registrationId: r.id, reason: "Family confirmed they are leaving" });
    expect(await code(addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: "NO_ANSWER" }))).toBe("CONFLICT");
  });

  it("never reaches another school's registration", async () => {
    const r = await pending();
    const other = await createTestSchool();
    const outsider = (await createTestUser(other.id, ["registrar"])).ctx;
    expect(await code(addRegistrationFollowUp(outsider, { registrationId: r.id, outcome: "NO_ANSWER" }))).toBe("NOT_FOUND");
    expect(await registrationFollowUps(outsider, r.id)).toEqual([]);
  });
});
