import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDateTime } from "@/lib/dates";
import { getChildAssignment } from "@/server/assignments";
import { childOrThrow } from "@/server/portal";
import { schoolTimezone } from "@/server/learning-access";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Field, inputClass } from "@/components/form";
import { FileList } from "@/components/learning/file-list";
import { removeMyFileAction, submitWorkAction } from "../../../actions";

export const metadata: Metadata = { title: "Homework" };

export default async function ChildAssignmentPage({ params }: { params: Promise<{ studentId: string; assignmentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId, assignmentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId) || !/^[0-9a-f-]{36}$/i.test(assignmentId)) notFound();
  try {
    const child = await childOrThrow(ctx, studentId);
    const [d, tz] = await Promise.all([getChildAssignment(ctx, studentId, assignmentId), schoolTimezone(ctx.schoolId)]);
    const a = d.assignment;
    const s = d.submission;
    return (
      <>
        <Link href={`/family/${studentId}/assignments`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("learn.fam.homework")}</Link>
        <PageHeader title={a.title} subtitle={`${a.subjectName} · ${t("learn.asg.due")}: ${displayDateTime(a.dueAt, tz, ctx.locale)}${a.maxScore !== null ? ` · ${t("learn.asg.outOf", { max: a.maxScore })}` : ""}`} actions={a.closed ? <Badge tone="neutral">{t("learn.fam.closed")}</Badge> : undefined} />
        <div className="space-y-5">
          <Card title={t("learn.asg.instructions")}>
            <p className="whitespace-pre-line">{a.instructions}</p>
            {d.files.length > 0 && <div className="mt-4"><FileList files={d.files} /></div>}
          </Card>

          {s && (
            <Card title={t("learn.fam.myWork", { name: child.name })}>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone={s.state === "GRADED" ? "ok" : s.state === "RETURNED" ? "warn" : "brand"}>{s.state === "GRADED" ? t("learn.sub.marked") : s.state === "RETURNED" ? t("learn.sub.returned") : t("learn.sub.handedIn")}</Badge>
                {s.late && <Badge tone="bad">{t("learn.sub.late")}</Badge>}
                {s.via === "PAPER" && <Badge tone="neutral">{t("learn.sub.paper")}</Badge>}
                <span className="text-sm text-muted">{displayDateTime(s.submittedAt, tz, ctx.locale)}</span>
              </div>
              {s.text && <p className="whitespace-pre-line rounded-xl bg-canvas px-3 py-2 text-sm">{s.text}</p>}
              <div className="mt-3"><FileList files={d.submissionFiles} remove={d.canSubmit ? (f) => <ActionForm action={removeMyFileAction} submitLabel={t("common.remove")} inline tone="danger" className=""><input type="hidden" name="fileId" value={f.id} /></ActionForm> : undefined} /></div>
              {s.released && (
                <div className="mt-4 rounded-2xl border border-tint-2 bg-tint p-4">
                  {s.score !== null && a.maxScore !== null && <p className="display text-3xl text-heading">{s.score} <span className="text-lg text-link">/ {a.maxScore}</span></p>}
                  {s.feedback && <p className="mt-1 whitespace-pre-line text-sm"><strong>{t("learn.fam.teacherSays")}:</strong> {s.feedback}</p>}
                </div>
              )}
              {s.state === "SUBMITTED" && !s.released && <p className="mt-3 text-sm text-muted">{t("learn.fam.waiting")}</p>}
            </Card>
          )}

          {d.canSubmit ? (
            <Card title={s ? t("learn.fam.handInAgain") : t("learn.fam.handIn")}>
              <ActionForm action={submitWorkAction} submitLabel={s ? t("learn.fam.resubmit") : t("learn.fam.submit")}>
                <input type="hidden" name="assignmentId" value={a.id} />
                <Field name="text" type="textarea" rows={6} label={t("learn.sub.answer")} defaultValue={s?.text ?? ""} />
                <div>
                  <label htmlFor="work-files" className="mb-1 block text-sm font-medium">{t("learn.fam.files")} <span className="font-normal text-muted">({t("common.optional")})</span></label>
                  <input id="work-files" name="file" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link`} />
                  <p className="mt-1 text-sm text-muted">{d.filesEnabled ? t("learn.fam.filesHint") : t("learn.fam.filesOff")}</p>
                </div>
              </ActionForm>
            </Card>
          ) : ctx.userType === "GUARDIAN" && !s && !a.closed ? <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">{t("learn.fam.parentNote")}</p> : null}
        </div>
      </>
    );
  } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
}
