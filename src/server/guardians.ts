import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { checkbox, optEmailField, optPhoneField, optText, optUuid, parse, phoneField, text } from "@/lib/validation";

export const RELATIONSHIPS = ["FATHER", "MOTHER", "GRANDPARENT", "UNCLE", "AUNT", "SIBLING", "GUARDIAN", "OTHER"] as const;

export const guardianDetailsSchema = z.object({
  fullName: text(120),
  phone: phoneField(),
  altPhone: optPhoneField(),
  email: optEmailField(),
  occupation: optText(100),
  address: optText(300),
});

/** A guardian entry when linking: either an existing guardian (by id) or the details of a new one. */
export const guardianLinkSchema = z
  .object({
    guardianId: optUuid(),
    fullName: optText(120),
    phone: optPhoneField(),
    altPhone: optPhoneField(),
    email: optEmailField(),
    occupation: optText(100),
    address: optText(300),
    relationship: z.enum(RELATIONSHIPS),
    isPrimary: checkbox().default(false),
    isFinanciallyResponsible: checkbox().default(false),
    receivesNotifications: z.preprocess((v) => v === undefined || v === "on" || v === "true" || v === true, z.boolean()),
    /** Staff confirmed that a different person genuinely shares this phone number. */
    allowSharedPhone: checkbox().default(false),
  })
  .superRefine((v, c) => {
    if (v.guardianId) return;
    if (!v.fullName) c.addIssue({ code: "custom", path: ["fullName"], message: "Required" });
    if (!v.phone) c.addIssue({ code: "custom", path: ["phone"], message: "Required" });
  });

export type GuardianLinkInput = z.infer<typeof guardianLinkSchema>;

/** Finds or creates the guardian row for a link entry. Never matches an existing guardian implicitly. */
export async function resolveGuardian(tx: Tx, ctx: AuthContext, g: GuardianLinkInput): Promise<string> {
  if (g.guardianId) {
    const existing = await tx.guardian.findFirst({ where: { id: g.guardianId, schoolId: ctx.schoolId }, select: { id: true } });
    if (!existing) throw notFound("Guardian");
    return existing.id;
  }
  const phone = g.phone as string;
  if (!g.allowSharedPhone) {
    const same = await tx.guardian.findFirst({ where: { schoolId: ctx.schoolId, OR: [{ phone }, { altPhone: phone }] }, select: { fullName: true } });
    if (same) {
      throw conflict(`A guardian with this phone number already exists (${same.fullName}). Select that guardian, or confirm this is a different person.`);
    }
  }
  const created = await tx.guardian.create({
    data: { schoolId: ctx.schoolId, fullName: g.fullName as string, phone, altPhone: g.altPhone, email: g.email, occupation: g.occupation, address: g.address },
  });
  await writeAudit(tx, actorOf(ctx), { action: "guardian.create", entityType: "Guardian", entityId: created.id, summary: created.fullName });
  return created.id;
}

export async function searchGuardians(ctx: AuthContext, q: string) {
  if (!ctx.permissions.has("guardian.manage") && !ctx.permissions.has("guardian.read")) throw forbidden();
  const query = q.trim();
  if (query.length < 2) return [];
  return db.guardian.findMany({
    where: { schoolId: ctx.schoolId, OR: [{ fullName: { contains: query, mode: "insensitive" } }, { phone: { contains: query.replace(/[^\d+]/g, "") || "no-match" } }] },
    orderBy: { fullName: "asc" },
    take: 8,
    select: { id: true, fullName: true, phone: true, _count: { select: { students: true } } },
  });
}

export async function listGuardians(ctx: AuthContext, opts: { q?: string; page?: number } = {}) {
  requirePermission(ctx, "guardian.read");
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();
  const digits = q?.replace(/[^\d]/g, "");
  const where = {
    schoolId: ctx.schoolId,
    ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" as const } }, ...(digits ? [{ phone: { contains: digits } }] : [])] } : {}),
  };
  const [items, total] = await Promise.all([
    db.guardian.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { students: { include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } } } },
    }),
    db.guardian.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function updateGuardian(ctx: AuthContext, guardianId: string, input: unknown) {
  requirePermission(ctx, "guardian.manage");
  const data = parse(guardianDetailsSchema, input);
  const guardian = await db.guardian.findFirst({ where: { id: guardianId, schoolId: ctx.schoolId } });
  if (!guardian) throw notFound("Guardian");
  await db.$transaction(async (tx) => {
    await tx.guardian.update({
      where: { id: guardianId },
      data: { ...data, altPhone: data.altPhone ?? null, email: data.email ?? null, occupation: data.occupation ?? null, address: data.address ?? null },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: "guardian.update",
      entityType: "Guardian",
      entityId: guardianId,
      summary: data.fullName,
      changes: diffFields(guardian, { ...data, altPhone: data.altPhone ?? null, email: data.email ?? null }, ["fullName", "phone", "altPhone", "email", "occupation", "address"]),
    });
  });
}

async function assertStudentInSchool(tx: Tx, schoolId: string, studentId: string) {
  const s = await tx.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true, firstName: true, lastName: true } });
  if (!s) throw notFound("Student");
  return s;
}

