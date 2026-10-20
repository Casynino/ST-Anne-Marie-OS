import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { actorOf, writeAudit } from "@/server/audit";
import { teachingScope } from "@/server/academics";
import { parse, text, uuid } from "@/lib/validation";

/*
 * Parent-teacher messaging. A conversation is about one student, between one parent (a portal account linked to that
 * student) and one teacher, or the school office when the student has no class teacher. Messages are never edited or
 * deleted (DB trigger); a moderator can hide one with a reason. Parents can only write about their own children,
 * teachers only to parents of students they teach. Management with messages.moderate can read everything.
 */

const bodySchema = z.object({ body: z.string().trim().min(1, "Write a message").max(2000, "Maximum 2000 characters") });
const startSchema = bodySchema.extend({ studentId: uuid(), subject: text(120) });
const SEND_LIMIT = { max: 30, windowMs: 3_600_000 };

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

async function throttle(userId: string) {
  if (!(await consumeRateLimit(`msg:${userId}`, SEND_LIMIT.max, SEND_LIMIT.windowMs))) throw new AppError("RATE_LIMITED", "You are sending messages too quickly. Please wait a little and try again.");
}

async function notifyUser(tx: Tx | Db, schoolId: string, userId: string, title: string, body: string, link: string) {
  await tx.inAppNotification.create({ data: { schoolId, userId, title, body: body.slice(0, 160), link } });
}

// ───────────────────────── Shared lookups ─────────────────────────

async function currentYearId(client: Db | Tx, schoolId: string) {
  return (await client.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } }))?.id ?? null;
}

/** The class teacher's user account for a student's current class and stream (stream-specific first), or null. */
export async function classTeacherUser(client: Db | Tx, schoolId: string, studentId: string): Promise<string | null> {
  const yearId = await currentYearId(client, schoolId);
  if (!yearId) return null;
  const en = await client.studentEnrollment.findFirst({ where: { schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true, streamId: true } });
  if (!en) return null;
  const rows = await client.classTeacher.findMany({ where: { schoolId, academicYearId: yearId, classId: en.classId, OR: [{ streamId: en.streamId }, { streamId: null }] }, include: { staff: { select: { userId: true, user: { select: { status: true } } } } } });
  const pick = rows.filter((r) => r.staff.user.status === "ACTIVE").sort((a, b) => (a.streamId ? 0 : 1) - (b.streamId ? 0 : 1))[0];
  return pick?.staff.userId ?? null;
}

async function guardianOf(ctx: AuthContext) {
  if (ctx.userType !== "GUARDIAN") throw forbidden("Messaging with teachers is for parents and guardians.");
  const g = await db.guardian.findFirst({ where: { userId: ctx.userId, schoolId: ctx.schoolId }, select: { id: true, fullName: true } });
  if (!g) throw forbidden();
  return g;
}

async function linkedChildren(guardianId: string, schoolId: string) {
  return (await db.studentGuardian.findMany({ where: { guardianId, schoolId }, select: { studentId: true } })).map((l) => l.studentId);
}

