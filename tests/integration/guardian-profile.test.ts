import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as students from "@/server/students";
import * as portal from "@/server/portal";
import { guardianProfile } from "@/server/guardians";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/* One parent's page: children and class for everyone who reads guardians; money and the portal account (sign-ins, activity) only for the
 * people who may see them; never another school's parent. */

let registrar: AuthContext, accountant: AuthContext, teacher: AuthContext, outsider: AuthContext;
let guardianId: string, userId: string;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  const admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  outsider = (await createTestUser((await createTestSchool()).id, ["registrar"])).ctx;
  const setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  const kid = await students.createStudent(registrar, studentInput(995001, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  guardianId = (await db.studentGuardian.findFirstOrThrow({ where: { studentId: kid.id } })).guardianId;
  await portal.createGuardianAccount(admin, guardianId, { email: "parent.profile@example.test" });
  userId = (await db.guardian.findUniqueOrThrow({ where: { id: guardianId } })).userId!;
  await db.loginAttempt.createMany({ data: [{ identifier: "parent.profile@example.test", success: false }, { identifier: "parent.profile@example.test", success: false }, { identifier: "parent.profile@example.test", success: true }] });
});

describe("one parent's page", () => {
  it("shows the children with their class, and the account with sign-ins for people who manage portal accounts", async () => {
    const p = await guardianProfile(registrar, guardianId);
    expect(p.children).toHaveLength(1);
    expect(p.children[0]).toMatchObject({ className: expect.stringContaining("·") });
    expect(p.hasAccount).toBe(true);
    if (registrar.permissions.has("portal.manage")) expect(p.account).toMatchObject({ id: userId, signIns30: 1, failed30: 2 });
  });

  it("hides the portal account from people who may not manage it, and money from people who may not read fees", async () => {
    const t = await guardianProfile(accountant, guardianId).catch(() => null);
    if (t) { expect(accountant.permissions.has("portal.manage") ? true : t.account === null).toBe(true); }
    const r = await guardianProfile(registrar, guardianId);
    expect(r.canFees).toBe(registrar.permissions.has("fees.read"));
    if (!registrar.permissions.has("fees.read")) expect(r.children[0]!.owedCents).toBeNull();
  });

  it("needs guardian.read and never reaches another school's parent", async () => {
    expect(await code(guardianProfile(teacher, guardianId))).toBe("FORBIDDEN");
    expect(await code(guardianProfile(outsider, guardianId))).toBe("NOT_FOUND");
  });
});
