"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as recruitment from "@/server/recruitment";

const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function createCandidateAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { const c = await recruitment.createCandidate(ctx, i); return { redirectTo: `/staff-recruitment/${c.id}` }; });
}
export async function scheduleCandidateInterviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.scheduleCandidateInterview(ctx, str(i.id), { interviewAt: i.interviewAt, location: i.location, interviewerId: i.interviewerId }); return saved(ctx); });
}
export async function recordCandidateResultAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.recordCandidateResult(ctx, str(i.id), { outcome: i.outcome, score: i.score, notes: i.notes, suitability: i.suitability }); return saved(ctx); });
}
export async function decideCandidateAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.decideCandidate(ctx, str(i.id), { decision: i.decision, reason: i.reason }); return saved(ctx); });
}
export async function startOnboardingAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.startOnboarding(ctx, str(i.id), { startDate: i.startDate, jobTitle: i.jobTitle }); return saved(ctx); });
}
export async function recordCandidateDocumentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.recordCandidateDocument(ctx, str(i.id), { docType: i.docType, received: i.received, receivedOn: i.receivedOn, note: i.note }); return saved(ctx); });
}
export async function approveEmploymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.approveEmployment(ctx, str(i.id)); return saved(ctx); });
}
export async function activateEmployeeAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const r = await recruitment.activateEmployee(ctx, str(i.id), { email: i.email, phone: i.phone, roleIds: form.getAll("roleIds").map(String) });
    return { message: t("rec.activated"), data: { temporaryPassword: r.temporaryPassword, temporaryPasswordLabel: t("common.tempPassword"), temporaryPasswordNote: `${t("common.copyOnce")} ${t("common.tempPassword.note")}` } };
  });
}
export async function updateRecruitmentSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await recruitment.updateRecruitmentSettings(ctx, { docs: i.docs }); return saved(ctx); });
}