const nameOf = (s: { firstName: string; middleName: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");

export type MessageView = { id: string; senderName: string; mine: boolean; fromParent: boolean; body: string | null; hidden: boolean; hiddenReason: string | null; flagged: boolean; createdAt: Date };
export type ThreadSummary = { id: string; subject: string; studentName: string; status: "OPEN" | "CLOSED"; lastMessageAt: Date; unread: boolean; withName: string; office: boolean; flagged: boolean };

async function summaries(rows: { id: string; schoolId: string; studentId: string; guardianUserId: string; staffUserId: string | null; subject: string; status: "OPEN" | "CLOSED"; lastMessageAt: Date; guardianReadAt: Date | null; staffReadAt: Date | null }[], viewer: "GUARDIAN" | "STAFF", schoolId: string, viewerUserId: string): Promise<ThreadSummary[]> {
  const [students, users, flagged] = await Promise.all([
    db.student.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, middleName: true, lastName: true } }),
    db.user.findMany({ where: { schoolId, id: { in: [...new Set(rows.flatMap((r) => [r.guardianUserId, r.staffUserId].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } }),
    db.threadMessage.groupBy({ by: ["threadId"], where: { threadId: { in: rows.map((r) => r.id) }, flaggedAt: { not: null }, visibility: "VISIBLE" }, _count: { _all: true } }),
  ]);
  const su = new Map(students.map((s) => [s.id, nameOf(s)]));
  const uu = new Map(users.map((u) => [u.id, u.fullName]));
  const fl = new Set(flagged.map((f) => f.threadId));
  return rows.map((r) => {
    const mineStaff = r.staffUserId === viewerUserId;
    const readAt = viewer === "GUARDIAN" ? r.guardianReadAt : mineStaff ? r.staffReadAt : null;
    return {
      id: r.id, subject: r.subject, studentName: su.get(r.studentId) ?? "—", status: r.status, lastMessageAt: r.lastMessageAt,
      unread: viewer === "GUARDIAN" || mineStaff ? !readAt || readAt < r.lastMessageAt : false,
      withName: viewer === "GUARDIAN" ? (r.staffUserId ? (uu.get(r.staffUserId) ?? "—") : "School office") : (uu.get(r.guardianUserId) ?? "—"),
      office: r.staffUserId === null, flagged: fl.has(r.id),
    };
  });
}

async function messagesOf(threadId: string, schoolId: string, viewerUserId: string, moderator: boolean): Promise<MessageView[]> {
  const rows = await db.threadMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.senderUserId))] } }, select: { id: true, fullName: true, type: true } });
  const uu = new Map(users.map((u) => [u.id, u]));
  return rows.map((m) => ({
    id: m.id, senderName: uu.get(m.senderUserId)?.fullName ?? "—", mine: m.senderUserId === viewerUserId, fromParent: uu.get(m.senderUserId)?.type === "GUARDIAN",
    body: m.visibility === "HIDDEN" && !moderator ? null : m.body, hidden: m.visibility === "HIDDEN", hiddenReason: moderator ? m.hiddenReason : null, flagged: m.flaggedAt !== null && m.visibility === "VISIBLE", createdAt: m.createdAt,
  }));
}

// ───────────────────────── Parent side ─────────────────────────

export async function listMyThreads(ctx: AuthContext): Promise<ThreadSummary[]> {
  await guardianOf(ctx);
  const rows = await db.messageThread.findMany({ where: { schoolId: ctx.schoolId, guardianUserId: ctx.userId }, orderBy: { lastMessageAt: "desc" }, take: 100 });
  return summaries(rows, "GUARDIAN", ctx.schoolId, ctx.userId);
}

export async function getMyThread(ctx: AuthContext, id: string) {
  await guardianOf(ctx);
  const t = await db.messageThread.findFirst({ where: { id, schoolId: ctx.schoolId, guardianUserId: ctx.userId } });
  if (!t) throw notFound("Conversation");
  await db.messageThread.update({ where: { id }, data: { guardianReadAt: new Date() } });
  const [s] = await summaries([t], "GUARDIAN", ctx.schoolId, ctx.userId);
  return { thread: { ...s!, unread: false }, messages: await messagesOf(id, ctx.schoolId, ctx.userId, false) };
}

