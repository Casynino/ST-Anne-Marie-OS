import { createHash, randomBytes, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { AppError, invalid } from "@/lib/errors";
import { buildAuthContext, requirePermission, type AuthContext, type RequestMeta } from "@/lib/auth/context";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeRateLimit } from "@/lib/rate-limit";
import type { Level, Viewer } from "@/lib/library/access";
import { actorOf, writeAudit } from "@/server/audit";
import { getLibrarySettings } from "@/server/library-settings";
import { findBySchoolId, normaliseSchoolId } from "@/server/school-ids";
import { studentScope } from "@/server/students";

/*
 * Who is at the library. A school ID names a person but is not proof of who is typing it, so entering one is never enough on its own:
 *  - a student gives the ID and the PIN the school set for them (or the password of their school account),
 *  - a teacher or staff member gives the ID and their account password,
 *  - a signed-in school account needs no extra step,
 *  - only when the school has switched "ID alone" on, and only for the items it marked, the ID by itself is accepted (students only).
 * Failures say one generic thing, so nobody can learn which IDs exist; attempts are limited per connection and per ID. Nothing private
 * (phone, address, fees, results) is ever returned by this check. A verified person gets a session cookie that stores only a hash.
 */

export const LIBRARY_COOKIE = "sam_lib";
const WINDOW = 15 * 60 * 1000;
const GENERIC = "We could not verify these details. Check your school ID and PIN, or ask your class teacher or the school office.";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// ───────────────────────── Viewers ─────────────────────────

async function currentYearId(schoolId: string) {
  return (await db.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } }))?.id ?? null;
}

/** An officially enrolled student, with the class they are in this year and that class's subjects. Anyone else gets null. */
export async function studentViewer(schoolId: string, studentId: string, level: Level): Promise<Viewer | null> {
  const student = await db.student.findFirst({ where: { id: studentId, schoolId }, select: { status: true } });
  if (!student || student.status !== "ENROLLED") return null;
  const yearId = await currentYearId(schoolId);
  const enrol = yearId ? await db.studentEnrollment.findFirst({ where: { schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true } }) : null;
  const subjects = enrol ? await db.classSubject.findMany({ where: { classId: enrol.classId }, select: { subjectId: true } }) : [];
  return { kind: "STUDENT", studentId, classId: enrol?.classId ?? null, subjectIds: subjects.map((s) => s.subjectId), level };
}

/** An active staff member: the classes and subjects they teach this year and what their account may do in the library. */
export async function staffViewer(schoolId: string, staffId: string, level: Level): Promise<Viewer | null> {
  const staff = await db.staff.findFirst({ where: { id: staffId, schoolId }, select: { userId: true } });
  if (!staff) return null;
  let ctx: AuthContext;
  try { ctx = await buildAuthContext(staff.userId); } catch { return null; } // suspended or removed accounts
  const yearId = await currentYearId(schoolId);
  const [ct, st] = yearId
    ? await Promise.all([db.classTeacher.findMany({ where: { schoolId, academicYearId: yearId, staffId }, select: { classId: true } }), db.subjectTeacher.findMany({ where: { schoolId, academicYearId: yearId, staffId }, select: { classId: true, subjectId: true } })])
    : [[], []];
  const ofClassTeacher = ct.length ? await db.classSubject.findMany({ where: { classId: { in: ct.map((c) => c.classId) } }, select: { subjectId: true } }) : [];
  return {
    kind: "STAFF", staffId, level,
    classIds: [...new Set([...ct.map((c) => c.classId), ...st.map((s) => s.classId)])],
    subjectIds: [...new Set([...st.map((s) => s.subjectId), ...ofClassTeacher.map((s) => s.subjectId)])],
    canReadStaffMaterial: ctx.permissions.has("library.access_staff"),
    manager: ctx.permissions.has("library.manage"),
  };
}

