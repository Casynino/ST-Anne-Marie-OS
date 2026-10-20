import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDateTime, toZonedInput } from "@/lib/dates";
import { getAssignment } from "@/server/assignments";
import { schoolTimezone } from "@/server/learning-access";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field, inputClass } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { FileList } from "@/components/learning/file-list";
import { attachFileAction, closeAssignmentAction, deleteAssignmentAction, gradeAction, publishAssignmentAction, recordPaperAction, releaseResultsAction, removeFileAction, reopenAssignmentAction, updateAssignmentAction } from "../actions";

export const metadata: Metadata = { title: "Assignment" };
const STATE_TONE = { DRAFT: "neutral", OPEN: "ok", CLOSED: "warn" } as const;

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["assignments.manage", "assignments.oversee"])) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getAssignment>>;
  try { d = await getAssignment(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const tz = await schoolTimezone(ctx.schoolId);
  const a = d.assignment;
  const unreleased = d.students.filter((s) => s.submission?.state === "GRADED" && !s.submission.released).length;
  const handedIn = d.students.filter((s) => s.submission).length;
  const idField = <input type="hidden" name="id" value={a.id} />;

  return (
    <>
      <PageHeader
        title={a.title}
        subtitle={`${a.className}${a.streamName ? ` ${a.streamName}` : ""} · ${a.subjectName} · ${t("learn.asg.due")}: ${displayDateTime(a.dueAt, tz, ctx.locale)}${a.maxScore !== null ? ` · ${t("learn.asg.outOf", { max: a.maxScore })}` : ""}`}
        actions={<Badge tone={STATE_TONE[a.state]}>{t(`learn.asg.state.${a.state}`)}</Badge>}
      />
      {d.canManage && (
        <div className="mb-5 flex flex-wrap items-start gap-2">
          {a.state === "DRAFT" && <ActionForm action={publishAssignmentAction} submitLabel={t("learn.asg.publish")} className="" confirm={t("learn.asg.publishConfirm")}>{idField}</ActionForm>}
          {a.state === "OPEN" && <ActionForm action={closeAssignmentAction} submitLabel={t("learn.asg.close")} inline confirm={t("learn.asg.closeConfirm")} className="">{idField}</ActionForm>}
          {a.state === "CLOSED" && <ActionForm action={reopenAssignmentAction} submitLabel={t("learn.asg.reopen")} inline className="">{idField}</ActionForm>}
          {unreleased > 0 && <ActionForm action={releaseResultsAction} submitLabel={t("learn.asg.releaseAll", { count: unreleased })} inline className="">{idField}</ActionForm>}
          {a.state === "DRAFT" && handedIn === 0 && <ActionForm action={deleteAssignmentAction} submitLabel={t("common.delete")} tone="danger" inline confirm={t("learn.asg.deleteConfirm")} className="">{idField}</ActionForm>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title={t("learn.asg.instructions")}>
            <p className="whitespace-pre-line text-ink/90">{a.instructions}</p>
          </Card>

          <section aria-labelledby="students-h">
            <h2 id="students-h" className="mb-3 text-lg font-semibold">{t("learn.asg.students")} <span className="text-sm font-normal text-muted">({handedIn}/{d.students.length})</span></h2>
            {a.state === "DRAFT" && <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">{t("learn.asg.draftNotice")}</p>}
            {a.state !== "DRAFT" && (
              <ul className="space-y-2">
                {d.students.map((s) => {
                  const sub = s.submission;
                  const status = !sub ? { tone: "neutral" as const, label: t("learn.sub.none") } : sub.state === "GRADED" ? { tone: "ok" as const, label: a.maxScore !== null ? t("learn.sub.markedScore", { score: sub.score ?? 0, max: a.maxScore }) : t("learn.sub.marked") } : sub.state === "RETURNED" ? { tone: "warn" as const, label: t("learn.sub.returned") } : { tone: "brand" as const, label: t("learn.sub.handedIn") };
                  return (
                    <li key={s.studentId} className="rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
                      <details>
                        <summary className="flex min-h-14 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-xs text-muted">{s.admissionNo}</span>
                          <span className="ml-auto flex flex-wrap items-center gap-1.5">
                            <Badge tone={status.tone}>{status.label}</Badge>
                            {sub?.late && <Badge tone="bad">{t("learn.sub.late")}</Badge>}
                            {sub?.via === "PAPER" && <Badge tone="neutral">{t("learn.sub.paper")}</Badge>}
                            {sub?.state === "GRADED" && !sub.released && <Badge tone="warn">{t("learn.sub.notShared")}</Badge>}
                          </span>
                        </summary>
                        <div className="space-y-4 border-t border-line px-4 py-4">
                          {sub ? (
                            <>
                              {sub.text && <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{t("learn.sub.answer")}{sub.revision > 1 ? ` · ${t("learn.sub.revision", { n: sub.revision })}` : ""}</p><p className="whitespace-pre-line rounded-xl bg-canvas px-3 py-2 text-sm">{sub.text}</p></div>}
                              <FileList files={sub.files} />
                              {d.canManage && (
                                <ActionForm action={gradeAction} hideSubmit className="space-y-3">
                                  <input type="hidden" name="assignmentId" value={a.id} />
                                  <input type="hidden" name="studentId" value={s.studentId} />
                                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                                    {a.maxScore !== null && <Field name="score" type="number" label={t("learn.asg.score", { max: a.maxScore })} defaultValue={sub.score ?? ""} min={0} max={a.maxScore} />}
                                    <Field name="feedback" type="textarea" rows={2} label={t("learn.asg.feedback")} optionalLabel={t("common.optional")} defaultValue={sub.feedback ?? ""} className={a.maxScore === null ? "sm:col-span-2" : ""} />
                                  </div>
                                  <Field name="release" type="checkbox" label={t("learn.asg.shareNow")} defaultValue={sub.released} />
                                  <div className="flex flex-wrap gap-2">
                                    <SubmitButton intent="GRADE">{t("learn.asg.saveMark")}</SubmitButton>
                                    <SubmitButton intent="RETURN" variant="secondary">{t("learn.asg.returnRevision")}</SubmitButton>
                                  </div>
                                  <p className="text-xs text-muted">{t("learn.asg.returnHint")}</p>
                                </ActionForm>
                              )}
                            </>
                          ) : d.canManage && a.state === "OPEN" ? (
                            <ActionForm action={recordPaperAction} submitLabel={t("learn.sub.recordPaper")} className="space-y-3">
                              <input type="hidden" name="assignmentId" value={a.id} />
                              <input type="hidden" name="studentId" value={s.studentId} />
                              <p className="text-sm text-muted">{t("learn.sub.paperHint")}</p>
                              <Field name="note" label={t("learn.sub.paperNote")} optionalLabel={t("common.optional")} />
                              <Field name="late" type="checkbox" label={t("learn.sub.paperLate")} />
                            </ActionForm>
                          ) : <p className="text-sm text-muted">{t("learn.sub.nothingYet")}</p>}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card title={t("learn.asg.worksheets")}>
            {d.files.length === 0 && <p className="mb-3 text-sm text-muted">{t("learn.asg.noFiles")}</p>}
            <FileList files={d.files} remove={d.canManage && a.state !== "CLOSED" ? (f) => <ActionForm action={removeFileAction} submitLabel={t("common.remove")} inline tone="danger" className=""><input type="hidden" name="fileId" value={f.id} /></ActionForm> : undefined} />
            {d.canManage && a.state !== "CLOSED" && (
              <ActionForm action={attachFileAction} submitLabel={t("learn.asg.attach")} className="mt-4 space-y-3">
                {idField}
                <div>
                  <label htmlFor="asg-file" className="mb-1 block text-sm font-medium">{t("learn.asg.file")}</label>
                  <input id="asg-file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link`} />
                  <p className="mt-1 text-sm text-muted">{t("learn.asg.fileHint")}</p>
                </div>
              </ActionForm>
            )}
          </Card>
          {d.canManage && a.state !== "CLOSED" && (
            <Card title={t("learn.asg.edit")}>
              <ActionForm action={updateAssignmentAction} submitLabel={t("common.save")}>
                {idField}
                <Field name="title" label={t("learn.title")} required defaultValue={a.title} />
                <Field name="instructions" type="textarea" rows={5} label={t("learn.asg.instructions")} required defaultValue={a.instructions} />
                <Field name="dueAt" type="datetime-local" label={t("learn.asg.due")} required defaultValue={toZonedInput(a.dueAt, tz)} />
                <Field name="maxScore" type="number" min={1} max={1000} label={t("learn.asg.maxScore")} optionalLabel={t("common.optional")} defaultValue={a.maxScore ?? ""} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
