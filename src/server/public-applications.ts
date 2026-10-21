import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, conflict, invalid } from "@/lib/errors";
import type { RequestMeta } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { ageOn, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { writeAudit } from "@/server/audit";
import { openTask } from "@/server/workflow";
import { admissionAccount } from "@/lib/admissions/rules";
import { centsOf } from "@/lib/finance/money";
import { getFeeSettings } from "@/server/fees";
import { allocateApplicationNo, OPEN_STATUSES } from "@/server/admissions";
import { guardianLinkSchema, RELATIONSHIPS } from "@/server/guardians";
import { loadWebsiteSettings } from "@/server/website";
import { checkbox, dateOnly, optEmailField, optPhoneField, optText, parse, phoneField, text, uuid } from "@/lib/validation";

/*
 * Online applications from the public website. These are UNAUTHENTICATED requests, so every rule is enforced here:
 * applications must be open, rate limits per connection, a honeypot, strict validation, the same duplicate rules as
 * staff entry (but with answers that never reveal other families' records), and the data lands in the normal
 * admissions queue as APPLIED with source ONLINE. Nothing is enrolled automatically.
 */

const WINDOW_HOUR = 60 * 60 * 1000;
const WINDOW_DAY = 24 * WINDOW_HOUR;

const onlineSchema = z
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

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; message?: string; cause?: { code?: string } } | null;
  return x?.code === "P2002" || x?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(x?.message ?? "");
};

/** Classes an applicant can choose from (real, active classes only). */
export async function listApplyClasses(schoolId: string, locale: "EN" | "SW") {
  const classes = await db.schoolClass.findMany({
    where: { schoolId, isActive: true },
    orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameSw: true, level: { select: { name: true, nameSw: true } } },
  });
  return classes.map((c) => ({
    id: c.id,
    name: locale === "SW" && c.nameSw ? c.nameSw : c.name,
    level: locale === "SW" && c.level.nameSw ? c.level.nameSw : c.level.name,
  }));
}