/** The viewer for someone signed in to a school account (staff, student or parent). */
export async function viewerForAccount(ctx: AuthContext): Promise<Viewer> {
  if (ctx.userType === "GUARDIAN") return { kind: "GUARDIAN" };
  if (ctx.userType === "STUDENT") {
    const s = await db.student.findFirst({ where: { schoolId: ctx.schoolId, userId: ctx.userId }, select: { id: true } });
    return (s && (await studentViewer(ctx.schoolId, s.id, "FULL"))) || { kind: "VISITOR" };
  }
  const staff = await db.staff.findFirst({ where: { schoolId: ctx.schoolId, userId: ctx.userId }, select: { id: true } });
  return (staff && (await staffViewer(ctx.schoolId, staff.id, "FULL"))) || { kind: "VISITOR" };
}

/** The viewer behind a library session cookie, or null when it is unknown or has expired. */
export async function viewerForToken(token: string | undefined | null): Promise<{ viewer: Viewer; schoolId: string } | null> {
  if (!token) return null;
  const row = await db.librarySession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.expiresAt <= new Date()) return null;
  const viewer = row.studentId ? await studentViewer(row.schoolId, row.studentId, row.level) : row.staffId ? await staffViewer(row.schoolId, row.staffId, row.level) : null;
  if (!viewer) { await db.librarySession.delete({ where: { id: row.id } }).catch(() => undefined); return null; }
  return { viewer, schoolId: row.schoolId };
}

export async function endLibrarySession(token: string | undefined | null) {
  if (!token) return;
  await db.librarySession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// ───────────────────────── Verification ─────────────────────────

/**
 * Checks a school ID with its PIN or password and opens a library session. One generic failure for every wrong case; rate limited.
 * `secret` empty means "ID alone", which only works for a student, and only when the school allows it.
 */
export async function verifySchoolId(schoolId: string, input: { schoolId: unknown; secret?: unknown }, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
  const tooMany = () => new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  if (!(await consumeRateLimit(`lib:ip:${meta.ip ?? "unknown"}`, 30, WINDOW))) throw tooMany();
  const id = normaliseSchoolId(input.schoolId);
  const secret = typeof input.secret === "string" ? input.secret.trim().slice(0, 128) : "";
  const fail = async () => { await verifyPassword(secret || "x", DUMMY_HASH); return invalid(GENERIC); }; // the same work on every failure
  if (!id) throw await fail();
  if (!(await consumeRateLimit(`lib:id:${schoolId}:${id}`, 8, WINDOW))) throw tooMany();
  const settings = await getLibrarySettings(db, schoolId);
  const found = await findBySchoolId(schoolId, id);
  if (!found) throw await fail();

  let level: Level = "FULL";
  let viewer: Viewer | null = null;
  let who: { studentId?: string; staffId?: string; name: string };
  if (found.kind === "STUDENT") {
    const student = await db.student.findFirst({ where: { id: found.studentId, schoolId }, select: { id: true, status: true, firstName: true, lastName: true, libraryPin: { select: { pinHash: true } }, user: { select: { passwordHash: true, status: true } } } });
    if (!student || student.status !== "ENROLLED") throw await fail();
    if (secret === "") {
      if (!settings.allowIdOnly) throw await fail();
      level = "ID_ONLY";
    } else {
      const hashes = [student.libraryPin?.pinHash, student.user?.status === "ACTIVE" ? student.user.passwordHash : undefined].filter((h): h is string => !!h);
      let ok = false;
      for (const h of hashes.length ? hashes : [DUMMY_HASH]) ok = (await verifyPassword(secret, h)) || ok;
      if (!ok || hashes.length === 0) throw await fail();
    }
    viewer = await studentViewer(schoolId, student.id, level);
    who = { studentId: student.id, name: `${student.firstName} ${student.lastName}` };
  } else {
    const staff = await db.staff.findFirst({ where: { id: found.staffId, schoolId }, select: { id: true, user: { select: { passwordHash: true, status: true, fullName: true } } } });
    // Staff always give their password: an ID alone never opens anything for a staff member.
    if (!staff || staff.user.status !== "ACTIVE" || secret === "" || !(await verifyPassword(secret, staff.user.passwordHash))) throw await fail();
    viewer = await staffViewer(schoolId, staff.id, "FULL");
    who = { staffId: staff.id, name: staff.user.fullName };
  }
  if (!viewer) throw await fail();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + settings.sessionHours * 3_600_000);
  await db.librarySession.create({ data: { schoolId, tokenHash: hashToken(token), person: found.kind === "STUDENT" ? "STUDENT" : "STAFF", studentId: who.studentId, staffId: who.staffId, level, expiresAt } });
  db.librarySession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } }).catch(() => undefined); // keeps the table small
  await writeAudit(db, { schoolId, actorId: null, actorName: `${who.name} (library)`, meta }, { action: "library.verify", entityType: found.kind === "STUDENT" ? "Student" : "Staff", entityId: who.studentId ?? who.staffId!, summary: level === "ID_ONLY" ? "School ID only" : "School ID with PIN or password" });
  return { token, expiresAt };
}

