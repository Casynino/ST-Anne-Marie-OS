import { z } from "zod";
import type { TaskDepartment } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { schoolToday } from "@/server/balances";
import { actorOf, writeAudit } from "@/server/audit";
import { optText, optUuid, parse } from "@/lib/validation";

/*
 * Hand-offs between departments.
 *
 * Every step that is another department's job leaves a task for it: who must act next, on what, by when. A task is a pointer to work, never a
 * substitute for it: the application, payment, student or concern stays the source of truth and the step that does the work closes the task
 * (so a task cannot be ticked done without the work happening, except by someone with the right permission, with a note). The dedupe key makes
 * a retried event create its task only once. "Overdue" is worked out (open and past its date), not stored.
 */

export const TASK_KINDS = {
  APPLICATION_REVIEW: { department: "ADMISSIONS", dueDays: 3 },
  ASSESSMENT_COORDINATE: { department: "ACADEMIC", dueDays: 5 },
  INTERVIEW_ASSIGNED: { department: "ACADEMIC", dueDays: 0 },
  DECISION_REVIEW: { department: "ADMISSIONS", dueDays: 3 },
  EXAM_REVIEW: { department: "ACADEMIC", dueDays: 2 },
  OFFER_COMMUNICATE: { department: "ADMISSIONS", dueDays: 2 },
  ADMISSION_PAYMENT: { department: "FINANCE", dueDays: 7 },
  ENROL_APPLICANT: { department: "ADMISSIONS", dueDays: 2 },
  CLASS_PLACEMENT: { department: "ACADEMIC", dueDays: 3 },
  CONCERN_FOLLOWUP: { department: "ACADEMIC", dueDays: 7 },
  TRANSFER_REVIEW: { department: "ACADEMIC", dueDays: 5 },
  CANDIDATE_REVIEW: { department: "HR", dueDays: 5 },
  CANDIDATE_INTERVIEW: { department: "HR", dueDays: 0 },
  CANDIDATE_DECISION: { department: "ADMIN", dueDays: 3 },
  STAFF_ONBOARDING: { department: "HR", dueDays: 7 },
  TEACHING_ASSIGNMENT: { department: "ACADEMIC", dueDays: 5 },
  PAYROLL_ONBOARDING: { department: "FINANCE", dueDays: 7 },
  APPLICATION_FEE_HOLD: { department: "FINANCE", dueDays: 2 },
  INSTALMENT_DUE: { department: "FINANCE", dueDays: 0 },
  INSTALMENT_OVERDUE: { department: "FINANCE", dueDays: 0 },
  RETURNING_PLACEMENT: { department: "ADMISSIONS", dueDays: 3 },
  RETURNING_FEE: { department: "FINANCE", dueDays: 3 },
} as const satisfies Record<string, { department: TaskDepartment; dueDays: number }>;
export type TaskKind = keyof typeof TASK_KINDS;
export const TASK_DEPARTMENTS = ["ADMISSIONS", "ACADEMIC", "FINANCE", "HR", "ADMIN"] as const satisfies readonly TaskDepartment[];

/** Who may see a department's tasks, and who may work them. Super admin and `tasks.admin` see everything. */
const SEE: Record<TaskDepartment, readonly PermissionKey[]> = {
  ADMISSIONS: ["admission.read"],
  ACADEMIC: ["tasks.academic"],
  FINANCE: ["tasks.finance", "admission.payment.record", "admission.payment.verify"],
  HR: ["tasks.hr"],
  ADMIN: ["tasks.admin"],
};
const WORK: Record<TaskDepartment, readonly PermissionKey[]> = {
  ADMISSIONS: ["admission.create", "admission.review", "admission.enrol", "admission.documents.verify"],
  ACADEMIC: ["tasks.academic"],
  FINANCE: ["tasks.finance", "admission.payment.record", "admission.payment.verify"],
  HR: ["tasks.hr"],
  ADMIN: ["tasks.admin"],
};
const canSee = (ctx: AuthContext, d: TaskDepartment) => ctx.permissions.has("tasks.admin") || SEE[d].some((p) => ctx.permissions.has(p));
const canWork = (ctx: AuthContext, d: TaskDepartment) => ctx.permissions.has("tasks.admin") || WORK[d].some((p) => ctx.permissions.has(p));
export const visibleDepartments = (ctx: AuthContext) => TASK_DEPARTMENTS.filter((d) => canSee(ctx, d));

type Client = Db | Tx;

/**
 * Leaves a task for a department. Safe to call again for the same event: the unique dedupe key (kind + record + optional discriminator)
 * means the second call changes nothing, including after the first task was completed.
 */
