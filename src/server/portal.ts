import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { formatDateOnly } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import type { ReportSnapshot } from "@/lib/results/report-types";
import { actorOf, writeAudit } from "@/server/audit";
import { loadStudentFinance } from "@/server/balances";
import { getFeeSettings } from "@/server/fees";
import type { ReceiptSnapshot } from "@/server/payments";
import { getAttendanceSettings } from "@/server/attendance";
import { attendanceRate, emptyCounts } from "@/server/attendance-reports";
import { optEmailField, optPhoneField, parse } from "@/lib/validation";

/*
 * Family portal. Parents (GUARDIAN accounts) see only the children they are explicitly linked to
 * (student_guardians row + guardians.userId); students (STUDENT accounts) see only themselves.
 * Only PUBLISHED report cards, finalised attendance and the public school notices are exposed.
 * Medical notes, other guardians' details, unpublished results and internal notes are never returned.
 * A record outside the viewer's family is reported as NOT_FOUND, never FORBIDDEN, so existence is not revealed.
 */

const portalOnly = (ctx: AuthContext) => {
  if (ctx.userType === "STAFF") throw forbidden("This area is for parents and students.");
};

export async function childIds(ctx: AuthContext): Promise<string[]> {
  portalOnly(ctx);
  if (ctx.userType === "STUDENT") {
    const s = await db.student.findFirst({ where: { userId: ctx.userId, schoolId: ctx.schoolId }, select: { id: true } });
    return s ? [s.id] : [];
  }
  const g = await db.guardian.findFirst({ where: { userId: ctx.userId, schoolId: ctx.schoolId }, select: { id: true } });
  if (!g) return [];
  const links = await db.studentGuardian.findMany({ where: { guardianId: g.id, schoolId: ctx.schoolId }, select: { studentId: true } });
  return links.map((l) => l.studentId);
}

async function currentYear(schoolId: string) {
  const [year, term] = await Promise.all([db.academicYear.findFirst({ where: { schoolId, isCurrent: true } }), db.term.findFirst({ where: { schoolId, isCurrent: true } })]);
  return { year, term };
}

export type Child = { id: string; name: string; admissionNo: string; status: string; className: string | null; streamName: string | null };

export async function myChildren(ctx: AuthContext): Promise<Child[]> {
  const ids = await childIds(ctx);
  if (!ids.length) return [];
  const { year } = await currentYear(ctx.schoolId);
  const rows = await db.student.findMany({
    where: { id: { in: ids }, schoolId: ctx.schoolId },
    select: {
      id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, status: true,
      enrollments: { where: { status: "ACTIVE", ...(year ? { academicYearId: year.id } : {}) }, take: 1, select: { class: { select: { name: true } }, stream: { select: { name: true } } } },
    },
    orderBy: { firstName: "asc" },
  });
  return rows.map((r) => ({
    id: r.id, name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "), admissionNo: r.admissionNo, status: r.status,
    className: r.enrollments[0]?.class.name ?? null, streamName: r.enrollments[0]?.stream?.name ?? null,
  }));
}

export async function childOrThrow(ctx: AuthContext, studentId: string): Promise<Child> {
  const child = (await myChildren(ctx)).find((c) => c.id === studentId);
  if (!child) throw notFound("Student");
  return child;
}

