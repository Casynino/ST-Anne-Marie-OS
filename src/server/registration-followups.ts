import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, writeAudit } from "@/server/audit";
import { optText, parse, uuid } from "@/lib/validation";

/*
 * Follow-up notes for returning students who have not registered yet: Admissions calls or visits the family and records what they said.
 * The notes are history (a database trigger forbids edits and deletes). They never change the registration: nobody is withdrawn or cancelled
 * because a family did not answer. Cancelling stays a separate, reasoned step on the registration itself.
 */

export const FOLLOW_UP_OUTCOMES = ["WILL_RETURN", "NOT_RETURNING", "NO_ANSWER", "OTHER"] as const;
const schema = z.object({ registrationId: uuid(), outcome: z.enum(FOLLOW_UP_OUTCOMES), note: optText(500) });

export async function addRegistrationFollowUp(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "registration.manage");
  const d = parse(schema, input);
  if ((d.outcome === "OTHER" || d.outcome === "NOT_RETURNING") && !d.note) throw conflict("Write a short note about what the family said.");
  await db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: d.registrationId, schoolId: ctx.schoolId }, include: { student: { select: { firstName: true, lastName: true, admissionNo: true } }, academicYear: { select: { name: true } } } });
    if (!reg) throw notFound("Registration");
    if (reg.status !== "PENDING") throw conflict("Only a student who has not registered yet can have a follow-up note.");
    const row = await tx.registrationFollowUp.create({ data: { schoolId: ctx.schoolId, registrationId: reg.id, outcome: d.outcome, note: d.note || null, createdById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "registration.follow_up", entityType: "AnnualRegistration", entityId: reg.id, summary: `${reg.student.firstName} ${reg.student.lastName} (${reg.student.admissionNo}) · ${reg.academicYear.name} · ${d.outcome}`, changes: { followUpId: row.id, outcome: d.outcome } });
  });
}

export type FollowUp = { id: string; outcome: (typeof FOLLOW_UP_OUTCOMES)[number]; note: string | null; at: Date; by: string | null };

/** The notes for one registration, newest first. */
export async function registrationFollowUps(ctx: AuthContext, registrationId: string): Promise<FollowUp[]> {
  requirePermission(ctx, "registration.read");
  const rows = await db.registrationFollowUp.findMany({ where: { schoolId: ctx.schoolId, registrationId }, orderBy: { createdAt: "desc" }, take: 50 });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ id: r.id, outcome: r.outcome, note: r.note, at: r.createdAt, by: r.createdById ? name.get(r.createdById) ?? null : null }));
}
