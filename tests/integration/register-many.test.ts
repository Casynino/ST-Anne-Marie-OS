import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as admissions from "@/server/admissions";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as review from "@/server/admission-review";
import { classRoom, registerMany } from "@/server/admission-registration";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let small: { id: string };
let n = 640000 + Math.floor(Math.random() * 3_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

/** An accepted applicant who is ready to be registered (no fee, papers not required). */
async function accepted(classAppliedId: string) {
  const k = ++n;
  const app = await admissions.createApplication(registrar, { firstName: `Reg${k}`, lastName: `Many${k}`, dateOfBirth: "2019-05-04", gender: "FEMALE", classAppliedId, guardians: [{ fullName: `Parent ${k}`, phone: `0765${String(k % 1_000_000).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" }] });
  await review.reviewApplication(registrar, app.id, { decision: "VERIFIED" });
  await offers.issueOffer(registrar, app.id, {});
  return app.id;
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  small = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2, capacity: "2" });
  await policy.updateAdmissionPolicy(admin, { requireInterview: "", requiredDocTypes: [], admissionFee: "0", requirePaymentBeforeEnrol: "on", offerValidDays: 0, allowDirectRegistration: "on", interviewMinutes: 30 });
});

describe("registering several new students at once", () => {
  it("gives each the Student ID and the class together; 'any stream' spreads them over the streams", async () => {
    const ids = [await accepted(setup.cls.id), await accepted(setup.cls.id)];
    const res = await registerMany(registrar, { ids, classId: setup.cls.id, streamId: "*" });
    expect(res.map((r) => r.ok)).toEqual([true, true]);
    expect(new Set(res.map((r) => r.admissionNo)).size).toBe(2);
    const enrols = await db.studentEnrollment.findMany({ where: { schoolId: school.id, studentId: { in: (await db.application.findMany({ where: { id: { in: ids } }, select: { studentId: true } })).map((a) => a.studentId!) } } });
    expect(enrols).toHaveLength(2);
    expect(enrols.every((e) => e.classId === setup.cls.id && e.status === "ACTIVE")).toBe(true);
    expect(new Set(enrols.map((e) => e.streamId)).size).toBe(2); // one in each stream
    expect((await db.application.findMany({ where: { id: { in: ids } } })).every((a) => a.status === "ENROLLED")).toBe(true);
  });

  it("a class that cannot take everybody refuses the whole request, naming classes with room, and registers nobody", async () => {
    const ids = [await accepted(small.id), await accepted(small.id), await accepted(small.id)];
    const before = await db.student.count({ where: { schoolId: school.id } });
    const err = (await registerMany(registrar, { ids, classId: small.id }).then(() => null, (e) => e)) as AppError;
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(/2 places left but 3 were chosen/);
    expect(err.message).toMatch(/Standard I/); // the class that has room
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(before);
    expect((await db.application.findMany({ where: { id: { in: ids } } })).every((a) => a.status === "ACCEPTED")).toBe(true);
  });

  it("fewer than the places left works, and the class is then full; a stream must be chosen where the class has streams", async () => {
    const ids = [await accepted(small.id), await accepted(small.id)];
    const res = await registerMany(registrar, { ids, classId: small.id });
    expect(res.every((r) => r.ok)).toBe(true);
    const room = (await classRoom(registrar, [])).find((c) => c.classId === small.id)!;
    expect(room).toMatchObject({ capacity: 2, left: 0, full: true });
    expect(await code(registerMany(registrar, { ids: [await accepted(setup.cls.id)], classId: setup.cls.id }))).toBe("VALIDATION");
  });

  it("going over the limit needs the permission and a reason; one refusal is reported by name and does not stop the others", async () => {
    const [a, b] = [await accepted(small.id), await accepted(small.id)];
    expect(await code(registerMany(registrar, { ids: [a, b], classId: small.id }))).toBe("CONFLICT");
    const res = await registerMany(admin, { ids: [a, b], classId: small.id, overrideCapacity: "on", overrideReason: "Twins, both siblings of pupils here" });
    expect(res.every((r) => r.ok)).toBe(true);
    const again = await registerMany(admin, { ids: [a, await accepted(setup.cls.id)], classId: setup.cls.id, streamId: "*" });
    expect(again[0]).toMatchObject({ ok: false });
    expect(again[0]!.message).toMatch(/already been enrolled/i);
    expect(again[1]).toMatchObject({ ok: true });
  });

  it("the class overview counts students, places left and who is waiting for each class", async () => {
    const waitingFor = await accepted(setup.cls.id);
    const rooms = await classRoom(registrar, [setup.cls.id, setup.cls.id]);
    expect(rooms[0]!.classId).toBe(setup.cls.id); // asked-for classes come first
    expect(rooms[0]!.waiting).toBe(2);
    expect(rooms[0]!.streams.map((s) => s.name)).toEqual(["A", "B"]);
    expect(waitingFor).toBeTruthy();
  });
});
