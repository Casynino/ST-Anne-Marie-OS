import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as admissions from "@/server/admissions";
import * as offers from "@/server/admission-offers";
import * as enq from "@/server/enquiries";
import { getDashboard } from "@/server/dashboard";
import { ensureDefaultSession } from "@/server/attendance";
import { parseDateOnly } from "@/lib/dates";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, teacher: AuthContext, parent: AuthContext, head: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let classB: { id: string };
let n = 700;
const kpi = (d: Awaited<ReturnType<typeof getDashboard>>, key: string) => d.kpis.find((k) => k.key === key);

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  parent = (await createTestUser(school.id, ["parent"])).ctx;
  setup = await createCurrentYearAcademics(admin, { className: "Form I" });
  classB = await academics.createClass(admin, { levelId: setup.level.id, name: "Form II", sortOrder: 2 });
  // 6 students in Form I (teacher's class), 4 in Form II (not the teacher's)
  const mine: string[] = [];
  for (let i = 0; i < 6; i++) mine.push((await students.createStudent(admin, studentInput(++n, { classId: setup.cls.id }))).id);
  for (let i = 0; i < 4; i++) await students.createStudent(admin, studentInput(++n, { classId: classB.id }));
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, staffId: teacher.staffId });
  // A withdrawn student must not count as enrolled.
  const gone = await students.createStudent(admin, studentInput(++n, { classId: setup.cls.id }));
  await students.changeStudentStatus(admin, gone.id, { status: "WITHDRAWN", reason: "Moved", effectiveOn: setup.today });
  teacher = await buildAuthContext(teacher.userId); // roles/assignments are read per request
  void mine;
});

describe("dashboard figures come from real records", () => {
  it("counts enrolled students (not withdrawn ones) and splits them by class", async () => {
    const d = await getDashboard(admin);
    expect(kpi(d, "enrolled")?.value).toBe(10);
    expect(d.enrollmentByClass).toEqual([{ label: "Form I", value: 6 }, { label: "Form II", value: 4 }]);
    expect(d.gender?.FEMALE ?? 0).toBe(10); // helper registers girls; boys absent rather than invented
    expect(d.year?.id).toBe(setup.year.id);
    expect(d.needsSetup).toBe(false);
  });

  it("reports attendance only from finalised registers, using the school's own late/excused policy", async () => {
    let d = await getDashboard(admin);
    expect(kpi(d, "attendanceToday")?.value).toBeNull(); // nothing recorded: unknown, never 0% or 100%
    expect(d.attendanceTrend).toEqual([]);

    // Finalised register today for Form I: 4 present, 1 late (counts as present), 1 absent => 5/6 = 83.3%
    const session = await ensureDefaultSession(db, school.id);
    const today = parseDateOnly(setup.today)!;
    const roster = await db.studentEnrollment.findMany({ where: { schoolId: school.id, classId: setup.cls.id, status: "ACTIVE" }, select: { studentId: true } });
    const reg = await db.attendanceRegister.create({ data: { schoolId: school.id, academicYearId: setup.year.id, classId: setup.cls.id, sessionId: session.id, date: today, status: "FINALISED", startedById: admin.userId, finalisedById: admin.userId, finalisedAt: new Date() } });
    const statuses = ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT"] as const;
    await db.studentAttendance.createMany({ data: roster.map((r, i) => ({ schoolId: school.id, registerId: reg.id, studentId: r.studentId, classId: setup.cls.id, sessionId: session.id, date: today, status: statuses[i]!, markedById: admin.userId })) });
    // A DRAFT register for Form II must be ignored by the rate but shown as "not finalised".
    await db.attendanceRegister.create({ data: { schoolId: school.id, academicYearId: setup.year.id, classId: classB.id, sessionId: session.id, date: today, status: "DRAFT", startedById: admin.userId } });

    d = await getDashboard(admin);
    expect(kpi(d, "attendanceToday")).toMatchObject({ value: "83.3%", hint: "1/2" });
    expect(d.attendanceTrend).toEqual([{ date: setup.today, rate: 83.3 }]);
    expect(d.attention.find((a) => a.key === "registersOpen")?.count).toBe(1);
  });

  it("shows the admissions pipeline, recent applications and new enquiries with correct counts", async () => {
    const mk = (k: number) => admissions.createApplication(admin, { firstName: `App${k}`, lastName: "Pipeline", dateOfBirth: "2014-03-1" + k, gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [{ fullName: `P${k}`, phone: `07${String(60000000 + k + Math.floor(Math.random() * 1000) * 10).slice(-8)}`, relationship: "MOTHER", isPrimary: "on" }] });
    const [a1, a2, a3] = [await mk(1), await mk(2), await mk(3)];
    await offers.issueOffer(admin, a2.id, {});
    await admissions.transitionApplication(admin, a3.id, { to: "REJECTED", reason: "Test" });
    await enq.submitEnquiry(school.id, { name: "Visitor", phone: "0712345600", message: "Please call me about admissions.", consent: "on", website: "" }, { ip: `203.0.113.${Math.floor(Math.random() * 200)}x${Math.random()}`, userAgent: "t" });

    const d = await getDashboard(admin);
    const by = Object.fromEntries(d.pipeline!.map((p) => [p.label, p.value]));
    expect(by).toMatchObject({ APPLIED: 1, ACCEPTED: 1, REJECTED: 1, ENROLLED: 0 });
    expect(kpi(d, "pipeline")?.value).toBe(2); // applied + interview + accepted (rejected excluded)
    expect(kpi(d, "enquiries")?.value).toBe(1);
    expect(d.recentApplications!.map((a) => a.id)).toContain(a1.id);
    expect(d.attention.map((a) => a.key)).toEqual(expect.arrayContaining(["newEnquiries", "newApplications"]));
  });
});