export async function childOverview(ctx: AuthContext, studentId: string) {
  const child = await childOrThrow(ctx, studentId);
  const { year, term } = await currentYear(ctx.schoolId);
  const settings = await getAttendanceSettings(db, ctx.schoolId);
  const from = term?.startsOn ?? year?.startsOn;
  const finalised = { schoolId: ctx.schoolId, studentId, register: { status: "FINALISED" as const } };
  const [grouped, recent, cards] = await Promise.all([
    from ? db.studentAttendance.groupBy({ by: ["status"], where: { ...finalised, date: { gte: from } }, _count: { _all: true } }) : [],
    db.studentAttendance.findMany({ where: finalised, orderBy: { date: "desc" }, take: 14, select: { id: true, date: true, status: true } }),
    db.reportCard.findMany({ where: { schoolId: ctx.schoolId, studentId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } }),
  ]);
  const counts = emptyCounts();
  for (const g of grouped) counts[g.status] = g._count._all;
  const termIds = [...new Set(cards.map((c) => c.termId))];
  const terms = await db.term.findMany({ where: { id: { in: termIds }, schoolId: ctx.schoolId }, include: { academicYear: { select: { name: true } } } });
  return {
    child,
    period: from ? { label: term ? `${term.name} · ${year?.name ?? ""}` : (year?.name ?? ""), from: formatDateOnly(from) } : null,
    attendance: { counts, ratePct: attendanceRate(counts, settings), recorded: counts.PRESENT + counts.ABSENT + counts.LATE + counts.EXCUSED },
    recentAttendance: recent.map((r) => ({ id: r.id, date: formatDateOnly(r.date), status: r.status })),
    reportCards: cards.map((c) => {
      const s = c.snapshot as unknown as ReportSnapshot;
      const t = terms.find((x) => x.id === c.termId);
      return { id: c.id, term: t ? `${t.name} · ${t.academicYear.name}` : s.term.name, className: s.class.name, average: s.summary.average, grade: s.summary.grade, division: s.summary.division, position: s.summary.position, classSize: s.summary.classSize, publishedAt: c.publishedAt };
    }),
  };
}

/**
 * How a child is doing over time, from the PUBLISHED report cards only (nothing that has not been released to the family):
 * the average of each term and the subject results of the latest card, with the change since the term before.
 */
export async function childProgress(ctx: AuthContext, studentId: string) {
  await childOrThrow(ctx, studentId);
  const cards = await db.reportCard.findMany({ where: { schoolId: ctx.schoolId, studentId, status: "PUBLISHED" }, orderBy: { publishedAt: "asc" }, take: 12 });
  const terms = cards.map((c) => {
    const s = c.snapshot as unknown as ReportSnapshot;
    return { id: c.id, term: `${s.term.name} · ${s.term.year}`, average: s.summary.average, grade: s.summary.grade, position: s.summary.position, classSize: s.summary.classSize, subjects: s.subjects.map((x) => ({ id: x.subjectId, name: x.name, percent: x.percent, grade: x.grade, classMean: x.classMean })) };
  });
  const latest = terms.at(-1) ?? null;
  const previous = terms.at(-2) ?? null;
  return {
    trend: terms.map((t) => ({ term: t.term, average: t.average })),
    latest: latest && { term: latest.term, average: latest.average, position: latest.position, classSize: latest.classSize, subjects: latest.subjects.map((x) => ({ ...x, change: previous?.subjects.find((p) => p.id === x.id) ? Math.round((x.percent - previous.subjects.find((p) => p.id === x.id)!.percent) * 10) / 10 : null })) },
    averageChange: latest && previous && latest.average !== null && previous.average !== null ? Math.round((latest.average - previous.average) * 10) / 10 : null,
  };
}

/** A published report card of one of the viewer's children. */
export async function getMyReportCard(ctx: AuthContext, cardId: string) {
  const ids = await childIds(ctx);
  const card = await db.reportCard.findFirst({ where: { id: cardId, schoolId: ctx.schoolId, studentId: { in: ids }, status: "PUBLISHED" } });
  if (!card) throw notFound("Report card");
  return { id: card.id, studentId: card.studentId, publishedAt: card.publishedAt, snapshot: card.snapshot as unknown as ReportSnapshot };
}

export async function recordMyDownload(ctx: AuthContext, cardId: string, name: string) {
  await writeAudit(db, actorOf(ctx), { action: "reportcard.download", entityType: "ReportCard", entityId: cardId, summary: name, changes: { via: "portal" } });
}

// ───────────────────────── Fees (read-only) ─────────────────────────