export async function linkGuardian(ctx: AuthContext, studentId: string, input: unknown) {
  requirePermission(ctx, "guardian.manage");
  const g = parse(guardianLinkSchema, input);
  await db.$transaction(async (tx) => {
    await assertStudentInSchool(tx, ctx.schoolId, studentId);
    const guardianId = await resolveGuardian(tx, ctx, g);
    if (await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } } })) {
      throw conflict("This guardian is already linked to the student.");
    }
    const hasPrimary = (await tx.studentGuardian.count({ where: { studentId, isPrimary: true } })) > 0;
    const makePrimary = g.isPrimary || !hasPrimary;
    if (makePrimary) await tx.studentGuardian.updateMany({ where: { studentId, isPrimary: true }, data: { isPrimary: false } });
    await tx.studentGuardian.create({
      data: {
        studentId,
        guardianId,
        schoolId: ctx.schoolId,
        relationship: g.relationship,
        isPrimary: makePrimary,
        isFinanciallyResponsible: g.isFinanciallyResponsible,
        receivesNotifications: g.receivesNotifications,
      },
    });
    await writeAudit(tx, actorOf(ctx), { action: "guardian.link", entityType: "Student", entityId: studentId, changes: { guardianId, relationship: g.relationship } });
  });
}

const relationshipSchema = z.object({
  relationship: z.enum(RELATIONSHIPS),
  isPrimary: checkbox(),
  isFinanciallyResponsible: checkbox(),
  receivesNotifications: checkbox(),
});

export async function updateRelationship(ctx: AuthContext, studentId: string, guardianId: string, input: unknown) {
  requirePermission(ctx, "guardian.manage");
  const d = parse(relationshipSchema, input);
  await db.$transaction(async (tx) => {
    const link = await tx.studentGuardian.findFirst({ where: { studentId, guardianId, schoolId: ctx.schoolId } });
    if (!link) throw notFound("Guardian link");
    if (link.isPrimary && !d.isPrimary) throw invalid("A student must have a primary guardian. Make another guardian primary instead.");
    if (d.isPrimary && !link.isPrimary) await tx.studentGuardian.updateMany({ where: { studentId, isPrimary: true }, data: { isPrimary: false } });
    // Changing the relationship invalidates earlier verification.
    const relationshipChanged = link.relationship !== d.relationship;
    await tx.studentGuardian.update({
      where: { studentId_guardianId: { studentId, guardianId } },
      data: { ...d, ...(relationshipChanged ? { verifiedAt: null, verifiedById: null } : {}) },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: "guardian.relationship_update",
      entityType: "Student",
      entityId: studentId,
      changes: { guardianId, ...diffFields(link, d, ["relationship", "isPrimary", "isFinanciallyResponsible", "receivesNotifications"]) },
    });
  });
}

export async function unlinkGuardian(ctx: AuthContext, studentId: string, guardianId: string, reason: string) {
  requirePermission(ctx, "guardian.manage");
  const cleanReason = parse(text(300), reason);
  await db.$transaction(async (tx) => {
    const links = await tx.studentGuardian.findMany({ where: { studentId, schoolId: ctx.schoolId } });
    const link = links.find((l) => l.guardianId === guardianId);
    if (!link) throw notFound("Guardian link");
    if (links.length === 1) throw conflict("A student must keep at least one guardian. Add the new guardian before removing this one.");
    if (link.isPrimary) throw conflict("Make another guardian the primary guardian before removing this one.");
    await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId, guardianId } } });
    await writeAudit(tx, actorOf(ctx), { action: "guardian.unlink", entityType: "Student", entityId: studentId, changes: { guardianId }, reason: cleanReason });
  });
}

export async function setRelationshipVerified(ctx: AuthContext, studentId: string, guardianId: string, verified: boolean) {
  requirePermission(ctx, "guardian.verify");
  await db.$transaction(async (tx) => {
    const link = await tx.studentGuardian.findFirst({ where: { studentId, guardianId, schoolId: ctx.schoolId } });
    if (!link) throw notFound("Guardian link");
    await tx.studentGuardian.update({
      where: { studentId_guardianId: { studentId, guardianId } },
      data: verified ? { verifiedAt: new Date(), verifiedById: ctx.userId } : { verifiedAt: null, verifiedById: null },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: verified ? "guardian.verify" : "guardian.unverify",
      entityType: "Student",
      entityId: studentId,
      changes: { guardianId },
    });
  });
}


/** The parents in numbers: how many, how many have a portal account and in what state, how many have never signed in. School-wide, for people who may read guardians. */
export async function guardianOverview(ctx: AuthContext) {
  requirePermission(ctx, "guardian.read");
  const base = { schoolId: ctx.schoolId };
  const [total, noChild, active, suspended, neverSignedIn] = await Promise.all([
    db.guardian.count({ where: base }),
    db.guardian.count({ where: { ...base, students: { none: {} } } }),
    db.guardian.count({ where: { ...base, user: { is: { status: "ACTIVE" } } } }),
    db.guardian.count({ where: { ...base, user: { is: { status: { not: "ACTIVE" } } } } }),
    db.guardian.count({ where: { ...base, user: { is: { lastLoginAt: null } } } }),
  ]);
  return { total, noChild, active, suspended, noAccount: Math.max(0, total - active - suspended), neverSignedIn };
}