export async function openTask(client: Client, a: {
  schoolId: string; kind: TaskKind; relatedType: string; relatedId: string; relatedLabel?: string; sourceEvent: string;
  assignedToId?: string | null; dueOn?: Date | null; createdById?: string | null; discriminator?: string;
}): Promise<void> {
  const def = TASK_KINDS[a.kind];
  let dueOn = a.dueOn;
  if (dueOn === undefined) {
    const today = new Date(`${await schoolToday(client, a.schoolId)}T00:00:00Z`);
    dueOn = new Date(today.getTime() + def.dueDays * 86_400_000);
  }
  await client.workflowTask.createMany({
    data: [{
      schoolId: a.schoolId, kind: a.kind, department: def.department, sourceEvent: a.sourceEvent, relatedType: a.relatedType, relatedId: a.relatedId, relatedLabel: a.relatedLabel ?? null,
      assignedToId: a.assignedToId ?? null, dueOn, createdById: a.createdById ?? null, dedupeKey: `${a.kind}:${a.relatedId}${a.discriminator ? `:${a.discriminator}` : ""}`,
    }],
    skipDuplicates: true,
  });
}

/** The step that does the work closes the tasks that pointed at it. Only open tasks change. */
export async function closeTasks(client: Client, a: { schoolId: string; relatedType: string; relatedId: string; kinds?: TaskKind[]; status?: "COMPLETED" | "CANCELLED"; by?: string | null; note?: string; discriminator?: string }): Promise<number> {
  const status = a.status ?? "COMPLETED";
  const r = await client.workflowTask.updateMany({
    where: {
      schoolId: a.schoolId, relatedType: a.relatedType, relatedId: a.relatedId, status: { in: ["PENDING", "IN_PROGRESS"] },
      ...(a.kinds ? { kind: { in: a.kinds } } : {}), ...(a.discriminator ? { dedupeKey: { endsWith: `:${a.discriminator}` } } : {}),
    },
    data: { status, completedAt: new Date(), completedById: a.by ?? null, completionNote: a.note ?? null },
  });
  return r.count;
}

// ───────────────────────── Reading and working tasks ─────────────────────────

export type TaskRow = {
  id: string; kind: string; department: TaskDepartment; relatedType: string; relatedId: string; relatedLabel: string | null; sourceEvent: string; assignedToId: string | null; assignedTo: string | null;
  dueOn: Date | null; status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; overdue: boolean; createdAt: Date; completedAt: Date | null; completedBy: string | null; completionNote: string | null; canWork: boolean;
};

const filterSchema = z.object({
  department: z.preprocess((v) => (v === "" ? undefined : v), z.enum(TASK_DEPARTMENTS).optional()),
  state: z.preprocess((v) => (v === "" || v === undefined ? "open" : v), z.enum(["open", "overdue", "mine", "done"])),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listTasks(ctx: AuthContext, input: unknown = {}) {
  const f = parse(filterSchema, input);
  const depts = visibleDepartments(ctx);
  if (depts.length === 0) throw forbidden();
  if (f.department && !depts.includes(f.department)) throw forbidden();
  const today = new Date(`${await schoolToday(db, ctx.schoolId)}T00:00:00Z`);
  const open = { in: ["PENDING", "IN_PROGRESS"] as ("PENDING" | "IN_PROGRESS")[] };
  const where = {
    schoolId: ctx.schoolId, department: { in: f.department ? [f.department] : depts },
    ...(f.state === "done" ? { status: { in: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] } } : { status: open }),
    ...(f.state === "overdue" ? { dueOn: { lt: today } } : {}),
    ...(f.state === "mine" ? { assignedToId: ctx.userId } : {}),
  };
  const pageSize = 30;
  const [rows, total] = await Promise.all([
    db.workflowTask.findMany({ where, orderBy: f.state === "done" ? { completedAt: "desc" } : [{ dueOn: "asc" }, { createdAt: "asc" }], skip: (f.page - 1) * pageSize, take: pageSize }),
    db.workflowTask.count({ where }),
  ]);
  const userIds = [...new Set(rows.flatMap((r) => [r.assignedToId, r.completedById].filter((x): x is string => !!x)))];
  const users = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: userIds } }, select: { id: true, fullName: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
  const items: TaskRow[] = rows.map((r) => ({
    id: r.id, kind: r.kind, department: r.department, relatedType: r.relatedType, relatedId: r.relatedId, relatedLabel: r.relatedLabel, sourceEvent: r.sourceEvent, assignedToId: r.assignedToId, assignedTo: name(r.assignedToId),
    dueOn: r.dueOn, status: r.status, overdue: (r.status === "PENDING" || r.status === "IN_PROGRESS") && !!r.dueOn && r.dueOn < today, createdAt: r.createdAt, completedAt: r.completedAt, completedBy: name(r.completedById), completionNote: r.completionNote,
    canWork: canWork(ctx, r.department),
  }));
  return { items, total, page: f.page, pageSize, departments: depts };
}

