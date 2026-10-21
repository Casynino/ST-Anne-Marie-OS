import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { interviewWorkspace, type InterviewWorkspace } from "@/server/admission-stages";
import { examLabel } from "@/lib/admissions/exams";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { QuickBar } from "../../quick-actions";
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
  const subjectName = new Map((ws.setup?.subjects ?? []).map((x) => [x.id, x.name]));
  const teacherOptions = (ws.setup?.teachers ?? []).map((x) => ({ value: x.id, label: x.teaches.length ? `${x.name} · ${x.teaches.map((id) => subjectName.get(id)).filter(Boolean).join(", ")}` : x.name }));

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
            {ex.outstanding.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {ex.outstanding.map((o) => <li key={o.subject}>{o.why === "NOT_ASSIGNED" ? t("adm.iw.out.notAssigned", { subject: o.subject }) : o.why === "REVIEW" ? t("adm.iw.out.review", { subject: o.subject }) : t("adm.iw.out.marking", { subject: o.subject, teacher: o.teacher ?? "" })}</li>)}
              </ul>
            )}
          </Card>

          <Card title={t("adm.iw.exams")}>
            {ex.lines.length === 0 ? <p className="text-sm text-muted">{t("adm.iw.exams.none")}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-3 font-medium">{t("exam.col.subject")}</th><th className="py-2 pr-3 font-medium">{t("exam.col.teacher")}</th><th className="py-2 pr-3 font-medium">{t("common.status")}</th><th className="py-2 pr-3 font-medium">{t("exam.col.mark")}</th><th className="py-2 font-medium" /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {ex.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 pr-3 font-medium">{l.subject}</td>
                        <td className="py-2.5 pr-3">{l.teacher}</td>
                        <td className="py-2.5 pr-3"><Badge tone={TONE[label(l.status)]}>{t(`exam.st.${label(l.status)}` as "exam.st.SUBMITTED")}</Badge></td>
                        <td className="py-2.5 pr-3 tabular-nums">{l.status === "SUBMITTED" || l.status === "APPROVED" ? markText(l) : "—"}</td>
                        <td className="py-2.5 text-right">
                          {can("admission.exam.assign") && iv.status === "SCHEDULED" && (l.status === "ASSIGNED" || l.status === "DRAFT" || l.status === "RETURNED") && (
                            <details className="inline-block text-left">
                              <summary className="cursor-pointer text-sm font-medium text-link">{t("exam.remove")}</summary>
                              <ActionForm action={removeExamAction} submitLabel={t("exam.remove")} tone="danger" className="mt-2 w-64 space-y-2">
                                <input type="hidden" name="examId" value={l.id} />
                                <Field name="reason" label={t("exam.remove.reason")} required />
                              </ActionForm>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ex.lines.some((l) => (l.status === "SUBMITTED" || l.status === "APPROVED") && l.comment) && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-muted">
                    {ex.lines.filter((l) => (l.status === "SUBMITTED" || l.status === "APPROVED") && l.comment).map((l) => <li key={l.id}><span className="font-medium text-ink">{l.subject}:</span> {l.comment}</li>)}
                  </ul>
                )}
              </div>
            )}
            {ws.setup && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="mb-1 text-sm font-semibold">{t("exam.assign.title")}</h3>
                <p className="mb-3 text-sm text-muted">{t("exam.assign.hint")}</p>
                <ActionForm action={assignExamAction} submitLabel={t("exam.assign.go")} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="interviewId" value={iv.id} />
                  <Field name="subjectId" type="select" label={t("exam.col.subject")} options={ws.setup.subjects.map((s) => ({ value: s.id, label: s.name }))} defaultValue={ws.setup.requiredSubjectIds[0] ?? ""} placeholder={t("common.select")} required />
                  <Field name="teacherId" type="select" label={t("exam.col.teacher")} options={teacherOptions} placeholder={t("common.select")} required hint={ws.setup.teachers.length === 0 ? t("exam.assign.noTeachers") : t("exam.assign.teachersHint")} />
                  <Field name="maxMark" type="number" label={t("exam.assign.max")} defaultValue={String(ws.setup.maxMark)} />
                  <Field name="dueOn" type="date" label={t("exam.assign.due")} optionalLabel={t("common.optional")} />
                  <div className="sm:col-span-2"><Field name="instructions" type="textarea" rows={2} label={t("exam.assign.instructions")} optionalLabel={t("common.optional")} /></div>
                </ActionForm>
              </div>
            )}
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
