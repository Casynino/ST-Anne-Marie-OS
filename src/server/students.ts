import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { getAdmissionSettings, type AdmissionSettings } from "@/server/settings";
import { teachingScope } from "@/server/academics";
import { guardianLinkSchema, resolveGuardian } from "@/server/guardians";
import { checkbox, dateOnly, optDateOnly, optText, optUuid, parse, phoneField, text, uuid } from "@/lib/validation";

// ───────────────────────── Admission numbers ─────────────────────────

export function formatAdmissionNo(s: AdmissionSettings, year: number, seq: number): string {
  return s.pattern
    .replaceAll("{PREFIX}", s.prefix)
    .replaceAll("{YEAR}", String(year))
    .replaceAll("{YY}", String(year).slice(-2))
    .replaceAll("{SEQ}", String(seq).padStart(s.seqPadding, "0"));
}

/**
 * Atomically allocates the next admission number. The counter row is locked until the surrounding
 * transaction commits, so concurrent registrations are serialised and can never receive the same
 * number. Counters only move forward: numbers of withdrawn students are never reissued.
 */
export async function allocateAdmissionNo(tx: Tx, schoolId: string, settings: AdmissionSettings, year: number): Promise<string> {
  const scope = settings.resetYearly ? String(year) : "ALL";
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO admission_counters ("schoolId", "scope", "lastValue")
      VALUES (${schoolId}::uuid, ${scope}, 1)
      ON CONFLICT ("schoolId", "scope") DO UPDATE SET "lastValue" = admission_counters."lastValue" + 1
      RETURNING "lastValue"`;
    const admissionNo = formatAdmissionNo(settings, year, rows[0]!.lastValue);
    // Skips numbers already taken by manually imported/legacy records.
    if (!(await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo } }, select: { id: true } }))) return admissionNo;
  }
  throw conflict("Could not allocate an admission number. Please check the admission number settings.");
}

// ───────────────────────── Access scope ─────────────────────────

const NO_STUDENTS: Prisma.StudentWhereInput = { id: "00000000-0000-0000-0000-000000000000" };

/**
 * Which students this user may see. School-wide for `student.read`; for `student.read_assigned`
 * only students actively enrolled (current year) in a class/stream the staff member teaches.
 */
export async function studentScope(ctx: AuthContext): Promise<Prisma.StudentWhereInput> {
  if (ctx.permissions.has("student.read")) return { schoolId: ctx.schoolId };
  if (!ctx.permissions.has("student.read_assigned")) throw forbidden();
  if (!ctx.staffId) return NO_STUDENTS;
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!year) return NO_STUDENTS;
  const scope = await teachingScope(ctx.staffId, year.id);
  if (!scope.length) return NO_STUDENTS;
  return {
    schoolId: ctx.schoolId,
    enrollments: {
      some: {
        academicYearId: year.id,
        status: "ACTIVE",
        OR: scope.map((s) => (s.streamId ? { classId: s.classId, streamId: s.streamId } : { classId: s.classId })),
      },
    },
  };
}

// ───────────────────────── Registration ─────────────────────────

const emergencyContactSchema = z.object({ name: text(100), relationship: text(60), phone: phoneField() });

const detailsShape = {
  firstName: text(60),
  middleName: optText(60),
  lastName: text(60),
  dateOfBirth: dateOnly(),
  gender: z.enum(["MALE", "FEMALE"]),
  nationality: optText(60),
  religion: optText(60),
  birthCertificateNo: optText(40),
  previousSchool: optText(150),
  address: optText(300),
  medicalNotes: optText(2000),
};

const createSchema = z.object({
  ...detailsShape,
  admissionDate: optDateOnly(),
  classId: optUuid(),
  streamId: optUuid(),
  guardians: z.array(guardianLinkSchema).min(1, "Add at least one guardian").max(6),
  emergencyContacts: z.array(emergencyContactSchema).max(3).default([]),
  confirmDuplicate: checkbox().default(false),
});

export type CreateStudentInput = z.input<typeof createSchema>;

async function resolveEnrollmentTarget(tx: Tx | typeof db, schoolId: string, d: { academicYearId?: string; classId: string; streamId?: string }) {
  const year = d.academicYearId
    ? await tx.academicYear.findFirst({ where: { id: d.academicYearId, schoolId } })
    : await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
  if (!year) throw invalid("Set a current academic year before enrolling students.", { classId: "No academic year available" });
  const cls = await tx.schoolClass.findFirst({ where: { id: d.classId, schoolId } });
  if (!cls) throw notFound("Class");
  if (!cls.isActive) throw invalid("This class is not active.", { classId: "Class is inactive" });
  if (d.streamId) {
    const stream = await tx.stream.findFirst({ where: { id: d.streamId, schoolId, classId: d.classId } });
    if (!stream) throw invalid("That stream does not belong to the selected class.", { streamId: "Invalid stream" });
  } else if (await tx.stream.count({ where: { classId: d.classId } })) {
    throw invalid("Select a stream for this class.", { streamId: "Required for this class" });
  }
  return year;
}

type ParsedCreate = z.output<typeof createSchema>;
export type PreparedStudent = { d: ParsedCreate; today: Date; admissionDate: Date };

/** Permission checks, validation and date rules for registering a student. No database writes. */
export async function prepareStudent(ctx: AuthContext, input: unknown): Promise<PreparedStudent> {
  requirePermission(ctx, "student.create");
  requirePermission(ctx, "guardian.manage");
  const d = parse(createSchema, input);
  if (d.classId) requirePermission(ctx, "student.enroll");
  if (d.medicalNotes) requirePermission(ctx, "student.medical.update");
  if (d.streamId && !d.classId) throw invalid("Select a class for the stream.", { classId: "Required" });

  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = parseDateOnly(todayInTimezone(school.timezone)) as Date;
  const admissionDate = d.admissionDate ?? today;
  if (d.dateOfBirth >= admissionDate) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "Date of birth must be before the admission date" });
  if (d.dateOfBirth > today) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "Date of birth cannot be in the future" });
  return { d, today, admissionDate };
}

/**
 * Creates the student, guardians, enrolment and audit entry inside the caller's transaction. Shared by
 * direct registration and by the admissions "enrol" step so both follow exactly the same rules
 * (duplicate check, concurrency-safe admission number, guardian rules).
 */
export async function createStudentInTx(tx: Tx, ctx: AuthContext, p: PreparedStudent, audit: { source?: string; applicationId?: string } = {}) {
  const { d, admissionDate } = p;
  if (!d.confirmDuplicate) {
    const dup = await tx.student.findFirst({
      where: {
        schoolId: ctx.schoolId,
        firstName: { equals: d.firstName, mode: "insensitive" },
        lastName: { equals: d.lastName, mode: "insensitive" },
        dateOfBirth: d.dateOfBirth,
      },
      select: { admissionNo: true },
    });
    if (dup) {
      throw conflict(`A student with the same name and date of birth already exists (${dup.admissionNo}). If this is a different child, confirm and submit again.`);
    }
  }

  const year = d.classId ? await resolveEnrollmentTarget(tx, ctx.schoolId, { classId: d.classId, streamId: d.streamId }) : null;

  const settings = await getAdmissionSettings(tx, ctx.schoolId);
  const admissionNo = await allocateAdmissionNo(tx, ctx.schoolId, settings, admissionDate.getUTCFullYear());

  const student = await tx.student.create({
    data: {
      schoolId: ctx.schoolId,
      admissionNo,
      firstName: d.firstName,
      middleName: d.middleName,
      lastName: d.lastName,
      dateOfBirth: d.dateOfBirth,
      gender: d.gender,
      admissionDate,
      nationality: d.nationality,
      religion: d.religion,
      birthCertificateNo: d.birthCertificateNo,
      previousSchool: d.previousSchool,
      address: d.address,
      medicalNotes: d.medicalNotes,
      createdById: ctx.userId,
      emergencyContacts: { create: d.emergencyContacts.map((c, i) => ({ ...c, schoolId: ctx.schoolId, sortOrder: i })) },
    },
  });

  const seen = new Set<string>();
  const primaryIndex = Math.max(0, d.guardians.findIndex((g) => g.isPrimary));
  for (const [i, g] of d.guardians.entries()) {
    const guardianId = await resolveGuardian(tx, ctx, g);
    if (seen.has(guardianId)) throw invalid("The same guardian was added twice.", { [`guardians.${i}.guardianId`]: "Duplicate guardian" });
    seen.add(guardianId);
    await tx.studentGuardian.create({
      data: {
        studentId: student.id,
        guardianId,
        schoolId: ctx.schoolId,
        relationship: g.relationship,
        isPrimary: i === primaryIndex,
        isFinanciallyResponsible: g.isFinanciallyResponsible,
        receivesNotifications: g.receivesNotifications,
      },
    });
  }

  if (year && d.classId) {
    await tx.studentEnrollment.create({
      data: { schoolId: ctx.schoolId, studentId: student.id, academicYearId: year.id, classId: d.classId, streamId: d.streamId, startedOn: admissionDate, createdById: ctx.userId },
    });
  }

  await writeAudit(tx, actorOf(ctx), {
    action: "student.create",
    entityType: "Student",
    entityId: student.id,
    summary: `${student.firstName} ${student.lastName} (${admissionNo})`,
    changes: {
      admissionNo,
      classId: d.classId ?? null,
      streamId: d.streamId ?? null,
      guardianCount: d.guardians.length,
      duplicateConfirmed: d.confirmDuplicate,
      ...(audit.source ? { source: audit.source } : {}),
      ...(audit.applicationId ? { applicationId: audit.applicationId } : {}),
    },
  });
  return student;
}

export async function createStudent(ctx: AuthContext, input: unknown) {
  const prepared = await prepareStudent(ctx, input);
  return db.$transaction((tx) => createStudentInTx(tx, ctx, prepared));
}

// ───────────────────────── Update ─────────────────────────

const updateSchema = z
  .object({ ...detailsShape, medicalNotes: optText(2000) })
  .refine((v) => v.dateOfBirth < new Date(), { path: ["dateOfBirth"], message: "Date of birth cannot be in the future" });

const EDITABLE = ["firstName", "middleName", "lastName", "dateOfBirth", "gender", "nationality", "religion", "birthCertificateNo", "previousSchool", "address"] as const;

export async function updateStudent(ctx: AuthContext, studentId: string, input: unknown) {
  requirePermission(ctx, "student.update");
  const d = parse(updateSchema, input);
  const student = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId } });
  if (!student) throw notFound("Student");
  if (d.dateOfBirth >= student.admissionDate) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "Date of birth must be before the admission date" });

  // Editing requires being able to READ the notes too, otherwise a blank form would silently wipe them.
  const canEditMedical = ctx.permissions.has("student.medical.update") && ctx.permissions.has("student.medical.read");
  const data = {
    firstName: d.firstName,
    middleName: d.middleName ?? null,
    lastName: d.lastName,
    dateOfBirth: d.dateOfBirth,
    gender: d.gender,
    nationality: d.nationality ?? null,
    religion: d.religion ?? null,
    birthCertificateNo: d.birthCertificateNo ?? null,
    previousSchool: d.previousSchool ?? null,
    address: d.address ?? null,
    ...(canEditMedical ? { medicalNotes: d.medicalNotes ?? null } : {}),
  };
  const changes: Record<string, unknown> = diffFields(student, data, EDITABLE);
  if (canEditMedical && (student.medicalNotes ?? null) !== (data.medicalNotes ?? null)) changes.medicalNotes = "changed"; // content is never written to the audit log

  await db.$transaction(async (tx) => {
    await tx.student.update({ where: { id: studentId }, data });
    await writeAudit(tx, actorOf(ctx), {
      action: "student.update",
      entityType: "Student",
      entityId: studentId,
      summary: `${data.firstName} ${data.lastName} (${student.admissionNo})`,
      changes,
    });
  });
}

// ───────────────────────── Enrollment & status ─────────────────────────

const enrollSchema = z.object({ academicYearId: optUuid(), classId: uuid(), streamId: optUuid() });

/**
 * Places a student in a class/stream for an academic year. Never overwrites history: an existing
 * ACTIVE enrollment is closed (MOVED within the same year, COMPLETED from an earlier year) and a
 * new row is opened.
 */
export async function enrollStudent(ctx: AuthContext, studentId: string, input: unknown) {
  requirePermission(ctx, "student.enroll");
  const d = parse(enrollSchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = parseDateOnly(todayInTimezone(school.timezone)) as Date;

  await db.$transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId } });
    if (!student) throw notFound("Student");
    if (student.status !== "ENROLLED") throw conflict("Only students with status Enrolled can be placed in a class. Reinstate the student first.");
    const year = await resolveEnrollmentTarget(tx, ctx.schoolId, { academicYearId: d.academicYearId, classId: d.classId, streamId: d.streamId });
    if (year.endsOn < today) throw invalid("Cannot enrol into an academic year that has already ended.", { classId: "Academic year has ended" });

    const active = await tx.studentEnrollment.findMany({ where: { studentId, status: "ACTIVE" }, include: { academicYear: true } });
    const sameYear = active.find((e) => e.academicYearId === year.id);
    if (sameYear && sameYear.classId === d.classId && (sameYear.streamId ?? null) === (d.streamId ?? null)) {
      throw conflict("The student is already in this class.");
    }
    for (const e of active) {
      const closedOn = e.startedOn > today ? e.startedOn : today;
      await tx.studentEnrollment.update({
        where: { id: e.id },
        data: { status: e.academicYearId === year.id ? "MOVED" : "COMPLETED", endedOn: closedOn },
      });
    }
    const startedOn = today < year.startsOn ? year.startsOn : today;
    const created = await tx.studentEnrollment.create({
      data: { schoolId: ctx.schoolId, studentId, academicYearId: year.id, classId: d.classId, streamId: d.streamId, startedOn, createdById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: sameYear ? "student.move_class" : "student.enroll",
      entityType: "Student",
      entityId: studentId,
      summary: `${student.firstName} ${student.lastName} (${student.admissionNo})`,
      changes: { enrollmentId: created.id, academicYearId: year.id, classId: d.classId, streamId: d.streamId ?? null, previous: active.map((e) => ({ classId: e.classId, streamId: e.streamId })) },
    });
  });
}

const statusSchema = z.object({
  status: z.enum(["ENROLLED", "TRANSFERRED", "WITHDRAWN", "GRADUATED"]),
  reason: text(500),
  effectiveOn: dateOnly(),
});

const ENDING_STATUS = { TRANSFERRED: "TRANSFERRED_OUT", WITHDRAWN: "WITHDRAWN", GRADUATED: "COMPLETED" } as const;

export async function changeStudentStatus(ctx: AuthContext, studentId: string, input: unknown) {
  requirePermission(ctx, "student.status_change");
  const d = parse(statusSchema, input);
  await db.$transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId } });
    if (!student) throw notFound("Student");
    if (student.status === d.status) throw conflict("The student already has this status.");
    const leaving = student.status === "ENROLLED" && d.status !== "ENROLLED";
    const returning = student.status !== "ENROLLED" && d.status === "ENROLLED";
    if (!leaving && !returning) throw invalid("This status change is not allowed.", { status: "Not allowed from the current status" });
    if (d.effectiveOn < student.admissionDate) throw invalid("Please correct the highlighted fields.", { effectiveOn: "Cannot be before the admission date" });

    if (leaving) {
      const active = await tx.studentEnrollment.findMany({ where: { studentId, status: "ACTIVE" } });
      for (const e of active) {
        await tx.studentEnrollment.update({
          where: { id: e.id },
          data: { status: ENDING_STATUS[d.status as keyof typeof ENDING_STATUS], endedOn: d.effectiveOn < e.startedOn ? e.startedOn : d.effectiveOn },
        });
      }
    }
    await tx.student.update({
      where: { id: studentId },
      data: leaving ? { status: d.status, exitedOn: d.effectiveOn, exitReason: d.reason } : { status: "ENROLLED", exitedOn: null, exitReason: null },
    });
    await tx.studentStatusHistory.create({
      data: { schoolId: ctx.schoolId, studentId, fromStatus: student.status, toStatus: d.status, reason: d.reason, effectiveOn: d.effectiveOn, changedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: "student.status_change",
      entityType: "Student",
      entityId: studentId,
      summary: `${student.firstName} ${student.lastName} (${student.admissionNo})`,
      changes: { from: student.status, to: d.status, effectiveOn: formatDateOnly(d.effectiveOn) },
      reason: d.reason,
    });
  });
}

// ───────────────────────── Reads ─────────────────────────

export async function listStudents(
  ctx: AuthContext,
  opts: { q?: string; classId?: string; streamId?: string; status?: string; page?: number; all?: boolean } = {},
) {
  const scope = await studentScope(ctx);
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });

  const and: Prisma.StudentWhereInput[] = [scope];
  for (const token of (opts.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
    and.push({
      OR: [
        { firstName: { contains: token, mode: "insensitive" } },
        { middleName: { contains: token, mode: "insensitive" } },
        { lastName: { contains: token, mode: "insensitive" } },
        { admissionNo: { contains: token, mode: "insensitive" } },
      ],
    });
  }
  if (opts.status && ["ENROLLED", "TRANSFERRED", "WITHDRAWN", "GRADUATED"].includes(opts.status)) and.push({ status: opts.status as "ENROLLED" });
  if (opts.classId) {
    and.push({
      enrollments: {
        some: { status: "ACTIVE", ...(year ? { academicYearId: year.id } : {}), classId: opts.classId, ...(opts.streamId ? { streamId: opts.streamId } : {}) },
      },
    });
  }
  const where: Prisma.StudentWhereInput = { AND: and };

  const [items, total] = await Promise.all([
    db.student.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: opts.all ? 0 : (page - 1) * pageSize,
      take: opts.all ? 5000 : pageSize,
      select: {
        id: true, admissionNo: true, firstName: true, middleName: true, lastName: true, gender: true, status: true, dateOfBirth: true,
        enrollments: {
          where: { status: "ACTIVE", ...(year ? { academicYearId: year.id } : {}) },
          take: 1,
          select: { class: { select: { name: true } }, stream: { select: { name: true } } },
        },
      },
    }),
    db.student.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getStudentProfile(ctx: AuthContext, studentId: string) {
  const scope = await studentScope(ctx);
  const student = await db.student.findFirst({
    where: { AND: [scope, { id: studentId }] },
    include: {
      enrollments: { orderBy: { startedOn: "desc" }, include: { academicYear: true, class: true, stream: true } },
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!student) throw notFound("Student");

  const canSeeGuardians = ctx.permissions.has("student.guardians.read");
  const canSeeMedical = ctx.permissions.has("student.medical.read");

  const [guardians, emergencyContacts] = canSeeGuardians
    ? await Promise.all([
        db.studentGuardian.findMany({ where: { studentId, schoolId: ctx.schoolId }, include: { guardian: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
        db.emergencyContact.findMany({ where: { studentId, schoolId: ctx.schoolId }, orderBy: { sortOrder: "asc" } }),
      ])
    : [[], []];

  // Siblings: other students sharing an explicitly linked guardian.
  const siblings = canSeeGuardians && guardians.length
    ? await db.student.findMany({
        where: { schoolId: ctx.schoolId, id: { not: studentId }, guardians: { some: { guardianId: { in: guardians.map((g) => g.guardianId) } } } },
        select: { id: true, firstName: true, lastName: true, admissionNo: true, status: true },
        orderBy: { firstName: "asc" },
      })
    : [];

  if (canSeeMedical && student.medicalNotes) {
    await writeAudit(db, actorOf(ctx), { action: "student.medical_view", entityType: "Student", entityId: studentId, summary: student.admissionNo });
  }

  return {
    ...student,
    medicalNotes: canSeeMedical ? student.medicalNotes : null,
    canSeeGuardians,
    canSeeMedical,
    guardians,
    emergencyContacts,
    siblings,
  };
}

export async function studentCounts(ctx: AuthContext) {
  const scope = await studentScope(ctx);
  const [enrolled, total] = await Promise.all([
    db.student.count({ where: { AND: [scope, { status: "ENROLLED" }] } }),
    db.student.count({ where: scope }),
  ]);
  return { enrolled, total };
}