/** A parent starts a conversation about one of their own children; it goes to the class teacher, or the office if there is none. */
export async function startThread(ctx: AuthContext, input: unknown) {
  const g = await guardianOf(ctx);
  const d = parse(startSchema, input);
  if (!(await linkedChildren(g.id, ctx.schoolId)).includes(d.studentId)) throw notFound("Student");
  await throttle(ctx.userId);
  return db.$transaction(async (tx) => {
    const staffUserId = await classTeacherUser(tx, ctx.schoolId, d.studentId);
    const now = new Date();
    const thread = await tx.messageThread.create({ data: { schoolId: ctx.schoolId, studentId: d.studentId, guardianUserId: ctx.userId, staffUserId, subject: clean(d.subject), guardianReadAt: now, lastMessageAt: now } });
    await tx.threadMessage.create({ data: { threadId: thread.id, senderUserId: ctx.userId, body: clean(d.body) } });
    if (staffUserId) await notifyUser(tx, ctx.schoolId, staffUserId, `${g.fullName}: ${d.subject}`.slice(0, 120), d.body, `/communication/messages/${thread.id}`);
    await writeAudit(tx, actorOf(ctx), { action: "thread.start", entityType: "MessageThread", entityId: thread.id, summary: d.subject, changes: { studentId: d.studentId, toOffice: !staffUserId } });
    return thread;
  });
}

export async function replyAsGuardian(ctx: AuthContext, id: string, input: unknown) {
  const g = await guardianOf(ctx);
  const d = parse(bodySchema, input);
  const t = await db.messageThread.findFirst({ where: { id, schoolId: ctx.schoolId, guardianUserId: ctx.userId } });
  if (!t) throw notFound("Conversation");
  if (t.status === "CLOSED") throw conflict("This conversation was closed by the school. Start a new one if you need to write again.");
  await throttle(ctx.userId);
  await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.threadMessage.create({ data: { threadId: id, senderUserId: ctx.userId, body: clean(d.body) } });
    await tx.messageThread.update({ where: { id }, data: { lastMessageAt: now, guardianReadAt: now } });
    if (t.staffUserId) await notifyUser(tx, ctx.schoolId, t.staffUserId, `${g.fullName}: ${t.subject}`.slice(0, 120), d.body, `/communication/messages/${id}`);
  });
}

export async function countMyUnreadThreads(ctx: AuthContext): Promise<number> {
  if (ctx.userType !== "GUARDIAN") return 0;
  const rows = await db.messageThread.findMany({ where: { schoolId: ctx.schoolId, guardianUserId: ctx.userId }, select: { lastMessageAt: true, guardianReadAt: true } });
  return rows.filter((r) => !r.guardianReadAt || r.guardianReadAt < r.lastMessageAt).length;
}

// ───────────────────────── Staff side ─────────────────────────

function staffOnly(ctx: AuthContext) {
  if (ctx.userType !== "STAFF") throw forbidden();
}
const isModerator = (ctx: AuthContext) => ctx.permissions.has("messages.moderate");

export async function listStaffThreads(ctx: AuthContext, filter: { box?: "mine" | "office" | "all" | "flagged"; status?: "OPEN" | "CLOSED" } = {}): Promise<ThreadSummary[]> {
  staffOnly(ctx);
  requireAnyPermission(ctx, ["messages.read", "messages.moderate"]);
  const box = filter.box ?? "mine";
  if (box !== "mine" && !isModerator(ctx)) throw forbidden();
  const where = {
    schoolId: ctx.schoolId, ...(filter.status ? { status: filter.status } : {}),
    ...(box === "mine" ? { staffUserId: ctx.userId } : box === "office" ? { staffUserId: null } : {}),
    ...(box === "flagged" ? { messages: { some: { flaggedAt: { not: null }, visibility: "VISIBLE" as const } } } : {}),
  };
  const rows = await db.messageThread.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 100 });
  return summaries(rows, "STAFF", ctx.schoolId, ctx.userId);
}

async function loadStaffThread(ctx: AuthContext, id: string) {
  staffOnly(ctx);
  requireAnyPermission(ctx, ["messages.read", "messages.moderate"]);
  const t = await db.messageThread.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!t) throw notFound("Conversation");
  const participant = t.staffUserId === ctx.userId;
  if (!participant && !isModerator(ctx)) throw notFound("Conversation"); // not yours: do not reveal it exists
  return { t, participant };
}

