import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { conflict, invalid } from "@/lib/errors";
import type { RequestMeta } from "@/lib/auth/context";
import { ageOn, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { writeAudit } from "@/server/audit";
import { openTask } from "@/server/workflow";
import { allocateApplicationNo, OPEN_STATUSES } from "@/server/admissions";
import { guardianLinkSchema, RELATIONSHIPS } from "@/server/guardians";
import { checkbox, dateOnly, optEmailField, optPhoneField, optText, phoneField, text, uuid } from "@/lib/validation";

/*
 * The part of an online application that is the same whether it is submitted straight away (no fee) or only after the family has paid the
 * application fee: the form, its checks, and the creation of the application in the Admissions Office's queue. Used by the public
 * submission (`public-applications.ts`) and by the fee confirmation (`application-fee.ts`).
 */

export const onlineSchema = z
  .object({
    firstName: text(60),
    middleName: optText(60),
    lastName: text(60),
    dateOfBirth: dateOnly(),
    gender: z.enum(["MALE", "FEMALE"]),
    classAppliedId: uuid(),
    previousSchool: optText(150),
    nationality: optText(60),
    address: optText(300),
    g1_fullName: text(120),
    g1_phone: phoneField(),
    g1_email: optEmailField(),
    g1_relationship: z.enum(RELATIONSHIPS),
    g2_fullName: optText(120),
    g2_phone: optPhoneField(),
    g2_relationship: z.preprocess((v) => (v === "" ? undefined : v), z.enum(RELATIONSHIPS).optional()),
    consent: checkbox(),
    /** Only for a family creating its account while applying. Never stored with the application. */
    password: z.string().max(128).optional(),
    password2: z.string().max(128).optional(),
  })
  .superRefine((v, c) => {
    if (!v.consent) c.addIssue({ code: "custom", path: ["consent"], message: "You must agree to continue" });
    const any2 = v.g2_fullName || v.g2_phone;
    if (any2) {
      if (!v.g2_fullName) c.addIssue({ code: "custom", path: ["g2_fullName"], message: "Required" });
      if (!v.g2_phone) c.addIssue({ code: "custom", path: ["g2_phone"], message: "Required" });
      if (!v.g2_relationship) c.addIssue({ code: "custom", path: ["g2_relationship"], message: "Required" });
    }
  });

export type OnlineForm = z.output<typeof onlineSchema>;
/** What a draft keeps: the form without the password, as plain JSON. */
export type StoredForm = Omit<OnlineForm, "password" | "password2" | "dateOfBirth"> & { dateOfBirth: string };

/** What the family is told about an application's stage (a rejection is only ever shown as "decided"). */
export const STATUS_PUBLIC: Record<string, string> = { APPLIED: "APPLIED", INTERVIEW: "INTERVIEW", ACCEPTED: "ACCEPTED", ENROLLED: "ENROLLED", REJECTED: "DECIDED", WITHDRAWN: "WITHDRAWN" };

export const DUPLICATE_MESSAGE = "We already have a record that matches this child. Please contact the school office and we will help you.";

export const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; message?: string; cause?: { code?: string } } | null;
  return x?.code === "P2002" || x?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(x?.message ?? "");
};

export function toStored(d: OnlineForm): StoredForm {
  const { password: _p, password2: _p2, dateOfBirth, ...rest } = d;
  return JSON.parse(JSON.stringify({ ...rest, dateOfBirth: dateOfBirth.toISOString() })) as StoredForm;
}

export function fromStored(s: StoredForm): OnlineForm {
  return { ...s, dateOfBirth: new Date(s.dateOfBirth), password: undefined, password2: undefined } as OnlineForm;
}

type SchoolLite = { id: string; timezone: string };

