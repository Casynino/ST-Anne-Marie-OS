import { beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as asg from "@/server/assignments";
import { teacherHome } from "@/server/teacher-home";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let admin: AuthContext, registrar: AuthContext, tA: AuthContext, tB: AuthContext, tNone: AuthContext, accountant: AuthContext;
let n = 400000 + Math.floor(Math.random() * 5_000_000); // phones are unique across the persistent test database

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  tA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  tB = (await createTestUser(school.id, ["subject_teacher"])).ctx;
  tNone = (await createTestUser(school.id, ["class_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  const setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  const [streamA, streamB] = [setup.streams[0]!, setup.streams[1]!];
  const math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id]);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id, staffId: tA.staffId });
  await academics.addSubjectTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamB.id, subjectId: math.id, staffId: tB.staffId });
  for (let i = 0; i < 3; i++) await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id }));
  await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamB.id }));
  const hw = await asg.createAssignment(tB, { classId: setup.cls.id, streamId: streamB.id, subjectId: math.id, title: "Fractions", instructions: "Do page 4", dueAt: new Date(Date.now() + 86_400_000).toISOString(), maxScore: "10" });
  await asg.publishAssignment(tB, hw.id);
});

describe("teacher home", () => {
  it("counts only the students of the classes the teacher teaches", async () => {
    expect((await teacherHome(tA)).studentCount).toBe(3);
    expect((await teacherHome(tB)).studentCount).toBe(1);
    expect((await teacherHome(tNone)).studentCount).toBe(0);
  });

  it("lists the teacher's own classes and subjects", async () => {
    const b = await teacherHome(tB);
    expect(b.classes).toHaveLength(1);
    expect(b.classes[0]!.subjects).toEqual(["Mathematics"]);
    expect(b.classes[0]!.streams).toEqual(["B"]);
    expect((await teacherHome(tNone)).classes).toEqual([]);
  });

  it("shows homework only to the teacher who set it", async () => {
    expect((await teacherHome(tB)).homework.open).toBe(1);
    expect((await teacherHome(tA)).homework.open).toBe(0);
    expect((await teacherHome(tNone)).homework.rows).toEqual([]);
  });

  it("returns nothing school-wide to a staff member with no teaching permissions", async () => {
    const a = await teacherHome(accountant);
    expect(a.studentCount).toBe(0);
    expect(a.classes).toEqual([]);
    expect(a.homework.open).toBe(0);
    expect(a.today).toEqual([]);
  });
});
