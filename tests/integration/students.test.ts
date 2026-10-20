import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as guardians from "@/server/guardians";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { createTestAcademics, createTestSchool, createTestUser, guardianFor, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext;
let registrar: AuthContext;
let setup: Awaited<ReturnType<typeof createTestAcademics>>;
let counter = 1000;
const next = () => ++counter;

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  setup = await createTestAcademics(admin, { streams: ["A", "B"] });
});

describe("academic calendar rules", () => {
  it("rejects overlapping years, terms outside the year, and duplicate term numbers", async () => {
    const y = setup.yearNo;
    expect(await code(academics.createAcademicYear(admin, { name: "overlap", startsOn: `${y}-06-01`, endsOn: `${y + 1}-05-31` }))).toBe("VALIDATION");
    expect(await code(academics.createAcademicYear(admin, { name: "bad", startsOn: `${y + 5}-06-01`, endsOn: `${y + 5}-05-31` }))).toBe("VALIDATION");
    expect(await code(academics.createTerm(admin, { academicYearId: setup.year.id, name: "Out", sequence: 2, startsOn: `${y - 1}-12-01`, endsOn: `${y}-02-01` }))).toBe("VALIDATION");
    expect(await code(academics.createTerm(admin, { academicYearId: setup.year.id, name: "Dup", sequence: 1, startsOn: `${y}-05-10`, endsOn: `${y}-07-30` }))).toBe("VALIDATION");
    expect(await code(academics.createTerm(admin, { academicYearId: setup.year.id, name: "Overlap", sequence: 2, startsOn: `${y}-04-01`, endsOn: `${y}-07-30` }))).toBe("VALIDATION");
    await academics.createTerm(admin, { academicYearId: setup.year.id, name: "Term 2", sequence: 2, startsOn: `${y}-05-10`, endsOn: `${y}-08-30` });
  });

  it("keeps exactly one current year and term; a term can only be current inside the current year", async () => {
    const y = setup.yearNo;
    const next = await academics.createAcademicYear(admin, { name: `${y + 10}`, startsOn: `${y + 10}-01-01`, endsOn: `${y + 10}-12-31` });
    const t = await academics.createTerm(admin, { academicYearId: next.id, name: "T1", sequence: 1, startsOn: `${y + 10}-01-10`, endsOn: `${y + 10}-04-10` });
    expect(await code(academics.setCurrentTerm(admin, t.id))).toBe("CONFLICT");
    await academics.setCurrentAcademicYear(admin, next.id);
    expect(await db.academicYear.count({ where: { schoolId: school.id, isCurrent: true } })).toBe(1);
    expect(await db.term.count({ where: { schoolId: school.id, isCurrent: true } })).toBe(0); // old term cleared with the year switch
    await academics.setCurrentAcademicYear(admin, setup.year.id); // restore for the other tests
    // The DB itself refuses two current years even if the application is bypassed.
    await expect(db.academicYear.update({ where: { id: next.id }, data: { isCurrent: true } })).rejects.toThrow();
  });

  it("only allows teacher assignments for subjects taught in the class, and one class teacher per class stream", async () => {
    const maths = await academics.createSubject(admin, { code: "mat", name: "Mathematics" });
    const eng = await academics.createSubject(admin, { code: "eng", name: "English" });
    await academics.setClassSubjects(admin, setup.cls.id, [maths.id]);
    const t1 = (await createTestUser(school.id, ["subject_teacher"])).ctx;
    const t2 = (await createTestUser(school.id, ["class_teacher"])).ctx;
    const base = { academicYearId: setup.year.id, classId: setup.cls.id, staffId: t1.staffId };
    expect(await code(academics.addSubjectTeacher(admin, { ...base, subjectId: eng.id }))).toBe("VALIDATION");
    await academics.addSubjectTeacher(admin, { ...base, subjectId: maths.id });
    expect(await code(academics.addSubjectTeacher(admin, { ...base, subjectId: maths.id }))).toBe("CONFLICT");
    expect(await code(academics.setClassSubjects(admin, setup.cls.id, []))).toBe("CONFLICT"); // subject still has a teacher

    const stream = setup.streams[0]!;
    await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: stream.id, staffId: t1.staffId });
    await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: stream.id, staffId: t2.staffId });
    const rows = await db.classTeacher.findMany({ where: { classId: setup.cls.id, streamId: stream.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.staffId).toBe(t2.staffId);
    // Registrar cannot assign teachers.
    expect(await code(academics.setClassTeacher(registrar, { academicYearId: setup.year.id, classId: setup.cls.id, staffId: t1.staffId }))).toBe("FORBIDDEN");
  });
});