/** Everything that must be true of the form before anything is saved (a real date of birth, an active class, the guardians in the shared format). */
export async function prepareOnline(school: SchoolLite, d: OnlineForm) {
  const today = parseDateOnly(todayInTimezone(school.timezone)) as Date;
  const age = ageOn(d.dateOfBirth, today);
  if (d.dateOfBirth >= today) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "The date of birth must be in the past" });
  if (age > 25) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "The applicant must be 25 years old or younger. Check the year." });
  const cls = await db.schoolClass.findFirst({ where: { id: d.classAppliedId, schoolId: school.id, isActive: true }, select: { id: true } });
  if (!cls) throw invalid("Please correct the highlighted fields.", { classAppliedId: "Choose a class from the list" });
  const intake = await db.academicYear.findFirst({ where: { schoolId: school.id, endsOn: { gte: today } }, orderBy: { startsOn: "asc" }, select: { id: true } });
  const guardiansRaw = [
    { fullName: d.g1_fullName, phone: d.g1_phone, email: d.g1_email, relationship: d.g1_relationship, isPrimary: "on", receivesNotifications: "on", isFinanciallyResponsible: "on" },
    ...(d.g2_fullName ? [{ fullName: d.g2_fullName, phone: d.g2_phone, relationship: d.g2_relationship, receivesNotifications: "on" }] : []),
  ];
  return { today, classId: cls.id, intakeYearId: intake?.id, guardians: guardiansRaw.map((g) => guardianLinkSchema.parse(g)) };
}
export type PreparedOnline = Awaited<ReturnType<typeof prepareOnline>>;

/** Same rules as staff entry, but the answer never says which record matched (no application or admission numbers). */
export async function assertNoOpenDuplicate(tx: Tx, schoolId: string, d: Pick<OnlineForm, "firstName" | "lastName" | "dateOfBirth">) {
  const match = { OR: [{ firstName: { equals: d.firstName, mode: "insensitive" as const }, lastName: { equals: d.lastName, mode: "insensitive" as const }, dateOfBirth: d.dateOfBirth }] };
  const [openApp, student] = await Promise.all([
    tx.application.findFirst({ where: { schoolId, status: { in: [...OPEN_STATUSES] }, ...match }, select: { id: true } }),
    tx.student.findFirst({ where: { schoolId, ...match }, select: { id: true } }),
  ]);
  if (openApp || student) throw conflict(DUPLICATE_MESSAGE);
}

/** Creates the application in the Admissions Office's queue as APPLIED (source ONLINE) and tells the office. Nothing is enrolled. */
export async function insertOnlineApplication(tx: Tx, schoolId: string, d: OnlineForm, p: PreparedOnline, meta: RequestMeta, audit: { feePaidCents?: number; feeReference?: string } = {}) {
  await assertNoOpenDuplicate(tx, schoolId, d);
  const applicationNo = await allocateApplicationNo(tx, schoolId, p.today.getUTCFullYear());
  const app = await tx.application.create({
    data: {
      schoolId,
      applicationNo,
      source: "ONLINE",
      consentAt: new Date(),
      firstName: d.firstName,
      middleName: d.middleName,
      lastName: d.lastName,
      dateOfBirth: d.dateOfBirth,
      gender: d.gender,
      classAppliedId: p.classId,
      intakeYearId: p.intakeYearId,
      nationality: d.nationality,
      previousSchool: d.previousSchool,
      address: d.address,
      guardians: p.guardians as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.applicationEvent.create({ data: { schoolId, applicationId: app.id, toStatus: "APPLIED" } });
  await openTask(tx, { schoolId, kind: "APPLICATION_REVIEW", relatedType: "Application", relatedId: app.id, relatedLabel: `${app.firstName} ${app.lastName} (${applicationNo})`, sourceEvent: "application.received_online" });
  await writeAudit(tx, { schoolId, actorId: null, actorName: "Online applicant", meta }, {
    action: "admission.create_online",
    entityType: "Application",
    entityId: app.id,
    summary: `${app.firstName} ${app.lastName} (${applicationNo})`,
    changes: { applicationNo, source: "ONLINE", ...(audit.feePaidCents !== undefined ? { applicationFeePaidCents: audit.feePaidCents, feeReference: audit.feeReference } : {}) },
  });
  return { id: app.id, applicationNo };
}