/** Open and overdue counts per department the person may see, plus how many are theirs: the numbers behind every dashboard. */
export async function taskCounts(ctx: AuthContext) {
  const depts = visibleDepartments(ctx);
  if (depts.length === 0) return [];
  const today = new Date(`${await schoolToday(db, ctx.schoolId)}T00:00:00Z`);
  const [open, overdue, mine] = await Promise.all([
    db.workflowTask.groupBy({ by: ["department"], where: { schoolId: ctx.schoolId, department: { in: depts }, status: { in: ["PENDING", "IN_PROGRESS"] } }, _count: { _all: true } }),
    db.workflowTask.groupBy({ by: ["department"], where: { schoolId: ctx.schoolId, department: { in: depts }, status: { in: ["PENDING", "IN_PROGRESS"] }, dueOn: { lt: today } }, _count: { _all: true } }),
    db.workflowTask.groupBy({ by: ["department"], where: { schoolId: ctx.schoolId, department: { in: depts }, status: { in: ["PENDING", "IN_PROGRESS"] }, assignedToId: ctx.userId }, _count: { _all: true } }),
  ]);
  return depts.map((department) => ({
    department, open: open.find((x) => x.department === department)?._count._all ?? 0, overdue: overdue.find((x) => x.department === department)?._count._all ?? 0, mine: mine.find((x) => x.department === department)?._count._all ?? 0,
  }));
}

async function loadForWork(tx: Tx, ctx: AuthContext, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM workflow_tasks WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound("Task");
  const t = await tx.workflowTask.findUniqueOrThrow({ where: { id } });
  if (!canSee(ctx, t.department)) throw notFound("Task"); // a department's tasks do not exist for people outside it
  if (!canWork(ctx, t.department)) throw forbidden();
  return t;
}

export async function startTask(ctx: AuthContext, id: string) {
  await db.$transaction(async (tx) => {
    const t = await loadForWork(tx, ctx, id);
    if (t.status !== "PENDING") throw conflict("This task is not waiting to be started.");
    await tx.workflowTask.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date(), assignedToId: t.assignedToId ?? ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "task.start", entityType: "WorkflowTask", entityId: id, summary: `${t.kind} · ${t.relatedLabel ?? t.relatedId}` });
  });
}

const completeSchema = z.object({ note: optText(400) });

/** For work done outside a step that closes its own task. Needs the department's permission; the note is kept. */
export async function completeTask(ctx: AuthContext, id: string, input: unknown = {}) {
  const d = parse(completeSchema, input);
  await db.$transaction(async (tx) => {
    const t = await loadForWork(tx, ctx, id);
    if (t.status === "COMPLETED" || t.status === "CANCELLED") throw conflict("This task is already closed.");
    await tx.workflowTask.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), completedById: ctx.userId, completionNote: d.note ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: "task.complete", entityType: "WorkflowTask", entityId: id, summary: `${t.kind} · ${t.relatedLabel ?? t.relatedId}`, reason: d.note });
  });
}

const assignSchema = z.object({ userId: optUuid() });

/** Gives a task to a person in the school (or takes the assignment away). Done by people who may work that department's tasks. */
export async function assignTask(ctx: AuthContext, id: string, input: unknown) {
  const d = parse(assignSchema, input);
  await db.$transaction(async (tx) => {
    const t = await loadForWork(tx, ctx, id);
    if (t.status === "COMPLETED" || t.status === "CANCELLED") throw conflict("This task is already closed.");
    if (d.userId && !(await tx.user.findFirst({ where: { id: d.userId, schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, select: { id: true } }))) throw notFound("User");
    await tx.workflowTask.update({ where: { id }, data: { assignedToId: d.userId ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: "task.assign", entityType: "WorkflowTask", entityId: id, summary: `${t.kind} · ${t.relatedLabel ?? t.relatedId}`, changes: { from: t.assignedToId, to: d.userId ?? null } });
  });
}

/** Staff who can be given a task. */
export async function assignableStaff(ctx: AuthContext) {
  requireAnyPermission(ctx, ["tasks.academic", "tasks.finance", "tasks.hr", "tasks.admin", "admission.read"]);
  return db.user.findMany({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } });
}

/** Where a task's record lives in the app. */
export function taskHref(t: { relatedType: string; relatedId: string }): string | null {
  switch (t.relatedType) {
    case "Application": return `/admissions/${t.relatedId}`;
    case "Student": return `/students/${t.relatedId}`;
    case "AdmissionPayment": return "/finance/admissions";
    case "ApplicationDraft": return "/finance/application-fees";
    case "Invoice": return `/finance/invoices/${t.relatedId}`;
    case "AcademicConcern": return `/academic-office/concerns/${t.relatedId}`;
    case "ClassTransfer": return "/academic-office/transfers";
    case "AnnualRegistration": return "/admissions/returning";
    case "Candidate": return `/staff-recruitment/${t.relatedId}`;
    default: return null;
  }
}