describe("student registration", () => {
  it("registers a student with guardian, class, admission number and an audit trail", async () => {
    const n = next();
    const stream = setup.streams[0]!;
    const s = await students.createStudent(registrar, studentInput(n, { classId: setup.cls.id, streamId: stream.id, emergencyContacts: [{ name: "Aunt", relationship: "Aunt", phone: "0712000111" }] }));
    expect(s.admissionNo).toMatch(new RegExp(`^${school.code}/${new Date().getUTCFullYear()}/\\d{4}$`));
    const profile = await students.getStudentProfile(registrar, s.id);
    expect(profile.guardians).toHaveLength(1);
    expect(profile.guardians[0]!.isPrimary).toBe(true);
    expect(profile.enrollments[0]).toMatchObject({ status: "ACTIVE", classId: setup.cls.id, streamId: stream.id });
    expect(profile.emergencyContacts).toHaveLength(1);
    const log = await db.auditLog.findFirst({ where: { schoolId: school.id, entityId: s.id, action: "student.create" } });
    expect(log?.actorId).toBe(registrar.userId);
  });

  it("requires a guardian, a stream when the class has streams, and rejects bad dates", async () => {
    const n = next();
    expect(await code(students.createStudent(registrar, { ...studentInput(n), guardians: [] }))).toBe("VALIDATION");
    expect(await code(students.createStudent(registrar, studentInput(next(), { classId: setup.cls.id })))).toBe("VALIDATION"); // stream required
    expect(await code(students.createStudent(registrar, studentInput(next(), { dateOfBirth: "2999-01-01" })))).toBe("VALIDATION");
    expect(await code(students.createStudent(registrar, studentInput(next(), { dateOfBirth: "2018-02-30" })))).toBe("VALIDATION");
  });

  it("issues unique sequential admission numbers under concurrent registrations", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => students.createStudent(registrar, studentInput(next()))));
    const numbers = results.map((r) => r.admissionNo);
    expect(new Set(numbers).size).toBe(12);
    const seqs = numbers.map((x) => Number(x.split("/").pop())).sort((a, b) => a - b);
    expect(seqs[seqs.length - 1]! - seqs[0]!).toBe(11); // no gaps, no duplicates
  });

  it("warns about duplicate students and about guardians sharing a phone number, until confirmed", async () => {
    const n = next();
    const first = await students.createStudent(registrar, studentInput(n));
    expect(await code(students.createStudent(registrar, { ...studentInput(n), guardians: [guardianFor(next())] }))).toBe("CONFLICT");
    const confirmed = await students.createStudent(registrar, { ...studentInput(n), guardians: [guardianFor(next())], confirmDuplicate: "on" });
    expect(confirmed.id).not.toBe(first.id);

    const sameGuardianPhone = { ...guardianFor(n) }; // phone already belongs to the first student's guardian
    expect(await code(students.createStudent(registrar, studentInput(next(), { guardians: [sameGuardianPhone] })))).toBe("CONFLICT");
    const sibling = await students.createStudent(registrar, studentInput(next(), { guardians: [{ ...sameGuardianPhone, allowSharedPhone: "on" }] }));
    expect(sibling.id).toBeTruthy();
  });

  it("links an existing guardian explicitly so siblings are identified", async () => {
    const a = await students.createStudent(registrar, studentInput(next()));
    const aProfile = await students.getStudentProfile(registrar, a.id);
    const guardianId = aProfile.guardians[0]!.guardianId;
    const b = await students.createStudent(registrar, studentInput(next(), { guardians: [{ guardianId, relationship: "MOTHER", isPrimary: "on" }] }));
    const bProfile = await students.getStudentProfile(registrar, b.id);
    expect(bProfile.siblings.map((s) => s.id)).toEqual([a.id]);
    expect(await db.guardian.count({ where: { schoolId: school.id, id: guardianId } })).toBe(1);
  });

  it("never reuses an admission number after a withdrawal", async () => {
    const a = await students.createStudent(registrar, studentInput(next()));
    await students.changeStudentStatus(registrar, a.id, { status: "WITHDRAWN", reason: "Family moved", effectiveOn: new Date().toISOString().slice(0, 10) });
    const b = await students.createStudent(registrar, studentInput(next()));
    expect(b.admissionNo).not.toBe(a.admissionNo);
    expect(Number(b.admissionNo.split("/").pop())).toBeGreaterThan(Number(a.admissionNo.split("/").pop()));
  });
});