/* ───────────────────────── One guardian's page ───────────────────────── */

const DAY_MS = 86_400_000;

export type GuardianProfile = Awaited<ReturnType<typeof guardianProfile>>;

/**
 * Everything the office needs when a parent calls ("I forgot my password", "I cannot see my child"): who they are, their children and the
 * classes they are in, what they owe (only for people who may read fees), and, for people who manage portal accounts, the account itself:
 * how they sign in, when they last did, failed attempts, what they did in the portal, what the school sent them. Read-only: the actions
 * (create an account, reset a password, suspend) stay in `portal.ts`.
 */
export async function guardianProfile(ctx: AuthContext, id: string) {
  requirePermission(ctx, "guardian.read");
  const has = (p: string) => ctx.permissions.has(p as never);
  const g = await db.guardian.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      students: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: { student: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, status: true, enrollments: { where: { status: "ACTIVE" }, take: 1, select: { class: { select: { name: true } }, stream: { select: { name: true } } } } } } },
      },
      user: { select: { id: true, status: true, email: true, phone: true, lastLoginAt: true, createdAt: true, passwordChangedAt: true } },
    },
  });
  if (!g) throw notFound("Guardian");

  const canFees = has("fees.read");
  const children = await Promise.all(g.students.map(async (l) => {
    const e = l.student.enrollments[0];
    const owed = canFees ? await import("@/server/balances").then((m) => m.loadStudentFinance(db, ctx.schoolId, l.studentId)).then((f) => f.ledger.outstanding).catch(() => null) : null;
    return {
      studentId: l.studentId, name: [l.student.firstName, l.student.middleName, l.student.lastName].filter(Boolean).join(" "), admissionNo: l.student.admissionNo, status: l.student.status,
      className: e ? `${e.class.name}${e.stream ? ` · ${e.stream.name}` : ""}` : null, relationship: l.relationship, primary: l.isPrimary, notifies: l.receivesNotifications,
      financiallyResponsible: l.isFinanciallyResponsible, verified: l.verifiedAt !== null, owedCents: owed,
    };
  }));

  // The portal account: only for people who manage accounts (it shows sign-in details and what the person did).
  let account: null | {
    id: string; status: string; loginIds: string[]; createdAt: Date; lastLoginAt: Date | null; passwordChangedAt: Date | null;
    signIns30: number; failed30: number; lastFailedAt: Date | null; recentAttempts: { at: Date; ok: boolean; ip: string | null }[];
    activity: { id: string; at: Date; action: string; summary: string | null; actor: string | null; byAccount: boolean }[];
    notices: { total90: number; byStatus: Record<string, number>; recent: { id: string; type: string; status: string; at: Date }[] };
  } = null;
  if (has("portal.manage") && g.user) {
    const u = g.user;
    const since30 = new Date(Date.now() - 30 * DAY_MS), since90 = new Date(Date.now() - 90 * DAY_MS);
    const ids = [u.email, u.phone, u.phone?.replace(/^\+/, "")].filter((x): x is string => !!x);
    const [attempts, activity, events] = await Promise.all([
      db.loginAttempt.findMany({ where: { identifier: { in: ids }, createdAt: { gte: since30 } }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.auditLog.findMany({ where: { schoolId: ctx.schoolId, OR: [{ actorId: u.id }, { entityType: "User", entityId: u.id }] }, orderBy: { createdAt: "desc" }, take: 14 }),
      db.notificationEvent.findMany({ where: { schoolId: ctx.schoolId, guardianId: g.id, createdAt: { gte: since90 } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, type: true, status: true, createdAt: true } }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const e of events) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    account = {
      id: u.id, status: u.status, loginIds: [u.email, u.phone].filter((x): x is string => !!x), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, passwordChangedAt: u.passwordChangedAt,
      signIns30: attempts.filter((a) => a.success).length, failed30: attempts.filter((a) => !a.success).length, lastFailedAt: attempts.find((a) => !a.success)?.createdAt ?? null,
      recentAttempts: attempts.slice(0, 8).map((a) => ({ at: a.createdAt, ok: a.success, ip: a.ip })),
      activity: activity.map((a) => ({ id: a.id, at: a.createdAt, action: a.action, summary: a.summary, actor: a.actorName, byAccount: a.actorId === u.id })),
      notices: { total90: events.length, byStatus, recent: events.slice(0, 6).map((e) => ({ id: e.id, type: e.type, status: e.status, at: e.createdAt })) },
    };
  }
  return {
    guardian: { id: g.id, fullName: g.fullName, phone: g.phone, altPhone: g.altPhone, email: g.email, occupation: g.occupation, address: g.address, createdAt: g.createdAt },
    children, account, hasAccount: g.user !== null, canFees,
  };
}
