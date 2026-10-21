import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { canDiscover, type Viewer } from "@/lib/library/access";
import { LocalDiskStorage } from "@/lib/storage/local";
import { getStorage, setStorageForTests } from "@/lib/storage";
import * as academics from "@/server/academics";
import * as applications from "@/server/admissions";
import * as lib from "@/server/library";
import * as ident from "@/server/library-identity";
import { updateLibrarySettings } from "@/server/library-settings";
import * as ids from "@/server/school-ids";
import * as students from "@/server/students";
import * as users from "@/server/users";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

/*
 * The digital library and school IDs, against a real database: who gets an ID and keeps it, who can be verified, who may find and open what,
 * the publication workflow, and that nothing is counted as use unless it was really granted.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, registrar: AuthContext, teacherA: AuthContext, teacherB: AuthContext, clerk: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let cls2: { id: string };
let categoryId: string;
let stu1: { id: string; admissionNo: string }, stu2: { id: string; admissionNo: string };
let pin1 = "", pin2 = "";
let n = 910000 + Math.floor(Math.random() * 8_000_000);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("library test file ".repeat(20))]);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const meta = () => ({ ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "t" });
const viewerOf = async (token: string) => (await ident.viewerForToken(token))!.viewer;
const open = (viewer: Viewer, resourceId: string, account: AuthContext | null = null, kind: "VIEW" | "DOWNLOAD" = "DOWNLOAD") => lib.openLibraryFile({ viewer, viewerSchoolId: viewer.kind === "VISITOR" ? null : school.id, account, resourceId, kind });
const VISITOR: Viewer = { kind: "VISITOR" };

async function make(by: AuthContext, extra: Record<string, unknown> = {}) {
  return lib.createResource(by, { title: `Resource ${++n}`, categoryId, audience: "STUDENTS", ...extra }, { fileName: "notes.pdf", bytes: PDF });
}
async function publish(by: AuthContext, extra: Record<string, unknown> = {}) {
  const r = await make(by, extra);
  await lib.submitResource(by, r.id);
  await lib.approveResource(head, r.id);
  await lib.publishResource(head, r.id);
  return r;
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacherA = (await createTestUser(school.id, ["class_teacher"], { password: "Teacher-A-pass-1" })).ctx;
  teacherB = (await createTestUser(school.id, ["subject_teacher"], { password: "Teacher-B-pass-1" })).ctx;
  clerk = (await createTestUser(school.id, ["accountant"], { password: "Clerk-pass-12345" })).ctx;
  setup = await createCurrentYearAcademics(admin);
  cls2 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2 });
  const math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  const eng = await academics.createSubject(admin, { code: "ENG", name: "English" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id]);
  await academics.setClassSubjects(admin, cls2.id, [eng.id]);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, staffId: teacherA.staffId });
  await academics.addSubjectTeacher(admin, { academicYearId: setup.year.id, classId: cls2.id, subjectId: eng.id, staffId: teacherB.staffId });
  stu1 = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id }));
  stu2 = await students.createStudent(registrar, studentInput(++n, { classId: cls2.id }));
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-lib-"))));
  categoryId = (await lib.listCategories(school.id))[0]!.id;
  pin1 = (await ident.setStudentPins(registrar, { classId: setup.cls.id, mode: "missing" }))[0]!.pin;
  pin2 = (await ident.setStudentPins(registrar, { classId: cls2.id, mode: "missing" }))[0]!.pin;
});
afterAll(() => setStorageForTests(undefined));

describe("school IDs", () => {
  it("a student's school ID is their admission number, given at enrolment and never shared", () => {
    expect(stu1.admissionNo).toMatch(/^[A-Z0-9]+\/\d{4}\/\d{4}$/);
    expect(stu2.admissionNo).not.toBe(stu1.admissionNo);
  });

  it("a staff member gets an ID automatically when registered, and it never changes", async () => {
    const { user } = await users.createStaffUser(admin, { fullName: "Id Teacher", email: `id-${++n}@school.example`, department: "teaching", password: "Sunrise2026ok" });
    const staff = await db.staff.findUniqueOrThrow({ where: { userId: user.id } });
    expect(staff.staffNo).toMatch(/\/STF\/\d{4}\/\d{4}$/);
    // Changing role, department or details keeps it; a different number is refused; an empty box keeps it.
    await users.updateStaffUser(admin, user.id, { fullName: "Id Teacher", email: user.email, department: "finance" });
    expect((await db.staff.findUniqueOrThrow({ where: { userId: user.id } })).staffNo).toBe(staff.staffNo);
    expect(await code(users.updateStaffUser(admin, user.id, { fullName: "Id Teacher", email: user.email, staffNo: "SOMETHING-ELSE-1" }))).toBe("VALIDATION");
    expect((await db.staff.findUniqueOrThrow({ where: { userId: user.id } })).staffNo).toBe(staff.staffNo);
  });

  it("registrations at the same moment never receive the same ID", async () => {
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => users.createStaffUser(admin, { fullName: `Parallel ${i}`, email: `par-${++n}@school.example`, department: "teaching", password: "Sunrise2026ok" })));
    const nos = (await db.staff.findMany({ where: { userId: { in: made.map((m) => m.user.id) } }, select: { staffNo: true } })).map((s) => s.staffNo);
    expect(new Set(nos).size).toBe(8);
    expect(nos.every((x) => !!x)).toBe(true);
  });

  it("a number that was once used is never given again, even after the record is gone", async () => {
    const before = await db.admissionCounter.findFirstOrThrow({ where: { schoolId: school.id, scope: { startsWith: "STF:" } } });
    const a = await users.createStaffUser(admin, { fullName: "Leaves", email: `lv-${++n}@school.example`, department: "teaching", password: "Sunrise2026ok" });
    const usedNo = (await db.staff.findUniqueOrThrow({ where: { userId: a.user.id } })).staffNo;
    await users.setUserStatus(admin, a.user.id, "SUSPENDED", "left");
    const b = await users.createStaffUser(admin, { fullName: "Joins", email: `jn-${++n}@school.example`, department: "teaching", password: "Sunrise2026ok" });
    expect((await db.staff.findUniqueOrThrow({ where: { userId: b.user.id } })).staffNo).not.toBe(usedNo);
    expect((await db.admissionCounter.findFirstOrThrow({ where: { schoolId: school.id, scope: before.scope } })).lastValue).toBeGreaterThan(before.lastValue);
  });

  it("the backfill gives an ID only to staff who have none, keeps every existing one and can be run again", async () => {
    const withId = await db.staff.findMany({ where: { schoolId: school.id, staffNo: { not: null } }, select: { id: true, staffNo: true } });
    const missingBefore = (await ids.schoolIdReport(admin)).staffMissing;
    expect(missingBefore).toBeGreaterThan(0); // the test users were created directly, without an ID
    expect(await code(ids.assignMissingStaffIds(registrar))).toBe("FORBIDDEN");
    const first = await ids.assignMissingStaffIds(admin);
    expect(first.assigned).toBe(missingBefore);
    expect((await ids.schoolIdReport(admin)).staffMissing).toBe(0);
    for (const s of withId) expect((await db.staff.findUniqueOrThrow({ where: { id: s.id } })).staffNo).toBe(s.staffNo); // untouched
    const all = (await db.staff.findMany({ where: { schoolId: school.id }, select: { staffNo: true } })).map((s) => s.staffNo);
    expect(new Set(all).size).toBe(all.length);
    expect((await ids.assignMissingStaffIds(admin)).assigned).toBe(0);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "staff.assign_id" } })).toBe(missingBefore);
  });

  it("an applicant has no school ID: an application number never identifies anybody", async () => {
    const app = await applications.createApplication(registrar, { firstName: "Not", lastName: "Yet", dateOfBirth: "2019-02-02", gender: "MALE", classAppliedId: setup.cls.id, guardians: [{ fullName: "G", phone: `0788${String(++n % 1_000_000).padStart(6, "0")}`, relationship: "FATHER", isPrimary: "on" }] });
    expect(await ids.findBySchoolId(school.id, app.applicationNo)).toBeNull();
    expect(await code(ident.verifySchoolId(school.id, { schoolId: app.applicationNo, secret: "123456" }, meta()))).toBe("VALIDATION");
  });
});

describe("verifying a school ID", () => {
  it("a student gives the ID and the PIN the school set; their class comes from the school's records", async () => {
    const { token } = await ident.verifySchoolId(school.id, { schoolId: ` ${stu1.admissionNo.toLowerCase()} `, secret: pin1 }, meta());
    expect(await viewerOf(token)).toMatchObject({ kind: "STUDENT", studentId: stu1.id, classId: setup.cls.id, level: "FULL" });
  });

  it("every failure says the same thing, whether the ID exists or not", async () => {
    const msgs = new Set<string>();
    for (const input of [{ schoolId: stu1.admissionNo, secret: "000000" }, { schoolId: "SAM/9999/0001", secret: pin1 }, { schoolId: "x", secret: pin1 }, { schoolId: stu1.admissionNo, secret: "" }]) {
      const e = (await ident.verifySchoolId(school.id, input, meta()).then(() => null, (x) => x)) as AppError;
      expect(e.code).toBe("VALIDATION");
      msgs.add(e.message);
    }
    expect(msgs.size).toBe(1);
  });

  it("attempts are limited per ID and per connection", async () => {
    const target = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id }));
    let last: AppError | null = null;
    for (let i = 0; i < 12; i++) last = (await ident.verifySchoolId(school.id, { schoolId: target.admissionNo, secret: "111111" }, meta()).then(() => null, (e) => e)) as AppError;
    expect(last!.code).toBe("RATE_LIMITED");
    const sameIp = { ip: "10.250.250.250", userAgent: "t" };
    let blocked: AppError | null = null;
    for (let i = 0; i < 40; i++) blocked = (await ident.verifySchoolId(school.id, { schoolId: `NOPE/${i}/0001`, secret: "1" }, sameIp).then(() => null, (e) => e)) as AppError;
    expect(blocked!.code).toBe("RATE_LIMITED");
  });

  it("a student who is no longer enrolled cannot verify", async () => {
    const gone = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id }));
    const pin = (await ident.setStudentPin(registrar, gone.id)).pin;
    expect((await ident.verifySchoolId(school.id, { schoolId: gone.admissionNo, secret: pin }, meta())).token).toBeTruthy();
    await students.changeStudentStatus(registrar, gone.id, { status: "WITHDRAWN", reason: "Moved away", effectiveOn: setup.today });
    expect(await code(ident.verifySchoolId(school.id, { schoolId: gone.admissionNo, secret: pin }, meta()))).toBe("VALIDATION");
  });

  it("a teacher gives the ID and their password; the ID alone never opens anything for staff", async () => {
    await ids.assignMissingStaffIds(admin);
    const staffNo = (await db.staff.findUniqueOrThrow({ where: { id: teacherA.staffId! } })).staffNo!;
    expect(await code(ident.verifySchoolId(school.id, { schoolId: staffNo, secret: "" }, meta()))).toBe("VALIDATION");
    expect(await code(ident.verifySchoolId(school.id, { schoolId: staffNo, secret: "wrong-password-1" }, meta()))).toBe("VALIDATION");
    const { token } = await ident.verifySchoolId(school.id, { schoolId: staffNo, secret: "Teacher-A-pass-1" }, meta());
    expect(await viewerOf(token)).toMatchObject({ kind: "STAFF", staffId: teacherA.staffId, classIds: [setup.cls.id], canReadStaffMaterial: true, manager: false });
    const b = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: (await db.staff.findUniqueOrThrow({ where: { id: teacherB.staffId! } })).staffNo!, secret: "Teacher-B-pass-1" }, meta())).token);
    expect(b).toMatchObject({ kind: "STAFF", classIds: [cls2.id] });
  });

  it("the school ID alone works for a student only when the school switches it on", async () => {
    expect(await code(ident.verifySchoolId(school.id, { schoolId: stu2.admissionNo, secret: "" }, meta()))).toBe("VALIDATION");
    await updateLibrarySettings(admin, { requireApproval: "on", sessionHours: 12, allowIdOnly: "on" });
    try {
      const { token } = await ident.verifySchoolId(school.id, { schoolId: stu2.admissionNo, secret: "" }, meta());
      expect(await viewerOf(token)).toMatchObject({ kind: "STUDENT", level: "ID_ONLY" });
    } finally {
      await updateLibrarySettings(admin, { requireApproval: "on", sessionHours: 12 });
    }
  });

  it("a session ends when it expires or the person signs out", async () => {
    const { token } = await ident.verifySchoolId(school.id, { schoolId: stu1.admissionNo, secret: pin1 }, meta());
    expect(await ident.viewerForToken(token)).not.toBeNull();
    await db.librarySession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) }, where: { schoolId: school.id } });
    expect(await ident.viewerForToken(token)).toBeNull();
    const fresh = (await ident.verifySchoolId(school.id, { schoolId: stu1.admissionNo, secret: pin1 }, meta())).token;
    await ident.endLibrarySession(fresh);
    expect(await ident.viewerForToken(fresh)).toBeNull();
    expect(await ident.viewerForToken("not-a-real-token")).toBeNull();
  });

  it("PINs are stored only as hashes, are set by authorised people, and a reset replaces the old one", async () => {
    const row = await db.libraryPin.findUniqueOrThrow({ where: { studentId: stu1.id } });
    expect(row.pinHash).not.toContain(pin1);
    expect(await code(ident.setStudentPins(teacherA, { classId: setup.cls.id, mode: "reset" }))).toBe("FORBIDDEN");
    const reset = await ident.setStudentPin(registrar, stu1.id);
    expect(await code(ident.verifySchoolId(school.id, { schoolId: stu1.admissionNo, secret: pin1 }, meta()))).toBe("VALIDATION");
    expect((await ident.verifySchoolId(school.id, { schoolId: stu1.admissionNo, secret: reset.pin }, meta())).token).toBeTruthy();
    pin1 = reset.pin;
    expect(JSON.stringify(await db.auditLog.findMany({ where: { schoolId: school.id, action: "library.pin_set" } }))).not.toContain(reset.pin);
  });
});

describe("publishing a resource", () => {
  it("goes from draft to review to approved to published, and is invisible until then", async () => {
    const r = await make(teacherA, { audience: "PUBLIC" });
    expect((await lib.searchLibrary(school.id, VISITOR, { q: r.title }, "EN")).total).toBe(0); // a draft is nobody's to see
    expect(await code(lib.publishResource(teacherA, r.id))).toBe("FORBIDDEN");
    await lib.submitResource(teacherA, r.id);
    expect((await db.libraryResource.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING_REVIEW");
    expect((await lib.searchLibrary(school.id, VISITOR, { q: r.title }, "EN")).total).toBe(0);
    expect(await code(lib.approveResource(teacherA, r.id))).toBe("FORBIDDEN"); // approval needs the right permission
    expect(await code(lib.publishResource(head, r.id))).toBe("CONFLICT"); // not approved yet
    await lib.approveResource(head, r.id);
    expect((await lib.searchLibrary(school.id, VISITOR, { q: r.title }, "EN")).total).toBe(0); // approved is still not published
    await lib.publishResource(head, r.id);
    expect((await lib.searchLibrary(school.id, VISITOR, { q: r.title }, "EN")).items.map((i) => i.id)).toEqual([r.id]);
  });

  it("nobody approves their own upload, and a returned resource goes back to the uploader with the reason", async () => {
    const r = await make(admin, { audience: "PUBLIC" });
    await lib.submitResource(admin, r.id);
    expect(await code(lib.approveResource(admin, r.id))).toBe("FORBIDDEN"); // even an administrator needs someone else to approve what they uploaded
    const t = await make(teacherA);
    await lib.submitResource(teacherA, t.id);
    await lib.returnResource(head, t.id, "Please add the class");
    const back = await db.libraryResource.findUniqueOrThrow({ where: { id: t.id } });
    expect(back).toMatchObject({ status: "DRAFT", reviewNote: "Please add the class" });
    expect(await code(lib.returnResource(head, t.id, "x"))).toBe("CONFLICT"); // no longer waiting for review
  });

  it("without the approval rule, a publisher can publish a draft directly", async () => {
    await updateLibrarySettings(admin, { sessionHours: 12 }); // approval switched off
    try {
      const r = await make(teacherA, { audience: "PUBLIC" });
      await lib.publishResource(head, r.id);
      expect((await db.libraryResource.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PUBLISHED");
      const s = await make(teacherA, { audience: "PUBLIC" });
      await lib.submitResource(teacherA, s.id); // an uploader without publish rights lands on "approved", ready for a publisher
      expect((await db.libraryResource.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("APPROVED");
    } finally {
      await updateLibrarySettings(admin, { requireApproval: "on", sessionHours: 12 });
    }
  });

  it("replacing the file adds a version, keeps the old one, and readers get the new file", async () => {
    const r = await publish(teacherA, { audience: "PUBLIC" });
    const second = Buffer.concat([PDF, Buffer.from("second edition")]);
    await lib.replaceFile(head, r.id, { fileName: "notes-v2.pdf", bytes: second }, "Corrected chapter 3");
    const detail = await lib.getManageResource(head, r.id);
    expect(detail.versions.map((v) => [v.version, v.isCurrent])).toEqual([[2, true], [1, false]]);
    const res = await open(VISITOR, r.id);
    expect(res.ok && res.file.fileName).toBe("notes-v2.pdf");
    const { body } = await getStorage()!.stream((res as { ok: true; file: { storageKey: string } }).file.storageKey);
    expect(Buffer.from(await new Response(body).arrayBuffer()).equals(second)).toBe(true);
    await expect(db.libraryFile.delete({ where: { id: detail.versions[1]!.id } })).rejects.toThrow(); // history cannot be erased
  });

  it("archiving removes it from the library; restoring brings it back as a draft to be reviewed again", async () => {
    const r = await publish(teacherA, { audience: "PUBLIC" });
    await lib.archiveResource(head, r.id, "Out of date");
    expect((await lib.searchLibrary(school.id, VISITOR, { q: r.title }, "EN")).total).toBe(0);
    expect(await open(VISITOR, r.id)).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    expect(await code(lib.updateResource(teacherA, r.id, { title: "x", categoryId, audience: "PUBLIC" }))).toBe("CONFLICT");
    await lib.restoreResource(head, r.id);
    expect((await db.libraryResource.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DRAFT");
  });

  it("uploads are checked: size, type by content, and an empty or fake file is refused", async () => {
    expect(await code(lib.createResource(teacherA, { title: "Bad", categoryId, audience: "STUDENTS" }, { fileName: "x.pdf", bytes: Buffer.from("MZ not a pdf") }))).toBe("VALIDATION");
    expect(await code(lib.createResource(teacherA, { title: "Empty", categoryId, audience: "STUDENTS" }, { fileName: "x.pdf", bytes: Buffer.alloc(0) }))).toBe("VALIDATION");
    expect(await code(lib.createResource(teacherA, { title: "Cls", categoryId, audience: "CLASSES" }, { fileName: "x.pdf", bytes: PDF }))).toBe("VALIDATION"); // needs a class
    expect(await code(lib.createResource(teacherA, { title: "Id", categoryId, audience: "STAFF", idOnly: "on" }, { fileName: "x.pdf", bytes: PDF }))).toBe("VALIDATION");
    expect(await code(lib.createResource(clerk, { title: "No", categoryId, audience: "STUDENTS" }, { fileName: "x.pdf", bytes: PDF }))).toBe("FORBIDDEN");
  });

  it("an uploader sees only their own drafts; reviewers and managers see all", async () => {
    const mine = await make(teacherA, { title: "Only mine" });
    expect((await lib.listManageResources(teacherA, {})).items.some((i) => i.id === mine.id)).toBe(true);
    expect((await lib.listManageResources(teacherB, {})).items.some((i) => i.id === mine.id)).toBe(false);
    expect(await code(lib.getManageResource(teacherB, mine.id))).toBe("NOT_FOUND");
    expect((await lib.listManageResources(head, {})).items.some((i) => i.id === mine.id)).toBe(true);
  });
});

describe("who can find and open what", () => {
  let pub: { id: string }, forStudents: { id: string }, classA: { id: string }, classB: { id: string }, subjMath: { id: string }, teachersOnly: { id: string }, restricted: { id: string };
  let math: { id: string };
  let s1: Viewer, s2: Viewer, tA: Viewer, tB: Viewer, mgr: Viewer;

  beforeAll(async () => {
    math = (await db.subject.findFirstOrThrow({ where: { schoolId: school.id, code: "MATH" } }));
    pub = await publish(teacherA, { audience: "PUBLIC", title: "Open to all" });
    forStudents = await publish(teacherA, { audience: "STUDENTS", title: "For every student" });
    classA = await publish(teacherA, { audience: "CLASSES", classIds: [setup.cls.id], title: "Class A notes" });
    classB = await publish(teacherA, { audience: "CLASSES", classIds: [cls2.id], title: "Class B notes" });
    subjMath = await publish(teacherA, { audience: "SUBJECTS", subjectIds: [math.id], title: "Maths booklet" });
    teachersOnly = await publish(teacherA, { audience: "STAFF", title: "Marking guide" });
    restricted = await publish(teacherA, { audience: "RESTRICTED", staffIds: [teacherB.staffId!], title: "Restricted memo" });
    s1 = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: stu1.admissionNo, secret: pin1 }, meta())).token);
    s2 = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: stu2.admissionNo, secret: pin2 }, meta())).token);
    tA = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: (await db.staff.findUniqueOrThrow({ where: { id: teacherA.staffId! } })).staffNo!, secret: "Teacher-A-pass-1" }, meta())).token);
    tB = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: (await db.staff.findUniqueOrThrow({ where: { id: teacherB.staffId! } })).staffNo!, secret: "Teacher-B-pass-1" }, meta())).token);
    mgr = await ident.viewerForAccount(admin);
  });

  const titles = async (v: Viewer) => (await lib.searchLibrary(school.id, v, {}, "EN")).items.map((i) => i.title);

  it("a visitor can find material for students (to be told to verify) but not staff-only or restricted material", async () => {
    const t = await titles(VISITOR);
    expect(t).toEqual(expect.arrayContaining(["Open to all", "For every student", "Class A notes", "Class B notes", "Maths booklet"]));
    expect(t).not.toContain("Marking guide");
    expect(t).not.toContain("Restricted memo");
    expect(await open(VISITOR, pub.id)).toMatchObject({ ok: true });
    expect(await open(VISITOR, forStudents.id)).toMatchObject({ ok: false, reason: "VERIFY" });
    expect(await open(VISITOR, teachersOnly.id)).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
  });

  it("a verified student sees and opens their class's material and their subjects' material, nothing of another class", async () => {
    const t = await titles(s1);
    expect(t).toEqual(expect.arrayContaining(["Open to all", "For every student", "Class A notes", "Maths booklet"]));
    expect(t).not.toContain("Class B notes");
    expect(t).not.toContain("Marking guide");
    expect(await open(s1, classA.id)).toMatchObject({ ok: true });
    expect(await open(s1, classB.id)).toMatchObject({ ok: false, reason: "NOT_FOR_YOU" });
    expect(await open(s1, subjMath.id)).toMatchObject({ ok: true });
    expect(await open(s2, subjMath.id)).toMatchObject({ ok: false, reason: "NOT_FOR_YOU" }); // class B has English, not Maths
    expect(await open(s2, classB.id)).toMatchObject({ ok: true });
  });

  it("a teacher's guide is not downloadable by a student, even though teachers can open it", async () => {
    expect(await open(s1, teachersOnly.id)).toMatchObject({ ok: false });
    expect(await open(tA, teachersOnly.id)).toMatchObject({ ok: true });
    expect(await open(tB, teachersOnly.id)).toMatchObject({ ok: true });
  });

  it("a teacher gets the classes and subjects they teach, and restricted items only when named", async () => {
    expect(await open(tA, classA.id)).toMatchObject({ ok: true });
    expect(await open(tA, classB.id)).toMatchObject({ ok: false });
    expect(await open(tB, classB.id)).toMatchObject({ ok: true });
    expect(await open(tA, restricted.id)).toMatchObject({ ok: false });
    expect(await open(tB, restricted.id)).toMatchObject({ ok: true });
    expect(await open(mgr, restricted.id)).toMatchObject({ ok: true }); // managers see everything
    expect(await titles(tA)).not.toContain("Restricted memo");
    expect(await titles(tB)).toContain("Restricted memo");
  });

  it("the database filter and the rule agree for every kind of viewer and resource", async () => {
    const all = await db.libraryResource.findMany({ where: { schoolId: school.id, status: "PUBLISHED" }, include: { classes: true, subjects: true, staff: true } });
    for (const v of [VISITOR, { kind: "GUARDIAN" } as Viewer, s1, s2, tA, tB, mgr]) {
      const shown = new Set((await lib.searchLibrary(school.id, v, {}, "EN")).items.map((i) => i.id));
      const total = (await lib.searchLibrary(school.id, v, {}, "EN")).total;
      const expected = all.filter((r) => canDiscover(v, { status: r.status, audience: r.audience, availableFrom: r.availableFrom, idOnly: r.idOnly, classIds: r.classes.map((c) => c.classId), subjectIds: r.subjects.map((s) => s.subjectId), staffIds: r.staff.map((s) => s.staffId) }, new Date()));
      expect(total).toBe(expected.length);
      for (const r of expected.slice(0, lib.PAGE_SIZE)) expect(shown.has(r.id) || total > lib.PAGE_SIZE).toBe(true);
    }
  });

  it("a resource released later is hidden and closed until its date", async () => {
    const later = await publish(teacherA, { audience: "STUDENTS", title: "Exam paper (later)", availableFrom: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) });
    expect(await titles(s1)).not.toContain("Exam paper (later)");
    expect(await open(s1, later.id)).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    await db.libraryResource.update({ where: { id: later.id }, data: { availableFrom: new Date(Date.now() - 86_400_000) } });
    expect(await open(s1, later.id)).toMatchObject({ ok: true });
  });

  it("the school ID alone opens only the items the school marked, and a PIN is asked for the rest", async () => {
    await updateLibrarySettings(admin, { requireApproval: "on", sessionHours: 12, allowIdOnly: "on" });
    try {
      const marked = await publish(teacherA, { audience: "STUDENTS", idOnly: "on", title: "Open with ID" });
      const kid = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id }));
      const idOnly = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: kid.admissionNo, secret: "" }, meta())).token);
      expect(await open(idOnly, marked.id)).toMatchObject({ ok: true });
      expect(await open(idOnly, forStudents.id)).toMatchObject({ ok: false, reason: "PIN_NEEDED" });
      expect(await open(idOnly, classA.id)).toMatchObject({ ok: false, reason: "PIN_NEEDED" });
    } finally {
      await updateLibrarySettings(admin, { requireApproval: "on", sessionHours: 12 });
    }
  });

  it("only granted openings of published resources count; refusals and previews never do", async () => {
    const r = await publish(teacherA, { audience: "CLASSES", classIds: [setup.cls.id], title: "Counted" });
    const count = (outcome: "GRANTED" | "DENIED") => db.libraryEvent.count({ where: { resourceId: r.id, outcome } });
    await open(s1, r.id);
    await open(s1, r.id, null, "VIEW");
    await open(s2, r.id); // not their class: denied
    await open(VISITOR, r.id); // a visitor is not logged
    await open(VISITOR, r.id);
    await open(tA, r.id, teacherA); // the uploader's own preview
    expect(await count("GRANTED")).toBeGreaterThanOrEqual(2);
    expect(await count("DENIED")).toBe(1);
    const granted = await db.libraryEvent.findMany({ where: { resourceId: r.id, outcome: "GRANTED" } });
    expect(granted.every((e) => e.person === "STUDENT" || e.person === "STAFF")).toBe(true);
    const a = await lib.libraryAnalytics(head, 30);
    expect(a.top.find((t) => t.id === r.id)?.count).toBe(granted.length); // the denied attempt is not in the statistics
    expect(JSON.stringify(a)).not.toContain(stu1.admissionNo); // statistics never name a student
    expect(await code(lib.libraryAnalytics(teacherA, 30))).toBe("FORBIDDEN");
    expect(await code(lib.libraryActivity(head, 1))).toBe("FORBIDDEN"); // the detailed log is for those trusted with it
    const log = await lib.libraryActivity(admin, 1);
    expect(log.items.some((e) => e.title === "Counted" && e.who?.includes(stu1.admissionNo))).toBe(true);
  });

  it("search filters, pages and finds by title, description and subject; an empty search gives an empty list", async () => {
    expect((await lib.searchLibrary(school.id, s1, { q: "maths" }, "EN")).items.map((i) => i.title)).toContain("Maths booklet");
    expect((await lib.searchLibrary(school.id, s1, { subjectId: math.id }, "EN")).items.map((i) => i.title)).toEqual(["Maths booklet"]);
    expect((await lib.searchLibrary(school.id, s1, { classId: setup.cls.id }, "EN")).items.map((i) => i.title).sort()).toEqual(["Class A notes", "Counted"]);
    expect((await lib.searchLibrary(school.id, s1, { q: "zzzz-nothing-matches" }, "EN"))).toMatchObject({ total: 0, items: [] });
    expect((await lib.searchLibrary(school.id, s1, { type: "PDF" }, "EN")).total).toBeGreaterThan(0);
    expect((await lib.searchLibrary(school.id, s1, { type: "SLIDES" }, "EN")).total).toBe(0);
    const p1 = await lib.searchLibrary(school.id, s1, { sort: "title" }, "EN");
    expect(p1.items.length).toBeLessThanOrEqual(lib.PAGE_SIZE);
    const titles = p1.items.map((i) => i.title);
    expect([...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))).toEqual(titles.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  });

  it("a visitor cannot reach protected files by guessing an id or a version number", async () => {
    expect(await open(VISITOR, randomUUID())).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    const r = await lib.openLibraryFile({ viewer: VISITOR, viewerSchoolId: null, account: null, resourceId: forStudents.id, kind: "DOWNLOAD", version: 1 });
    expect(r).toMatchObject({ ok: false });
    expect(await lib.openCover({ viewer: VISITOR, viewerSchoolId: null, account: null, resourceId: teachersOnly.id })).toBeNull();
  });

  it("an enrolled student who has not been placed in a class gets public and student material only", async () => {
    const fresh = await students.createStudent(registrar, studentInput(++n, {}));
    const pin = (await ident.setStudentPin(registrar, fresh.id)).pin;
    const v = await viewerOf((await ident.verifySchoolId(school.id, { schoolId: fresh.admissionNo, secret: pin }, meta())).token);
    expect(v).toMatchObject({ kind: "STUDENT", classId: null });
    expect(await open(v, classA.id)).toMatchObject({ ok: false });
    expect(await open(v, forStudents.id)).toMatchObject({ ok: true });
  });
});