// ───────────────────────── Student PINs ─────────────────────────

const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Students of a class this year who are officially enrolled and whom this person may see. */
async function classStudents(ctx: AuthContext, classId: string) {
  const yearId = await currentYearId(ctx.schoolId);
  if (!yearId) return [];
  const scope = await studentScope(ctx);
  return db.student.findMany({
    where: { AND: [scope, { schoolId: ctx.schoolId, status: "ENROLLED", enrollments: { some: { academicYearId: yearId, classId, status: "ACTIVE" } } }] },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, admissionNo: true, libraryPin: { select: { setAt: true } } },
  });
}

export async function pinOverview(ctx: AuthContext, classId: string) {
  requirePermission(ctx, "library.pin");
  return (await classStudents(ctx, classId)).map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, schoolId: s.admissionNo, hasPin: !!s.libraryPin, setAt: s.libraryPin?.setAt ?? null }));
}

/**
 * Sets library PINs for a class. `missing` only gives a PIN to students who have none; `reset` replaces every PIN. The PINs are returned
 * ONCE (to print or read out) and are stored only as hashes, so nobody, not even an administrator, can read them back later.
 */
export async function setStudentPins(ctx: AuthContext, input: { classId: string; mode: "missing" | "reset" }) {
  requirePermission(ctx, "library.pin");
  const students = (await classStudents(ctx, input.classId)).filter((s) => input.mode === "reset" || !s.libraryPin).slice(0, 200);
  const out: { id: string; name: string; schoolId: string; pin: string }[] = [];
  for (const s of students) {
    const pin = newPin();
    const pinHash = await hashPassword(pin);
    await db.$transaction(async (tx) => {
      await tx.libraryPin.upsert({ where: { studentId: s.id }, create: { schoolId: ctx.schoolId, studentId: s.id, pinHash, setById: ctx.userId }, update: { pinHash, setById: ctx.userId, setAt: new Date() } });
      await writeAudit(tx, actorOf(ctx), { action: "library.pin_set", entityType: "Student", entityId: s.id, summary: `${s.firstName} ${s.lastName} (${s.admissionNo})` }); // the PIN itself is never logged
    });
    out.push({ id: s.id, name: `${s.firstName} ${s.lastName}`, schoolId: s.admissionNo, pin });
  }
  return out;
}

export async function setStudentPin(ctx: AuthContext, studentId: string) {
  requirePermission(ctx, "library.pin");
  const scope = await studentScope(ctx);
  const s = await db.student.findFirst({ where: { AND: [scope, { id: studentId, schoolId: ctx.schoolId, status: "ENROLLED" }] }, select: { id: true, firstName: true, lastName: true, admissionNo: true } });
  if (!s) throw invalid("That student cannot be given a library PIN.");
  const pin = newPin();
  const pinHash = await hashPassword(pin);
  await db.$transaction(async (tx) => {
    await tx.libraryPin.upsert({ where: { studentId: s.id }, create: { schoolId: ctx.schoolId, studentId: s.id, pinHash, setById: ctx.userId }, update: { pinHash, setById: ctx.userId, setAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "library.pin_set", entityType: "Student", entityId: s.id, summary: `${s.firstName} ${s.lastName} (${s.admissionNo})` });
  });
  return { id: s.id, name: `${s.firstName} ${s.lastName}`, schoolId: s.admissionNo, pin };
}