describe("enrollment history and status", () => {
  it("moves a student between streams without overwriting history; DB enforces one active enrollment per year", async () => {
    const [a, b] = setup.streams as [typeof setup.streams[0], typeof setup.streams[0]];
    const s = await students.createStudent(registrar, studentInput(next(), { classId: setup.cls.id, streamId: a!.id }));
    expect(await code(students.enrollStudent(registrar, s.id, { classId: setup.cls.id, streamId: a!.id }))).toBe("CONFLICT"); // already there
    await students.enrollStudent(registrar, s.id, { classId: setup.cls.id, streamId: b!.id });
    const rows = await db.studentEnrollment.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.status, r.streamId])).toEqual([["MOVED", a!.id], ["ACTIVE", b!.id]]);
    expect(rows[0]!.endedOn).not.toBeNull();
    await expect(
      db.studentEnrollment.create({ data: { schoolId: school.id, studentId: s.id, academicYearId: setup.year.id, classId: setup.cls.id, streamId: a!.id, startedOn: new Date() } }),
    ).rejects.toThrow();
  });

  it("closes the active enrollment on withdrawal and reopens eligibility on reinstatement", async () => {
    const s = await students.createStudent(registrar, studentInput(next(), { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
    const today = new Date().toISOString().slice(0, 10);
    expect(await code(students.changeStudentStatus(registrar, s.id, { status: "TRANSFERRED", reason: "", effectiveOn: today }))).toBe("VALIDATION"); // reason required
    await students.changeStudentStatus(registrar, s.id, { status: "TRANSFERRED", reason: "Moved to Arusha", effectiveOn: today });
    const after = await db.student.findUniqueOrThrow({ where: { id: s.id }, include: { enrollments: true, statusHistory: true } });
    expect(after.status).toBe("TRANSFERRED");
    expect(after.enrollments[0]).toMatchObject({ status: "TRANSFERRED_OUT" });
    expect(after.statusHistory).toHaveLength(1);
    expect(await code(students.enrollStudent(registrar, s.id, { classId: setup.cls.id, streamId: setup.streams[0]!.id }))).toBe("CONFLICT");
    await students.changeStudentStatus(registrar, s.id, { status: "ENROLLED", reason: "Returned", effectiveOn: today });
    await students.enrollStudent(registrar, s.id, { classId: setup.cls.id, streamId: setup.streams[1]!.id });
    expect((await db.studentEnrollment.count({ where: { studentId: s.id } }))).toBe(2);
  });
});

describe("access control on student data", () => {
  it("class teachers only see students of their assigned class/stream", async () => {
    const [a, b] = setup.streams as [typeof setup.streams[0], typeof setup.streams[0]];
    const inA = await students.createStudent(registrar, studentInput(next(), { classId: setup.cls.id, streamId: a!.id }));
    const inB = await students.createStudent(registrar, studentInput(next(), { classId: setup.cls.id, streamId: b!.id }));
    const teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
    await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: a!.id, staffId: teacher.staffId });

    const list = await students.listStudents(teacher, {});
    const ids = list.items.map((i) => i.id);
    expect(ids).toContain(inA.id);
    expect(ids).not.toContain(inB.id);
    expect(await code(students.getStudentProfile(teacher, inB.id))).toBe("NOT_FOUND");
    const own = await students.getStudentProfile(teacher, inA.id);
    expect(own.canSeeGuardians).toBe(true); // class teacher may contact parents
    expect(own.canSeeMedical).toBe(false);

    const stranger = (await createTestUser(school.id, ["subject_teacher"])).ctx; // teaches nothing
    expect((await students.listStudents(stranger, {})).total).toBe(0);
    const parent = (await createTestUser(school.id, ["parent"])).ctx;
    expect(await code(students.listStudents(parent, {}))).toBe("FORBIDDEN");
  });

  it("restricts medical notes to authorised roles and never writes their content to the audit log", async () => {
    const s = await students.createStudent(registrar, studentInput(next(), { medicalNotes: "Asthma — carries inhaler SECRET-NOTE" }));
    expect((await students.getStudentProfile(registrar, s.id)).medicalNotes).toContain("Asthma");
    const accountant = (await createTestUser(school.id, ["accountant"])).ctx;
    expect((await students.getStudentProfile(accountant, s.id)).medicalNotes).toBeNull();
    // An accountant cannot register students at all; a registrar-less editor cannot change medical notes.
    expect(await code(students.createStudent(accountant, studentInput(next())))).toBe("FORBIDDEN");
    await students.updateStudent(registrar, s.id, { firstName: "Renamed", lastName: "Last", dateOfBirth: "2018-03-15", gender: "FEMALE", medicalNotes: "Updated SECRET-NOTE-2" });
    const logs = await db.auditLog.findMany({ where: { schoolId: school.id, entityId: s.id } });
    expect(JSON.stringify(logs)).not.toContain("SECRET-NOTE");
    expect(logs.some((l) => l.action === "student.update")).toBe(true);
  });

  it("guardian relationship rules: one primary, cannot remove the last or the primary guardian, verification is permissioned", async () => {
    const s = await students.createStudent(registrar, studentInput(next()));
    const first = (await students.getStudentProfile(registrar, s.id)).guardians[0]!;
    await guardians.linkGuardian(registrar, s.id, { fullName: "Second G", phone: "0788111222", relationship: "FATHER" });
    let profile = await students.getStudentProfile(registrar, s.id);
    expect(profile.guardians.filter((g) => g.isPrimary)).toHaveLength(1);
    const second = profile.guardians.find((g) => g.guardianId !== first.guardianId)!;
    expect(await code(guardians.unlinkGuardian(registrar, s.id, first.guardianId, "wrong"))).toBe("CONFLICT"); // primary
    await guardians.updateRelationship(registrar, s.id, second.guardianId, { relationship: "FATHER", isPrimary: "on", receivesNotifications: "on" });
    profile = await students.getStudentProfile(registrar, s.id);
    expect(profile.guardians.filter((g) => g.isPrimary).map((g) => g.guardianId)).toEqual([second.guardianId]);
    await guardians.unlinkGuardian(registrar, s.id, first.guardianId, "Entered by mistake");
    expect(await code(guardians.unlinkGuardian(registrar, s.id, second.guardianId, "x"))).toBe("CONFLICT"); // last guardian
    await guardians.setRelationshipVerified(registrar, s.id, second.guardianId, true);
    const teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
    expect(await code(guardians.setRelationshipVerified(teacher, s.id, second.guardianId, false))).toBe("FORBIDDEN");
  });
});