export async function getStaffThread(ctx: AuthContext, id: string) {
  const { t, participant } = await loadStaffThread(ctx, id);
  if (participant) await db.messageThread.update({ where: { id }, data: { staffReadAt: new Date() } });
  const [s] = await summaries([t], "STAFF", ctx.schoolId, ctx.userId);
  const [guardian, assignable] = await Promise.all([
    db.user.findUnique({ where: { id: t.guardianUserId }, select: { fullName: true } }),
    isModerator(ctx) ? db.user.findMany({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE", roles: { some: { role: { permissions: { some: { permission: { key: "messages.send" } } } } } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : [],
  ]);
  return { thread: { ...s!, unread: false }, guardianName: guardian?.fullName ?? "—", messages: await messagesOf(id, ctx.schoolId, ctx.userId, isModerator(ctx)), canReply: t.status === "OPEN" && (participant || (isModerator(ctx) && t.staffUserId === null)) && ctx.permissions.has("messages.send"), canModerate: isModerator(ctx), participant, assignable };
}

export async function replyAsStaff(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "messages.send");
  const d = parse(bodySchema, input);
  const { t, participant } = await loadStaffThread(ctx, id);
  if (!participant && !(isModerator(ctx) && t.staffUserId === null)) throw forbidden("This conversation belongs to another teacher.");
  if (t.status === "CLOSED") throw conflict("This conversation is closed.");
  await throttle(ctx.userId);
  await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.threadMessage.create({ data: { threadId: id, senderUserId: ctx.userId, body: clean(d.body) } });
    await tx.messageThread.update({ where: { id }, data: { lastMessageAt: now, staffReadAt: now, ...(t.staffUserId === null ? { staffUserId: ctx.userId } : {}) } }); // answering an office message takes it
    await notifyUser(tx, ctx.schoolId, t.guardianUserId, `${ctx.fullName}: ${t.subject}`.slice(0, 120), d.body, `/family/messages/${id}`);
  });
}

const staffStartSchema = startSchema.extend({ guardianId: uuid() });

/** A teacher writes to a parent of a student they teach (or any parent, for moderators). The parent needs a portal account. */
export async function startThreadAsStaff(ctx: AuthContext, input: unknown) {
  staffOnly(ctx);
  requirePermission(ctx, "messages.send");
  const d = parse(staffStartSchema, input);
  const link = await db.studentGuardian.findFirst({ where: { schoolId: ctx.schoolId, studentId: d.studentId, guardianId: d.guardianId }, include: { guardian: { select: { userId: true, fullName: true, user: { select: { status: true } } } } } });
  if (!link) throw notFound("Student");
  if (!isModerator(ctx)) {
    const yearId = await currentYearId(db, ctx.schoolId);
    const en = yearId ? await db.studentEnrollment.findFirst({ where: { schoolId: ctx.schoolId, studentId: d.studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true, streamId: true } }) : null;
    const scope = ctx.staffId && yearId ? await teachingScope(ctx.staffId, yearId) : [];
    if (!en || !scope.some((s) => s.classId === en.classId && (s.streamId === null || s.streamId === en.streamId))) throw forbidden("You can write to parents of students you teach.");
  }
  const userId = link.guardian.userId;
  if (!userId || link.guardian.user?.status !== "ACTIVE") throw conflict("This parent does not have an active portal account yet, so they cannot receive messages here. Ask the office to create one, or use an SMS.");
  await throttle(ctx.userId);
  return db.$transaction(async (tx) => {
    const now = new Date();
    const thread = await tx.messageThread.create({ data: { schoolId: ctx.schoolId, studentId: d.studentId, guardianUserId: userId, staffUserId: ctx.userId, subject: clean(d.subject), staffReadAt: now, lastMessageAt: now } });
    await tx.threadMessage.create({ data: { threadId: thread.id, senderUserId: ctx.userId, body: clean(d.body) } });
    await notifyUser(tx, ctx.schoolId, userId, `${ctx.fullName}: ${d.subject}`.slice(0, 120), d.body, `/family/messages/${thread.id}`);
    await writeAudit(tx, actorOf(ctx), { action: "thread.start", entityType: "MessageThread", entityId: thread.id, summary: d.subject, changes: { studentId: d.studentId, byStaff: true } });
    return thread;
  });
}