/** Fee statement for one of the viewer's children: live invoices with balances, payments and receipts. No internal notes. */
export async function childFees(ctx: AuthContext, studentId: string) {
  const child = await childOrThrow(ctx, studentId);
  const [fin, invoices, payments, settings, school] = await Promise.all([
    loadStudentFinance(db, ctx.schoolId, studentId),
    db.invoice.findMany({ where: { schoolId: ctx.schoolId, studentId, status: "ISSUED" }, orderBy: [{ issueDate: "desc" }, { number: "desc" }] }),
    db.payment.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }], include: { receipt: { select: { number: true } } } }),
    getFeeSettings(db, ctx.schoolId),
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { currency: true } }),
  ]);
  const terms = await db.term.findMany({ where: { schoolId: ctx.schoolId, id: { in: invoices.map((i) => i.termId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const tn = new Map(terms.map((t) => [t.id, t.name]));
  const l = fin.ledger;
  return {
    child, currency: school.currency, paymentInstructions: settings.paymentInstructions,
    summary: { billed: l.billed, paid: l.applied, outstanding: l.outstanding, overdue: l.overdue, credit: l.credit },
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, termName: i.termId ? (tn.get(i.termId) ?? null) : null, issueDate: formatDateOnly(i.issueDate), dueDate: formatDateOnly(i.dueDate), balance: l.invoices.get(i.id)! })),
    payments: payments.map((p) => ({ id: p.id, receivedOn: formatDateOnly(p.receivedOn), amountCents: centsOf(p.amount), method: p.method, reference: p.reference, status: p.status, receiptNumber: p.status === "POSTED" ? (p.receipt?.number ?? null) : null })),
  };
}

export async function getMyInvoiceId(ctx: AuthContext, invoiceId: string): Promise<{ id: string; studentId: string }> {
  const ids = await childIds(ctx);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, schoolId: ctx.schoolId, studentId: { in: ids }, status: "ISSUED" }, select: { id: true, studentId: true } });
  if (!inv) throw notFound("Invoice");
  return inv;
}

export async function getMyReceipt(ctx: AuthContext, paymentId: string) {
  const ids = await childIds(ctx);
  const p = await db.payment.findFirst({ where: { id: paymentId, schoolId: ctx.schoolId, studentId: { in: ids }, status: "POSTED" }, include: { receipt: true } });
  if (!p?.receipt) throw notFound("Receipt");
  return { paymentId: p.id, studentId: p.studentId, snapshot: p.receipt.snapshot as unknown as ReceiptSnapshot };
}

// ───────────────────────── Account administration (staff, portal.manage) ─────────────────────────

const accountSchema = z.object({ email: optEmailField(), phone: optPhoneField() });

function mapUnique(e: unknown): unknown {
  const err = e as { code?: string; meta?: { target?: unknown }; message?: string };
  if (err?.code === "P2002") {
    const target = JSON.stringify(err.meta?.target ?? err.message ?? "");
    if (target.includes("email")) return invalid("Please correct the highlighted fields.", { email: "This email is already used by another account" });
    if (target.includes("phone")) return invalid("Please correct the highlighted fields.", { phone: "This phone number is already used by another account" });
  }
  return e;
}

/** Creates the parent sign-in for a guardian who is linked to at least one student. Returns a one-time temporary password. */
export async function createGuardianAccount(ctx: AuthContext, guardianId: string, input: unknown = {}) {
  requirePermission(ctx, "portal.manage");
  const d = parse(accountSchema, input);
  const g = await db.guardian.findFirst({ where: { id: guardianId, schoolId: ctx.schoolId }, include: { students: { select: { studentId: true } } } });
  if (!g) throw notFound("Guardian");
  if (g.userId) throw conflict("This guardian already has a portal account.");
  if (!g.students.length) throw conflict("Link the guardian to a student before creating a portal account.");
  const role = await db.role.findFirst({ where: { schoolId: ctx.schoolId, key: "parent" } });
  if (!role) throw conflict("The Parent role is missing. Run the bootstrap to restore default roles.");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          schoolId: ctx.schoolId, type: "GUARDIAN", fullName: g.fullName, email: d.email ?? g.email?.toLowerCase() ?? null, phone: d.phone ?? g.phone, passwordHash, mustChangePassword: true,
          roles: { create: [{ roleId: role.id, assignedById: ctx.userId }] },
        },
      });
      await tx.guardian.update({ where: { id: g.id }, data: { userId: user.id } });
      await writeAudit(tx, actorOf(ctx), { action: "portal.guardian_account_create", entityType: "Guardian", entityId: g.id, summary: g.fullName, changes: { userId: user.id, children: g.students.length } });
    });
  } catch (e) {
    throw mapUnique(e);
  }
  return { temporaryPassword };
}