describe("tenant isolation", () => {
  it("a user from another school cannot read, change or enrol into this school's records", async () => {
    const other = await createTestSchool("Other School");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const mine = await students.createStudent(registrar, studentInput(next(), { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
    const profile = await students.getStudentProfile(registrar, mine.id);

    expect(await code(students.getStudentProfile(otherAdmin, mine.id))).toBe("NOT_FOUND");
    expect((await students.listStudents(otherAdmin, {})).total).toBe(0);
    expect(await code(students.updateStudent(otherAdmin, mine.id, { firstName: "Hacked", lastName: "X", dateOfBirth: "2018-03-15", gender: "MALE" }))).toBe("NOT_FOUND");
    expect(await code(students.changeStudentStatus(otherAdmin, mine.id, { status: "WITHDRAWN", reason: "x", effectiveOn: "2026-01-02" }))).toBe("NOT_FOUND");
    expect(await code(students.enrollStudent(otherAdmin, mine.id, { classId: setup.cls.id, streamId: setup.streams[0]!.id }))).toBe("NOT_FOUND");
    expect(await code(guardians.linkGuardian(otherAdmin, mine.id, { guardianId: profile.guardians[0]!.guardianId, relationship: "MOTHER" }))).toBe("NOT_FOUND");
    expect(await code(academics.updateClass(otherAdmin, setup.cls.id, { levelId: setup.level.id, name: "Hijack", isActive: "on" }))).toBe("NOT_FOUND");
    expect(await guardians.searchGuardians(otherAdmin, "Guardian")).toEqual([]);
    expect((await db.student.findUniqueOrThrow({ where: { id: mine.id } })).firstName).not.toBe("Hacked");

    // Using another school's class/guardian when registering in your own school is rejected too.
    await createTestAcademics(otherAdmin); // give the other school a current year so the class check is what fires
    expect(await code(students.createStudent(otherAdmin, studentInput(next(), { classId: setup.cls.id })))).toBe("NOT_FOUND");
    expect(await code(students.createStudent(otherAdmin, studentInput(next(), { guardians: [{ guardianId: profile.guardians[0]!.guardianId, relationship: "MOTHER" }] })))).toBe("NOT_FOUND");
    // Each school numbers independently.
    const theirs = await students.createStudent(otherAdmin, studentInput(next()));
    expect(theirs.admissionNo.startsWith(other.code)).toBe(true);
  });
});

describe("audit log integrity", () => {
  it("is append-only at database level", async () => {
    const row = await db.auditLog.findFirstOrThrow({ where: { schoolId: school.id } });
    await expect(db.auditLog.update({ where: { id: row.id }, data: { summary: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({ where: { schoolId: school.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')).rejects.toThrow(/append-only/);
  });

  it("audit viewing needs audit.read and is school-scoped", async () => {
    const { listAuditLogs } = await import("@/server/audit-log");
    expect(await code(listAuditLogs(registrar))).toBe("FORBIDDEN");
    const logs = await listAuditLogs(admin);
    expect(logs.total).toBeGreaterThan(0);
    expect(logs.items.every((l) => l.schoolId === school.id)).toBe(true);
    expect(await buildAuthContext(admin.userId)).toBeTruthy();
  });
});
