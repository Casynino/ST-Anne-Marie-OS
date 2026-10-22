import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { interviewWorkspace, type InterviewWorkspace } from "@/server/admission-stages";
import { examLabel, teachersFor } from "@/lib/admissions/exams";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { QuickBar } from "../../quick-actions";
import { AssignTeacher } from "./assign-teacher";
import { missingLabels, quickActs, quickLabels } from "../../quick-line";
import { quickDecisionAction } from "../../actions";
import { assignExamAction, removeExamAction } from "../../../applicant-exams/actions";

export const metadata: Metadata = { title: "Interview" };
const TONE = { SCHEDULED: "neutral", AWAITING_MARKING: "warn", MARKING: "brand", SUBMITTED: "ok", AWAITING_REVIEW: "warn", RETURNED: "bad", APPROVED: "ok", CANCELLED: "neutral" } as const;
const STAGE_TONE = { SCHEDULED: "neutral", EXAMS: "warn", REVIEW: "warn", READY: "ok" } as const;

/**
 * The interview workspace of one applicant: when and where, the examination subjects with their teachers and progress, the marks that are
 * in and what is outstanding, and the actions that fit this stage. The application stays one click away ("Application details"); opening a
 * record from the Interviews list never lands on the application page.
 */
export default async function InterviewWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read") && !ctx.permissions.has("admission.interview.manage")) return <NoAccess t={t} />;
  const { id } = await params;
  let ws: InterviewWorkspace;
  try {
    ws = await interviewWorkspace(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  const school = await getSchoolBasics(ctx.schoolId);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const now = Date.now();
  const row = ws.row;
  const detailsHref = `/admissions/${ws.applicationId}`;
  const bar = (
    <QuickBar
      line={{ id: row.id, name: row.name, className2: row.className ?? t("adm.noClass"), classId: row.classAppliedId, acts: quickActs(row, t, can, now), afterReview: row.afterReview, pendingDocs: row.pendingDocs, missing: missingLabels(row, t), interviewDetail: row.interviewAt ? displayDateTime(row.interviewAt, school.timezone, ctx.locale) : null }}
      labels={quickLabels(t)} dismiss={t("adm.bulk.dismiss")} quick={quickDecisionAction} slots={[]}
    />
  );
  if (ws.mode === "NONE") {
    return (
      <>
        <PageHeader title={row.name} subtitle={row.applicationNo} actions={<LinkButton href={detailsHref} variant="secondary">{t("adm.iw.details")}</LinkButton>} />
        <AdmissionsNav ctx={ctx} t={t} current="/admissions?stage=interview" />
        <Card title={t("adm.iw.none.title")}><p className="text-sm text-muted">{t("adm.iw.none")}</p><div className="mt-4">{bar}</div></Card>
      </>
    );
  }
  const iv = ws.interview, ex = ws.exam;
  const label = (status: Parameters<typeof examLabel>[0]) => examLabel(status, iv.scheduledAt, now, ex.approval);
  const stage = row.ivStage;
  const when = displayDateTime(iv.scheduledAt, school.timezone, ctx.locale);
  const markText = (l: { mark: number | null; outcome: string | null; maxMark: number }) => (l.mark !== null ? `${l.mark} / ${l.maxMark}` : l.outcome ?? "—");
  const teacherLabels = {
    subject: t("exam.col.subject"), teacher: t("exam.col.teacher"), choose: t("exam.change.choose"), hintClass: t("exam.assign.hintClass"), hintSubject: t("exam.assign.hintSubject"), hintAny: t("exam.assign.hintAny"),
    noTeachers: t("exam.assign.noTeachers"), max: t("exam.assign.max"), due: t("exam.assign.due"), instructions: t("exam.assign.instructions"), optional: t("common.optional"), select: t("common.select"), more: t("exam.assign.more"),
  };
  const assigned = new Set(ex.lines.map((l) => l.subjectId));
  const unassigned = (ws.setup?.subjects ?? []).filter((x) => !assigned.has(x.id));
  const firstSubject = (ws.setup?.usualSubjectIds ?? []).find((id) => !assigned.has(id)) ?? unassigned[0]?.id ?? "";
  // The form is open while nobody is assigned yet (or the school requires every usual subject); afterwards it folds away under "Add another subject".
  const needsTeachers = ex.lines.length === 0 || ex.progress.missingSubjectIds.length > 0;

  return (
    <>
      <PageHeader
        title={ws.applicant.name}
        subtitle={`${ws.applicant.applicationNo} · ${t("adm.iw.title")}`}
        actions={<div className="flex flex-wrap gap-2"><LinkButton href={detailsHref} variant="secondary">{t("adm.iw.details")}</LinkButton></div>}
      />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions?stage=interview" />
      <div className="mb-5">{bar}</div>
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title={t("adm.iw.interview")} actions={stage ? <Badge tone={STAGE_TONE[stage]}>{t(`adm.ivstage.${stage}`)}</Badge> : undefined}>
            <DefList items={[
              { label: t("adm.iw.when"), value: when },
              { label: t("adm.iw.where"), value: iv.location ?? null },
              { label: t("adm.iw.length"), value: t("adm.iw.minutes", { n: String(iv.durationMinutes) }) },
              { label: t("common.status"), value: iv.status === "SCHEDULED" ? t("adm.iv.status.SCHEDULED") : `${t(`adm.iv.status.${iv.status}` as "adm.iv.status.SCHEDULED")}${iv.outcome ? ` · ${iv.outcome}` : ""}` },
            ]} />
            {ex.progress.state !== "NONE" && (
              <p className="mt-4 text-sm" role="status">
                {ex.progress.state === "NOT_ASSIGNED" && ex.progress.total === 0 ? t("adm.iw.exams.TO_ASSIGN") : t(`adm.iw.exams.${ex.progress.state}` as "adm.iw.exams.COMPLETE", { done: String(ex.progress.final), total: String(Math.max(ex.progress.total, ex.progress.final)) })}
              </p>
            )}
            {ex.average !== null && (
              <p className="mt-2 text-sm" role="status"><span className="font-medium">{t("adm.iw.average", { avg: String(ex.average), pass: String(ex.passMark) })}</span> · {ex.passed ? (ex.autoAccept ? t("adm.iw.average.passStuck") : t("adm.iw.average.pass")) : t("adm.iw.average.below")}</p>
            )}
            {ex.outstanding.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {ex.outstanding.map((o) => <li key={o.subject}>{o.why === "NOT_ASSIGNED" ? t("adm.iw.out.notAssigned", { subject: o.subject }) : o.why === "REVIEW" ? t("adm.iw.out.review", { subject: o.subject }) : t("adm.iw.out.marking", { subject: o.subject, teacher: o.teacher ?? "" })}</li>)}
              </ul>
            )}
          </Card>

          <Card title={t("adm.iw.exams")}>
            {ex.lines.length === 0 ? <p className="text-sm text-muted">{t("adm.iw.exams.none")}</p> : (
              <div className="overflow-x-auto">
                <div className="hidden grid-cols-[1.2fr_1.2fr_1fr_0.6fr] gap-x-4 border-b border-line pb-2 text-xs uppercase tracking-wide text-muted sm:grid">
                  <span>{t("exam.col.subject")}</span><span>{t("exam.col.teacher")}</span><span>{t("common.status")}</span><span>{t("exam.col.mark")}</span>
                </div>
                <ul className="divide-y divide-line">
                  {ex.lines.map((l) => {
                    const open = can("admission.exam.assign") && iv.status === "SCHEDULED" && (l.status === "ASSIGNED" || l.status === "DRAFT" || l.status === "RETURNED");
                    const pick = ws.setup ? teachersFor(l.subjectId, ws.setup.teachers) : null;
                    const others = pick ? pick.ids.filter((id) => id !== l.teacherId).length : 0;
                    return (
                      <li key={l.id} className="py-3 text-sm">
                        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[1.2fr_1.2fr_1fr_0.6fr] sm:items-center">
                          <span className="font-medium">{l.subject}</span>
                          <span>{l.teacher}</span>
                          <span><Badge tone={TONE[label(l.status)]}>{t(`exam.st.${label(l.status)}` as "exam.st.SUBMITTED")}</Badge></span>
                          <span className="tabular-nums">{l.status === "SUBMITTED" || l.status === "APPROVED" ? markText(l) : "—"}</span>
                        </div>
                        {open && (
                          <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-2">
                            {ws.setup && (
                              <details>
                                <summary className="cursor-pointer text-sm font-medium text-link">{t("exam.change")}</summary>
                                <div className="mt-2 w-full max-w-md rounded-lg border border-line bg-canvas p-3">
                                  {others === 0 ? <p className="text-sm text-muted">{pick?.tier === "CLASS" ? t("exam.change.only", { teacher: l.teacher, subject: l.subject, class: ws.setup.appliedClass ?? "" }) : pick?.tier === "SUBJECT" ? t("exam.change.onlySubject", { teacher: l.teacher, subject: l.subject }) : t("exam.assign.noTeachers")}</p> : (
                                    <AssignTeacher action={assignExamAction} interviewId={iv.id} subjects={ws.setup.subjects} teachers={ws.setup.teachers} initialSubjectId={l.subjectId} fixedSubject currentTeacherId={l.teacherId} appliedClass={ws.setup.appliedClass} submitLabel={t("exam.change.go")} labels={teacherLabels} />
                                  )}
                                </div>
                              </details>
                            )}
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-link">{t("exam.remove")}</summary>
                              <div className="mt-2 w-full max-w-md rounded-lg border border-line bg-canvas p-3">
                                <ActionForm action={removeExamAction} submitLabel={t("exam.remove")} tone="danger" className="space-y-2">
                                  <input type="hidden" name="examId" value={l.id} />
                                  <Field name="reason" label={t("exam.remove.reason")} required />
                                </ActionForm>
                              </div>
                            </details>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {ex.lines.some((l) => (l.status === "SUBMITTED" || l.status === "APPROVED") && l.comment) && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-muted">
                    {ex.lines.filter((l) => (l.status === "SUBMITTED" || l.status === "APPROVED") && l.comment).map((l) => <li key={l.id}><span className="font-medium text-ink">{l.subject}:</span> {l.comment}</li>)}
                  </ul>
                )}
              </div>
            )}
            {ws.setup && unassigned.length > 0 && (() => {
              const form = (
                <AssignTeacher action={assignExamAction} interviewId={iv.id} subjects={unassigned} teachers={ws.setup.teachers} initialSubjectId={firstSubject} appliedClass={ws.setup.appliedClass} maxMark={ws.setup.maxMark} extras submitLabel={t("exam.assign.go")} labels={teacherLabels} />
              );
              return needsTeachers ? (
                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="mb-1 text-sm font-semibold">{t("exam.assign.title")}</h3>
                  <p className="mb-3 text-sm text-muted">{t("exam.assign.hint")}</p>
                  {form}
                </div>
              ) : (
                <details className="mt-5 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-medium text-link">{t("exam.add.another")}</summary>
                  <div className="mt-3">{form}</div>
                </details>
              );
            })()}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title={t("adm.iw.applicant")}>
            <DefList items={[
              { label: t("adm.applicant"), value: ws.applicant.name },
              { label: t("adm.dob"), value: displayDate(ws.applicant.dateOfBirth, ctx.locale) },
              { label: t("adm.classApplied"), value: ws.applicant.className },
              { label: t("adm.guardian"), value: [row.guardianName, row.guardianPhone].filter(Boolean).join(" · ") || null },
            ]} />
            <p className="mt-4 text-sm"><Link href={detailsHref} className="font-medium text-link hover:underline">{t("adm.iw.details")}</Link></p>
          </Card>
          {ex.lines.length > 0 && can("admission.exam.review") && (
            <p className="text-sm text-muted"><Link href="/applicant-exams" className="font-medium text-link hover:underline">{t("exam.review.open")}</Link></p>
          )}
        </div>
      </div>
    </>
  );
}
