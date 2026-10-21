import { beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import * as academics from "@/server/academics";
import * as asg from "@/server/assignments";
import { headHome } from "@/server/head-home";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

let admin: AuthContext, head: AuthContext, tA: AuthContext, tB: AuthContext, accountant: AuthContext, otherHead: AuthContext, otherTeacher: AuthContext;

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  tA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  tB = (await createTestUser(school.id, ["subject_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  const setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  const math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id]);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: setup.streams[0]!.id, staffId: tA.staffId });
  await academics.addSubjectTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: setup.streams[1]!.id, subjectId: math.id, staffId: tB.staffId });
  const hw = await asg.createAssignment(tB, { classId: setup.cls.id, streamId: setup.streams[1]!.id, subjectId: math.id, title: "Fractions", instructions: "Page 4", dueAt: new Date(Date.now() + 86_400_000).toISOString(), maxScore: "10" });
  await asg.publishAssignment(tB, hw.id);

  // Another school with its own head and teacher: must never appear.
  const other = await createTestSchool();
  const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
  otherHead = (await createTestUser(other.id, ["head_teacher"])).ctx;
  otherTeacher = (await createTestUser(other.id, ["class_teacher"])).ctx;
  const os = await createCurrentYearAcademics(otherAdmin, { streams: ["A"] });
  await academics.setClassTeacher(otherAdmin, { academicYearId: os.year.id, classId: os.cls.id, streamId: os.streams[0]!.id, staffId: otherTeacher.staffId });
});

describe("head teacher home", () => {
  it("is only for people who oversee teaching", async () => {
    expect(await code(headHome(tA))).toBe("FORBIDDEN");
    expect(await code(headHome(tB))).toBe("FORBIDDEN");
    expect(await code(headHome(accountant))).toBe("FORBIDDEN");
    expect(await code(headHome(head))).toBeNull();
    expect(await code(headHome(admin))).toBeNull();
  });

  it("lists this school's teachers with their classes, subjects and work", async () => {
    const h = await headHome(head);
    expect(h.teachers).toHaveLength(2);
    const a = h.teachers.find((t) => t.staffId === tA.staffId)!;
    const b = h.teachers.find((t) => t.staffId === tB.staffId)!;
    expect(a.classes).toEqual(["Standard I A"]);
    expect(a.register).toEqual({ total: 1, finalised: 0, draft: 0 }); // no register taken yet today
    expect(a.homework.open).toBe(0);
    expect(b.subjects).toEqual(["Mathematics · Standard I B"]);
    expect(b.register).toBeNull(); // a subject teacher has no class register of their own
    expect(b.homework).toEqual({ open: 1, toMark: 0 });
    expect(h.totals.teachers).toBe(2);
    expect(h.totals.registersTotal).toBe(1);
  });

  it("never shows another school's staff", async () => {
    const h = await headHome(head);
    expect(h.teachers.some((t) => t.staffId === otherTeacher.staffId)).toBe(false);
    const o = await headHome(otherHead);
    expect(o.teachers.map((t) => t.staffId)).toEqual([otherTeacher.staffId]);
  });
});