describe("each role sees only its own dashboard", () => {
  it("a class teacher sees only their class: students, register and nothing administrative", async () => {
    const d = await getDashboard(teacher);
    expect(kpi(d, "enrolled")?.value).toBe(6);
    expect(d.enrollmentByClass).toEqual([{ label: "Form I", value: 6 }]);
    expect(d.myRegisters.map((r) => r.className)).toEqual(["Form I"]);
    expect(d.myRegisters[0]!.status).toBe("FINALISED");
    for (const k of ["pipeline", "staff", "enquiries"]) expect(kpi(d, k)).toBeUndefined();
    expect(d.pipeline).toBeNull();
    expect(d.recentApplications).toBeNull();
    expect(d.activity).toBeNull();
    expect(d.attendanceTrend).toBeNull(); // school-wide trend needs school-wide attendance access
  });

  it("a registrar sees admissions and enquiries but not staff counts or the audit trail", async () => {
    const d = await getDashboard(registrar);
    expect(kpi(d, "pipeline")?.value).toBe(2);
    expect(kpi(d, "enquiries")?.value).toBe(1);
    expect(kpi(d, "staff")).toBeUndefined();
    expect(d.activity).toBeNull();
    expect(d.myRegisters).toEqual([]);
  });

  it("a head teacher sees school-wide attendance and students, without finance or settings", async () => {
    const d = await getDashboard(head);
    expect(kpi(d, "enrolled")?.value).toBe(10);
    expect(kpi(d, "attendanceToday")?.value).toBe("83.3%");
    expect(d.activity).not.toBeNull(); // audit.read
  });

  it("a parent account has no staff permissions, so no figures at all", async () => {
    const d = await getDashboard(parent);
    expect(d.kpis).toEqual([]);
    expect(d.enrollmentByClass).toBeNull();
    expect(d.pipeline).toBeNull();
    expect(d.attendanceTrend).toBeNull();
    expect(d.activity).toBeNull();
    expect(d.recentApplications).toBeNull();
  });

  it("another school never sees these numbers", async () => {
    const other = await createTestSchool("Other dash");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const d = await getDashboard(otherAdmin);
    expect(kpi(d, "enrolled")?.value).toBe(0);
    expect(kpi(d, "pipeline")?.value).toBe(0);
    expect(d.needsSetup).toBe(true);
    expect(d.pipeline?.every((p) => p.value === 0)).toBe(true);
    expect(d.activity).toEqual([]);
  });
});
