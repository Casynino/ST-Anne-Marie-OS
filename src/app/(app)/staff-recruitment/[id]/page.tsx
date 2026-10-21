import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, CircleDashed } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { getCandidate } from "@/server/recruitment";
import { assignableStaff } from "@/server/workflow";
import { assignableRoles } from "@/server/rbac";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DefList, NoAccess, PageHeader } from "@/components/ui";
import { activateEmployeeAction, approveEmploymentAction, decideCandidateAction, recordCandidateDocumentAction, recordCandidateResultAction, scheduleCandidateInterviewAction, startOnboardingAction } from "../actions";

export const metadata: Metadata = { title: "Candidate" };
const hid = (v: string) => <input type="hidden" name="id" value={v} />;

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("staff.recruit") && !ctx.permissions.has("staff.recruit.decide")) return <NoAccess t={t} />;
  const { id } = await params;
  const c = await getCandidate(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!c) notFound();
  const school = await getSchoolBasics(ctx.schoolId);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const staff = can("staff.recruit") ? await assignableStaff(ctx).catch(() => []) : [];
  const roles = can("user.create") && c.status === "ONBOARDING" && c.employmentApprovedAt ? await assignableRoles(ctx) : [];
  const docTypes = [...new Set([...c.settings.requiredDocs, ...c.documents.map((d) => d.docType)])];
  const held = new Map(c.documents.map((d) => [d.docType.toLowerCase(), d]));
  const past = c.interviewAt ? c.interviewAt.getTime() <= Date.now() : false;
  const isInterviewer = c.interviewerId === ctx.userId;
  return (
    <>
      <PageHeader title={c.fullName} subtitle={`${c.candidateNo} · ${c.positionApplied}`} actions={<span className="flex items-center gap-3"><Badge tone={c.status === "ACTIVE" ? "ok" : c.status === "REJECTED" ? "bad" : "brand"}>{t(`rec.status.${c.status}` as "rec.status.APPLIED")}</Badge><Link href="/staff-recruitment" className="text-sm font-medium text-link hover:underline">{t("rec.title")}</Link></span>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title={t("rec.candidate")}>
            <DefList items={[
              { label: t("rec.position"), value: c.positionApplied }, { label: t("rec.subjects"), value: c.subjects }, { label: t("common.phone"), value: c.phone }, { label: t("common.email"), value: c.email },
              { label: t("rec.qualifications"), value: c.qualifications }, { label: t("rec.experience"), value: c.experience }, { label: t("concern.notes"), value: c.notes },
              { label: t("rec.recordedBy"), value: c.recordedBy },
            ]} />
          </Card>

          <Card title={t("rec.interview")}>
            {c.interviewAt && <p className="mb-3 text-sm"><span className="font-medium">{displayDateTime(c.interviewAt, school.timezone, ctx.locale)}</span>{c.interviewLocation ? ` · ${c.interviewLocation}` : ""}{c.interviewer ? ` · ${c.interviewer}` : ""}</p>}
            {c.interviewOutcome && <p className="mb-3 text-sm"><Badge tone={c.interviewOutcome === "PASSED" ? "ok" : "bad"}>{t(`adm.iv.outcome.${c.interviewOutcome}` as "adm.iv.outcome.PASSED")}</Badge>{c.interviewScore !== null ? ` ${c.interviewScore}/100` : ""}</p>}
            {c.interviewNotes && <p className="mb-2 whitespace-pre-line rounded bg-canvas px-2 py-1 text-sm">{c.interviewNotes}</p>}
            {c.suitability && <p className="mb-2 text-sm"><span className="text-muted">{t("rec.suitability")}:</span> {c.suitability}</p>}
            {can("staff.recruit") && ["APPLIED", "INTERVIEW_SCHEDULED"].includes(c.status) && (
              <ActionForm action={scheduleCandidateInterviewAction} submitLabel={t("adm.iv.schedule")} className="space-y-3 border-t border-line pt-3">{hid(c.id)}
                <Field name="interviewAt" type="datetime-local" label={t("adm.iv.when")} required />
                <Field name="location" label={t("adm.iv.location")} optionalLabel={t("common.optional")} />
                <Field name="interviewerId" type="select" label={t("adm.iv.interviewer")} options={staff.map((u) => ({ value: u.id, label: u.fullName }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
              </ActionForm>
            )}
            {c.status === "INTERVIEW_SCHEDULED" && past && (can("staff.recruit") || isInterviewer) && (
              <ActionForm action={recordCandidateResultAction} submitLabel={t("adm.iv.result")} className="mt-4 space-y-3 border-t border-line pt-3">{hid(c.id)}
                <Field name="outcome" type="select" label={t("adm.iv.title")} required options={[{ value: "PASSED", label: t("adm.iv.outcome.PASSED") }, { value: "NOT_PASSED", label: t("adm.iv.outcome.NOT_PASSED") }]} placeholder={t("common.select")} />
                <Field name="score" type="number" label={t("adm.iv.score")} min={0} max={100} optionalLabel={t("common.optional")} />
                <Field name="suitability" type="textarea" rows={2} label={t("rec.suitability")} hint={t("rec.suitability.hint")} optionalLabel={t("common.optional")} />
                <Field name="notes" type="textarea" rows={3} label={t("adm.iv.notes")} hint={t("adm.iv.hiddenNotes")} optionalLabel={t("common.optional")} />
              </ActionForm>
            )}
          </Card>

          {c.status === "AWAITING_DECISION" && can("staff.recruit.decide") && (
            <Card title={t("rec.decision")}>
              {c.createdById === ctx.userId ? <p className="text-sm text-muted">{t("rec.decision.other")}</p> : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <ActionForm action={decideCandidateAction} submitLabel={t("rec.accept")} className="space-y-3">{hid(c.id)}<input type="hidden" name="decision" value="ACCEPT" /><Field name="reason" label={t("marks.reason")} optionalLabel={t("common.optional")} /></ActionForm>
                  <ActionForm action={decideCandidateAction} submitLabel={t("rec.reject")} tone="danger" className="space-y-3">{hid(c.id)}<input type="hidden" name="decision" value="REJECT" /><Field name="reason" label={t("marks.reason")} required /></ActionForm>
                </div>
              )}
            </Card>
          )}
          {c.decidedAt && <p className="text-sm text-muted">{t("rec.decidedBy", { name: c.decidedBy ?? "", date: displayDate(c.decidedAt, ctx.locale) })}{c.decisionReason ? ` · ${c.decisionReason}` : ""}</p>}

          {["ACCEPTED", "ONBOARDING", "ACTIVE"].includes(c.status) && (
            <Card title={t("rec.onboarding")}>
              {c.status === "ACCEPTED" && can("staff.onboard") && (
                <ActionForm action={startOnboardingAction} submitLabel={t("rec.onboarding.start")} className="space-y-3">{hid(c.id)}
                  <Field name="jobTitle" label={t("rec.jobTitle")} defaultValue={c.positionApplied} />
                  <Field name="startDate" type="date" label={t("rec.startDate")} optionalLabel={t("common.optional")} />
                </ActionForm>
              )}
              {c.status !== "ACCEPTED" && (
                <>
                  <ul className="mb-3 divide-y divide-line text-sm">
                    {docTypes.length === 0 && <li className="py-2 text-muted">{t("rec.docs.none")}</li>}
                    {docTypes.map((d) => { const h = held.get(d.toLowerCase()); return (
                      <li key={d} className="flex items-center justify-between gap-3 py-2">
                        <span className="flex items-center gap-2">{h?.received ? <Check className="size-4 text-ok" aria-hidden /> : <CircleDashed className="size-4 text-muted" aria-hidden />}{d}{c.settings.requiredDocs.some((x) => x.toLowerCase() === d.toLowerCase()) && <Badge>{t("rec.docs.requiredTag")}</Badge>}</span>
                        {can("staff.onboard") && c.status === "ONBOARDING" && (
                          <ActionForm action={recordCandidateDocumentAction} submitLabel={h?.received ? t("rec.docs.undo") : t("rec.docs.received")} inline className="space-y-0">{hid(c.id)}<input type="hidden" name="docType" value={d} />{!h?.received && <input type="hidden" name="received" value="on" />}</ActionForm>
                        )}
                      </li>
                    ); })}
                  </ul>
                  {can("staff.onboard") && c.status === "ONBOARDING" && (
                    <ActionForm action={recordCandidateDocumentAction} submitLabel={t("rec.docs.add")} className="mb-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">{hid(c.id)}<input type="hidden" name="received" value="on" /><Field name="docType" label={t("rec.docs.type")} className="min-w-48 flex-1" /></ActionForm>
                  )}
                </>
              )}
              {c.status === "ONBOARDING" && !c.employmentApprovedAt && can("staff.recruit.decide") && (
                c.createdById === ctx.userId ? <p className="text-sm text-muted">{t("rec.decision.other")}</p> : <ActionForm action={approveEmploymentAction} submitLabel={t("rec.approve")} className="space-y-0 border-t border-line pt-3">{hid(c.id)}</ActionForm>
              )}
              {c.employmentApprovedAt && <p className="text-sm text-ok">{t("rec.approvedBy", { name: c.approvedBy ?? "", date: displayDate(c.employmentApprovedAt, ctx.locale) })}</p>}
              {c.status === "ONBOARDING" && c.employmentApprovedAt && can("user.create") && (
                <ActionForm action={activateEmployeeAction} submitLabel={t("rec.activate")} className="mt-4 space-y-3 border-t border-line pt-3">{hid(c.id)}
                  <p className="text-sm text-muted">{t("rec.activate.hint")}</p>
                  <Field name="email" type="email" label={t("common.email")} defaultValue={c.email ?? ""} optionalLabel={t("common.optional")} />
                  <Field name="phone" type="tel" label={t("common.phone")} defaultValue={c.phone ?? ""} optionalLabel={t("common.optional")} />
                  <fieldset><legend className="mb-1 text-sm font-medium">{t("nav.roles")}</legend><div className="grid gap-1 sm:grid-cols-2">{roles.map((r) => <label key={r.id} className="flex min-h-11 items-center gap-3 text-base"><input type="checkbox" name="roleIds" value={r.id} className="size-5 rounded border-line accent-brand-700" />{r.name}</label>)}</div></fieldset>
                </ActionForm>
              )}
              {c.status === "ACTIVE" && <p className="text-sm text-ok">{t("rec.activated")} <Link href={`/users/${c.userId}`} className="underline">{t("nav.users")}</Link></p>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