export async function submitOnlineApplication(schoolId: string, input: Record<string, unknown>, meta: RequestMeta): Promise<{ applicationNo: string | null }> {
  // Honeypot: real people never see or fill this field. Pretend success so bots learn nothing.
  if (typeof input.website === "string" && input.website.trim() !== "") return { applicationNo: null };

  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, timezone: true } });
  if (!school) throw new AppError("NOT_FOUND", "School not found.");
  const settings = await loadWebsiteSettings(school.id);
  if (!settings.applicationsOpen) throw conflict("Online applications are not open at the moment. Please contact the school office.");

  const ip = meta.ip ?? "unknown";
  const allowed = (await consumeRateLimit(`apply:ip:${ip}`, 5, WINDOW_HOUR)) && (await consumeRateLimit(`apply:school:${school.id}`, 300, WINDOW_DAY));
  if (!allowed) throw new AppError("RATE_LIMITED", "Too many applications from this connection. Please try again later or contact the school office.");

  const d = parse(onlineSchema, input);
  const today = parseDateOnly(todayInTimezone(school.timezone)) as Date;
  const age = ageOn(d.dateOfBirth, today);
  if (d.dateOfBirth >= today || age > 25) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "Enter the child's real date of birth" });

  const cls = await db.schoolClass.findFirst({ where: { id: d.classAppliedId, schoolId: school.id, isActive: true }, select: { id: true } });
  if (!cls) throw invalid("Please correct the highlighted fields.", { classAppliedId: "Choose a class from the list" });
  const intake = await db.academicYear.findFirst({ where: { schoolId: school.id, endsOn: { gte: today } }, orderBy: { startsOn: "asc" }, select: { id: true } });

  const guardiansRaw = [
    { fullName: d.g1_fullName, phone: d.g1_phone, email: d.g1_email, relationship: d.g1_relationship, isPrimary: "on", receivesNotifications: "on", isFinanciallyResponsible: "on" },
    ...(d.g2_fullName ? [{ fullName: d.g2_fullName, phone: d.g2_phone, relationship: d.g2_relationship, receivesNotifications: "on" }] : []),
  ];
  const guardians = guardiansRaw.map((g) => guardianLinkSchema.parse(g));
  const duplicateMessage = "We already have a record that matches this child. Please contact the school office and we will help you.";

  try {
    return await db.$transaction(async (tx) => {
      // Same rules as staff entry, but the answer never says which record matched (no application/admission numbers).
      const match = {
        OR: [{ firstName: { equals: d.firstName, mode: "insensitive" as const }, lastName: { equals: d.lastName, mode: "insensitive" as const }, dateOfBirth: d.dateOfBirth }],
      };
      const [openApp, student] = await Promise.all([
        tx.application.findFirst({ where: { schoolId: school.id, status: { in: [...OPEN_STATUSES] }, ...match }, select: { id: true } }),
        tx.student.findFirst({ where: { schoolId: school.id, ...match }, select: { id: true } }),
      ]);
      if (openApp || student) throw conflict(duplicateMessage);

      const applicationNo = await allocateApplicationNo(tx, school.id, today.getUTCFullYear());
      const app = await tx.application.create({
        data: {
          schoolId: school.id,
          applicationNo,
          source: "ONLINE",
          consentAt: new Date(),
          firstName: d.firstName,
          middleName: d.middleName,
          lastName: d.lastName,
          dateOfBirth: d.dateOfBirth,
          gender: d.gender,
          classAppliedId: cls.id,
          intakeYearId: intake?.id,
          nationality: d.nationality,
          previousSchool: d.previousSchool,
          address: d.address,
          guardians: guardians as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.applicationEvent.create({ data: { schoolId: school.id, applicationId: app.id, toStatus: "APPLIED" } });
      await openTask(tx, { schoolId: school.id, kind: "APPLICATION_REVIEW", relatedType: "Application", relatedId: app.id, relatedLabel: `${app.firstName} ${app.lastName} (${applicationNo})`, sourceEvent: "application.received_online" });
      await writeAudit(tx, { schoolId: school.id, actorId: null, actorName: "Online applicant", meta }, {
        action: "admission.create_online",
        entityType: "Application",
        entityId: app.id,
        summary: `${app.firstName} ${app.lastName} (${applicationNo})`,
        changes: { applicationNo, source: "ONLINE" },
      });
      return { applicationNo };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(duplicateMessage);
    throw e;
  }
}

const STATUS_PUBLIC: Record<string, string> = { APPLIED: "APPLIED", INTERVIEW: "INTERVIEW", ACCEPTED: "ACCEPTED", ENROLLED: "ENROLLED", REJECTED: "DECIDED", WITHDRAWN: "WITHDRAWN" };

const trackSchema = z.object({ applicationNo: z.string().trim().min(5).max(30).transform((v) => v.toUpperCase()), phone: phoneField() });

/**
 * Lets a family check where their application stands. Requires the application number AND a guardian phone number
 * on it. Returns only a status (a rejection reason or any personal data is never shown) and fails with one generic
 * message so numbers cannot be probed.
 */
export async function trackApplication(schoolId: string, input: unknown, meta: RequestMeta) {
  const ip = meta.ip ?? "unknown";
  if (!(await consumeRateLimit(`track:ip:${ip}`, 10, WINDOW_HOUR))) throw new AppError("RATE_LIMITED", "Too many attempts. Please try again later.");
  const d = parse(trackSchema, input);
  const notFound = invalid("We could not find an application matching those details. Check the number and the phone number given on the application.");
  if (!(await consumeRateLimit(`track:app:${schoolId}:${d.applicationNo}`, 10, WINDOW_DAY))) throw new AppError("RATE_LIMITED", "Too many attempts for this application. Please contact the school office.");
  const app = await db.application.findUnique({
    where: { schoolId_applicationNo: { schoolId, applicationNo: d.applicationNo } },
    select: {
      id: true, status: true, createdAt: true, guardians: true, classAppliedId: true, reviewStatus: true, reviewNote: true,
      interviews: { where: { status: "SCHEDULED" }, select: { scheduledAt: true, location: true, method: true } },
      offer: { select: { status: true, letterNo: true, feeAmount: true, expiresOn: true, paymentWaivedAt: true } },
      payments: { select: { status: true, amount: true } },
    },
  });
  if (!app) throw notFound;
  const phones = (app.guardians as unknown[]).map((g) => normalizePhone(String((g as { phone?: string }).phone ?? "")));
  if (!phones.includes(d.phone)) throw notFound;
  const [cls, school, settings] = await Promise.all([
    app.classAppliedId ? db.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId }, select: { name: true } }) : null,
    db.school.findUnique({ where: { id: schoolId }, select: { currency: true, timezone: true } }),
    getFeeSettings(db, schoolId),
  ]);
  // Only what the family needs: the stage, the interview appointment, what to correct, the offer and how the admission payment stands.
  // Never interview notes or results, a rejection reason, or anything about other applicants.
  const offer = app.offer?.status === "ISSUED" && app.status === "ACCEPTED" ? app.offer : null;
  const account = offer ? admissionAccount(centsOf(offer.feeAmount), app.payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!offer.paymentWaivedAt) : null;
  return {
    status: STATUS_PUBLIC[app.status] ?? "APPLIED", submittedOn: app.createdAt, className: cls?.name ?? null, currency: school?.currency ?? "TZS", timezone: school?.timezone ?? "Africa/Dar_es_Salaam",
    interview: app.interviews[0] ? { at: app.interviews[0].scheduledAt, location: app.interviews[0].location, method: app.interviews[0].method } : null,
    correction: app.reviewStatus === "RETURNED" ? (app.reviewNote ?? "") : null,
    offer: offer ? { feeCents: centsOf(offer.feeAmount), expiresOn: offer.expiresOn, howToPay: settings.paymentInstructions.trim() || null } : null,
    payment: account ? { status: account.status, verifiedCents: account.verifiedCents, pendingCents: account.pendingCents, requiredCents: account.requiredCents } : null,
  };
}