// ───────────────────────── Moderation ─────────────────────────

const reasonSchema = z.object({ reason: text(300) });

/** Either participant can flag a message for review. */
export async function flagMessage(ctx: AuthContext, messageId: string, input: unknown) {
  const { reason } = parse(reasonSchema, input);
  const m = await db.threadMessage.findFirst({ where: { id: messageId }, include: { thread: true } });
  if (!m || m.thread.schoolId !== ctx.schoolId) throw notFound("Message");
  const participant = m.thread.guardianUserId === ctx.userId || m.thread.staffUserId === ctx.userId;
  if (!participant && !(ctx.userType === "STAFF" && isModerator(ctx))) throw notFound("Message");
  if (m.senderUserId === ctx.userId) throw conflict("You cannot flag your own message.");
  await db.$transaction(async (tx) => {
    await tx.threadMessage.update({ where: { id: messageId }, data: { flaggedAt: new Date(), flaggedById: ctx.userId, flagReason: reason } });
    await writeAudit(tx, actorOf(ctx), { action: "message.flag", entityType: "ThreadMessage", entityId: messageId, summary: m.thread.subject, reason });
  });
}

async function moderationTarget(ctx: AuthContext, messageId: string) {
  staffOnly(ctx);
  requirePermission(ctx, "messages.moderate");
  const m = await db.threadMessage.findFirst({ where: { id: messageId }, include: { thread: true } });
  if (!m || m.thread.schoolId !== ctx.schoolId) throw notFound("Message");
  return m;
}

