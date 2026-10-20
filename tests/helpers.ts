import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { ensureSchoolRoles, syncPermissionCatalog } from "@/server/rbac";
import { ensureDefaultSettings } from "@/server/settings";
import * as academics from "@/server/academics";

let catalogReady = false;

/** Each test file creates its own isolated school(s); audit_logs is append-only so we never truncate. */
export async function createTestSchool(name = "Test School") {
  if (!catalogReady) {
    await syncPermissionCatalog(db);
    catalogReady = true;
  }
  const code = `T${randomUUID().slice(0, 6).toUpperCase()}`;
  const school = await db.school.create({ data: { code, name, branches: { create: { name: "Main", code: "MAIN", isMain: true } } } });
  await ensureSchoolRoles(db, school.id, new Set());
  await ensureDefaultSettings(db, school);
  return school;
}

export async function createTestUser(schoolId: string, roleKeys: string[], opts: { password?: string; fullName?: string; email?: string } = {}) {
  const roles = await db.role.findMany({ where: { schoolId, key: { in: roleKeys } } });
  const id = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: {
      schoolId,
      fullName: opts.fullName ?? `User ${id}`,
      email: opts.email ?? `u-${id}@test.example`,
      passwordHash: await hashPassword(opts.password ?? "Passw0rd-test-1"),
      mustChangePassword: false,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
      staff: { create: { schoolId } },
    },
  });
  return { user, ctx: await buildAuthContext(user.id) };
}

export const ctxFor = (userId: string): Promise<AuthContext> => buildAuthContext(userId);

/** A current academic year + term, one level, one class (optionally with streams). */
export async function createTestAcademics(admin: AuthContext, opts: { streams?: string[]; className?: string } = {}) {
  const yearNo = 2026 + Math.floor(Math.random() * 3000);
  const year = await academics.createAcademicYear(admin, { name: `${yearNo}`, startsOn: `${yearNo}-01-01`, endsOn: `${yearNo}-12-31` });
  await academics.setCurrentAcademicYear(admin, year.id);
  const term = await academics.createTerm(admin, { academicYearId: year.id, name: "Term 1", sequence: 1, startsOn: `${yearNo}-01-05`, endsOn: `${yearNo}-04-30` });
  await academics.setCurrentTerm(admin, term.id);
  const level = await academics.createLevel(admin, { name: "Primary", sortOrder: 1 });
  const cls = await academics.createClass(admin, { levelId: level.id, name: opts.className ?? "Standard I", sortOrder: 1 });
  const streams = [];
  for (const s of opts.streams ?? []) streams.push(await academics.createStream(admin, cls.id, s));
  return { year, yearNo, term, level, cls, streams };
}

export const guardianFor = (n: number) => ({
  fullName: `Guardian ${n}`,
  phone: `07${String(10000000 + n).slice(-8)}`,
  relationship: "MOTHER",
  isPrimary: "on",
});

export function studentInput(n: number, extra: Record<string, unknown> = {}) {
  return {
    firstName: `First${n}`,
    lastName: `Last${n}`,
    dateOfBirth: "2018-03-15",
    gender: "FEMALE",
    guardians: [guardianFor(n)],
    ...extra,
  };
}
