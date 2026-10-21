"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as office from "@/server/academic-office";
import * as concerns from "@/server/concerns";
import * as transfers from "@/server/transfers";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { studentScope } from "@/server/students";


const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function updateAcademicSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await office.updateAcademicSettings(ctx, { lowAverage: i.lowAverage, repeatedAbsences: i.repeatedAbsences, repeatedAbsenceDays: i.repeatedAbsenceDays, capacityWarnPct: i.capacityWarnPct }); return saved(ctx); });
}

// ───────────── Concerns ─────────────

export async function flagConcernAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await concerns.flagConcern(ctx, { studentId: i.studentId, category: i.category, summary: i.summary, notes: i.notes, subjectId: i.subjectId }); return saved(ctx); });
}
export async function concernActionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await concerns.addConcernAction(ctx, str(i.id), { kind: i.kind, note: i.note }); return saved(ctx); });
}
export async function assignConcernAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await concerns.assignConcern(ctx, str(i.id), { userId: i.userId }); return saved(ctx); });
}
export async function resolveConcernAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await concerns.resolveConcern(ctx, str(i.id), { outcome: i.outcome, resolution: i.resolution }); return saved(ctx); });
}
export async function shareConcernAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await concerns.shareConcernWithParent(ctx, str(i.id), { message: i.message }); return saved(ctx); });
}

// ───────────── Transfers ─────────────
/** The office types the admission number; the student is found inside the user's own school and scope. */
async function studentByNumber(ctx: Parameters<typeof studentScope>[0], admissionNo: string) {
  const scope = await studentScope(ctx);
  const s = await db.student.findFirst({ where: { AND: [scope, { schoolId: ctx.schoolId, admissionNo: { equals: admissionNo.trim(), mode: "insensitive" } }] }, select: { id: true } });
  if (!s) throw Object.assign(notFound("Student"), {});
  return s.id;
}
export async function requestTransferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [toClassId, toStreamId] = str(i.placement).split("|");
    await transfers.requestTransfer(ctx, { studentId: await studentByNumber(ctx, str(i.admissionNo)), kind: i.kind || "TRANSFER", toClassId, toStreamId: toStreamId || undefined, academicYearId: i.academicYearId, effectiveOn: i.effectiveOn, reason: i.reason });
    return saved(ctx);
  }, { mapFieldErrors: (e) => ({ ...e, admissionNo: e.studentId ?? "", placement: e.toClassId ?? e.toStreamId ?? "" }) });
}
export async function proposePromotionsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [toClassId, toStreamId] = str(i.placement).split("|");
    const r = await transfers.proposePromotions(ctx, { fromClassId: i.fromClassId, toClassId, toStreamId: toStreamId || undefined, academicYearId: i.academicYearId, effectiveOn: i.effectiveOn });
    return { message: `${makeT(ctx.locale)("common.saved")}: ${r.created} / ${r.created + r.skipped}` };
  });
}
export async function decideTransferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await transfers.decideTransfer(ctx, str(i.id), { decision: i.decision, note: i.note, overrideCapacity: i.overrideCapacity, overrideReason: i.overrideReason }); return saved(ctx); });
}
export async function applyTransferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await transfers.applyTransfer(ctx, str(i.id), { overrideCapacity: i.overrideCapacity, overrideReason: i.overrideReason }); return saved(ctx); });
}
export async function cancelTransferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await transfers.cancelTransfer(ctx, str(i.id), { reason: i.reason }); return saved(ctx); });
}