export async function hideMessage(ctx: AuthContext, messageId: string, input: unknown) {
  const { reason } = parse(reasonSchema, input);
  const m = await moderationTarget(ctx, messageId);
  if (m.visibility === "HIDDEN") throw conflict("This message is already hidden.");
  await db.$transaction(async (tx) => {
    await tx.threadMessage.update({ where: { id: messageId }, data: { visibility: "HIDDEN", hiddenById: ctx.userId, hiddenReason: reason, hiddenAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "message.hide", entityType: "ThreadMessage", entityId: messageId, summary: m.thread.subject, reason });
  });
}

export async function unhideMessage(ctx: AuthContext, messageId: string) {
  const m = await moderationTarget(ctx, messageId);
  if (m.visibility !== "HIDDEN") throw conflict("This message is not hidden.");
  await db.$transaction(async (tx) => {
    await tx.threadMessage.update({ where: { id: messageId }, data: { visibility: "VISIBLE", hiddenById: null, hiddenReason: null, hiddenAt: null, flaggedAt: null, flaggedById: null, flagReason: null } });
    await writeAudit(tx, actorOf(ctx), { action: "message.unhide", entityType: "ThreadMessage", entityId: messageId, summary: m.thread.subject });
  });
}

/** A moderator reviewed a flag and decided it needs no action. */
export async function dismissFlag(ctx: AuthContext, messageId: string) {
  const m = await moderationTarget(ctx, messageId);
  if (!m.flaggedAt) throw conflict("This message is not flagged.");
  await db.$transaction(async (tx) => {
    await tx.threadMessage.update({ where: { id: messageId }, data: { flaggedAt: null, flaggedById: null, flagReason: null } });
    await writeAudit(tx, actorOf(ctx), { action: "message.flag_dismiss", entityType: "ThreadMessage", entityId: messageId, summary: m.thread.subject, changes: { reason: m.flagReason } });
  });
}

export async function setThreadStatus(ctx: AuthContext, id: string, status: "OPEN" | "CLOSED") {
  const { t } = await loadStaffThread(ctx, id);
  if (t.status === status) return;
  await db.$transaction(async (tx) => {
    await tx.messageThread.update({ where: { id }, data: { status, closedAt: status === "CLOSED" ? new Date() : null, closedById: status === "CLOSED" ? ctx.userId : null } });
    await writeAudit(tx, actorOf(ctx), { action: status === "CLOSED" ? "thread.close" : "thread.reopen", entityType: "MessageThread", entityId: id, summary: t.subject });
  });
}

/** Moderators route a conversation to a teacher, or back to the office. */
export async function assignThread(ctx: AuthContext, id: string, staffUserId: string | null) {
  requirePermission(ctx, "messages.moderate");
  const { t } = await loadStaffThread(ctx, id);
  if (staffUserId && !(await db.user.findFirst({ where: { id: staffUserId, schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { staffUserId: "Choose an active staff member" });
  await db.$transaction(async (tx) => {
    await tx.messageThread.update({ where: { id }, data: { staffUserId, staffReadAt: null } });
    if (staffUserId) await notifyUser(tx, ctx.schoolId, staffUserId, t.subject.slice(0, 120), "A conversation was assigned to you.", `/communication/messages/${id}`);
    await writeAudit(tx, actorOf(ctx), { action: "thread.assign", entityType: "MessageThread", entityId: id, summary: t.subject, changes: { from: t.staffUserId, to: staffUserId } });
  });
}

export async function countStaffAttention(ctx: AuthContext): Promise<number> {
  if (ctx.userType !== "STAFF" || !(ctx.permissions.has("messages.read") || isModerator(ctx))) return 0;
  const rows = await db.messageThread.findMany({ where: { schoolId: ctx.schoolId, status: "OPEN", OR: [{ staffUserId: ctx.userId }, ...(isModerator(ctx) ? [{ staffUserId: null }] : [])] }, select: { staffUserId: true, lastMessageAt: true, staffReadAt: true } });
  return rows.filter((r) => !r.staffReadAt || r.staffReadAt < r.lastMessageAt).length;
}

/** Student search for starting a conversation: teachers only find students of classes and streams they teach. */
export async function searchStudentsForMessaging(ctx: AuthContext, q: string) {
  staffOnly(ctx);
  requirePermission(ctx, "messages.send");
  const term = q.trim();
  if (term.length < 2) return [];
  const match = { OR: [{ firstName: { contains: term, mode: "insensitive" as const } }, { lastName: { contains: term, mode: "insensitive" as const } }, { admissionNo: { contains: term, mode: "insensitive" as const } }] };
  let scoped: Record<string, unknown> = {};
  if (!isModerator(ctx)) {
    const yearId = await currentYearId(db, ctx.schoolId);
    const scope = ctx.staffId && yearId ? await teachingScope(ctx.staffId, yearId) : [];
    if (!scope.length || !yearId) return [];
    scoped = { enrollments: { some: { academicYearId: yearId, status: "ACTIVE", OR: scope.map((s) => ({ classId: s.classId, ...(s.streamId ? { streamId: s.streamId } : {}) })) } } };
  }
  return db.student.findMany({ where: { schoolId: ctx.schoolId, status: "ENROLLED", ...match, ...scoped }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 15, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } });
}

/** The student and the guardians who could receive a message, if this staff member may write about them. */
export async function studentForMessaging(ctx: AuthContext, studentId: string) {
  staffOnly(ctx);
  requirePermission(ctx, "messages.send");
  const s = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, status: "ENROLLED" }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, guardians: { include: { guardian: { select: { id: true, fullName: true, userId: true, user: { select: { status: true } } } } } } } });
  if (!s) return null;
  if (!isModerator(ctx)) {
    const yearId = await currentYearId(db, ctx.schoolId);
    const en = yearId ? await db.studentEnrollment.findFirst({ where: { schoolId: ctx.schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true, streamId: true } }) : null;
    const scope = ctx.staffId && yearId ? await teachingScope(ctx.staffId, yearId) : [];
    if (!en || !scope.some((x) => x.classId === en.classId && (x.streamId === null || x.streamId === en.streamId))) return null;
  }
  return s;
}