/** Creates a student's own sign-in. A phone number or email is required because students sign in with one of them. */
export async function createStudentAccount(ctx: AuthContext, studentId: string, input: unknown) {
  requirePermission(ctx, "portal.manage");
  const d = parse(accountSchema.refine((v) => v.email || v.phone, { path: ["email"], message: "Enter the student's own email address or phone number" }), input);
  const s = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId } });
  if (!s) throw notFound("Student");
  if (s.userId) throw conflict("This student already has a portal account.");
  if (s.status !== "ENROLLED") throw conflict("Only enrolled students can be given a portal account.");
  const role = await db.role.findFirst({ where: { schoolId: ctx.schoolId, key: "student" } });
  if (!role) throw conflict("The Student role is missing. Run the bootstrap to restore default roles.");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const fullName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { schoolId: ctx.schoolId, type: "STUDENT", fullName, email: d.email ?? null, phone: d.phone ?? null, passwordHash, mustChangePassword: true, roles: { create: [{ roleId: role.id, assignedById: ctx.userId }] } },
      });
      await tx.student.update({ where: { id: s.id }, data: { userId: user.id } });
      await writeAudit(tx, actorOf(ctx), { action: "portal.student_account_create", entityType: "Student", entityId: s.id, summary: fullName, changes: { userId: user.id } });
    });
  } catch (e) {
    throw mapUnique(e);
  }
  return { temporaryPassword };
}

async function portalUser(ctx: AuthContext, userId: string) {
  const user = await db.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId, type: { in: ["GUARDIAN", "STUDENT"] } } });
  if (!user) throw notFound("Account");
  return user;
}

export async function resetPortalPassword(ctx: AuthContext, userId: string) {
  requirePermission(ctx, "portal.manage");
  const user = await portalUser(ctx, userId);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, actorOf(ctx), { action: "portal.reset_password", entityType: "User", entityId: userId, summary: user.fullName });
  });
  return { temporaryPassword };
}

export async function setPortalAccountActive(ctx: AuthContext, userId: string, active: boolean) {
  requirePermission(ctx, "portal.manage");
  const user = await portalUser(ctx, userId);
  const status = active ? "ACTIVE" : "SUSPENDED";
  if (user.status === status) return;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, actorOf(ctx), { action: active ? "portal.reactivate" : "portal.suspend", entityType: "User", entityId: userId, summary: user.fullName });
  });
}

/** Account state for guardians on the guardian directory. */
export async function guardianAccountStates(ctx: AuthContext, guardianIds: string[]) {
  requirePermission(ctx, "portal.manage");
  const rows = await db.guardian.findMany({ where: { id: { in: guardianIds }, schoolId: ctx.schoolId }, select: { id: true, user: { select: { id: true, status: true, lastLoginAt: true, mustChangePassword: true } } } });
  return new Map(rows.map((r) => [r.id, r.user]));
}

export async function studentAccountState(ctx: AuthContext, studentId: string) {
  requirePermission(ctx, "portal.manage");
  const s = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { user: { select: { id: true, status: true, lastLoginAt: true, mustChangePassword: true } } } });
  if (!s) throw notFound("Student");
  return s.user;
}
