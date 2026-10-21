import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { getExam, type ExamDetail } from "@/server/admission-exams";
import { ActionForm, Field } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, DefList, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { reviewExamAction, saveMarksAction } from "../actions";

export const metadata: Metadata = { title: "Applicant examination" };
const TONE = { SCHEDULED: "neutral", AWAITING_MARKING: "warn", MARKING: "brand", SUBMITTED: "ok", AWAITING_REVIEW: "warn", RETURNED: "bad", APPROVED: "ok", CANCELLED: "neutral" } as const;

/** One applicant's examination in one subject: the teacher marks and submits here, without opening the application. */
export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const has = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!has("admission.exam.mark") && !has("admission.exam.review") && !has("admission.exam.assign") && !has("admission.read")) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let e: ExamDetail;
  try {
    e = await getExam(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError) return <EmptyState>{err.message}</EmptyState>;
    throw err;
  }
  const school = await getSchoolBasics(ctx.schoolId);
  const done = e.status === "SUBMITTED" || e.status === "APPROVED";
  return (
    <>
      <PageHeader title={`${e.applicant} · ${e.subject}`} subtitle={`${e.applicationNo}${e.className ? ` · ${e.className}` : ""}`} actions={<Link href="/applicant-exams" className="text-sm font-medium text-link hover:underline">{t("appexam.back")}</Link>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {e.returnNote && e.status === "RETURNED" && (
            <p role="alert" className="rounded-lg border border-bad/30 bg-red-50 px-3 py-2 text-sm text-bad"><span className="font-semibold">{t("exam.returned")}</span> {e.returnNote}</p>
          )}
          <Card title={t("exam.examination")} actions={<Badge tone={TONE[e.label]}>{t(`exam.st.${e.label}` as "exam.st.SUBMITTED")}</Badge>}>
            <DefList items={[
              { label: t("exam.col.subject"), value: e.subject },
              { label: t("exam.col.interview"), value: `${displayDateTime(e.interviewAt, school.timezone, ctx.locale)}${e.venue ? ` · ${e.venue}` : ""}` },
              { label: t("exam.col.due"), value: e.dueOn ? displayDate(e.dueOn, ctx.locale) : null },
              { label: t("exam.max"), value: String(e.maxMark) },
              { label: t("exam.col.teacher"), value: e.teacher },
              { label: t("exam.instructions"), value: e.instructions },
            ]} />
          </Card>

          {e.canMark ? (
            <Card title={t("exam.marking")}>
              <ActionForm action={saveMarksAction} hideSubmit className="max-w-md space-y-4">
                <input type="hidden" name="examId" value={e.id} />
                <Field name="mark" type="text" label={t("exam.markOutOf", { max: String(e.maxMark) })} defaultValue={e.mark ?? ""} hint={t("exam.mark.hint")} />
                {e.outcomes.length > 0 && <Field name="outcome" type="select" label={t("exam.outcome")} optionalLabel={t("common.optional")} options={e.outcomes.map((o) => ({ value: o, label: o }))} defaultValue={e.outcome ?? ""} placeholder={t("exam.outcome.none")} />}
                <Field name="comment" type="textarea" rows={3} label={t("exam.comment")} optionalLabel={t("common.optional")} defaultValue={e.comment ?? ""} hint={t("exam.comment.hint")} />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton intent="SAVE" variant="secondary">{t("exam.save")}</SubmitButton>
                  <SubmitButton intent="SUBMIT" confirm={t("exam.submit.confirm")}>{t("exam.submit")}</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          ) : (
            <Card title={t("exam.result")}>
              {e.markBlocked && <p className="mb-3 text-sm text-muted">{e.markBlocked}</p>}
              {e.mark !== null || e.outcome ? (
                <DefList items={[{ label: t("exam.col.mark"), value: e.mark !== null ? `${e.mark} / ${e.maxMark}` : e.outcome }, { label: t("exam.comment"), value: e.comment }]} />
              ) : <p className="text-sm text-muted">{e.mine ? t("exam.result.none") : t("exam.result.hidden")}</p>}
              {done && e.mine && <p className="mt-3 text-sm text-muted">{t("exam.submitted.note")}</p>}
            </Card>
          )}

          {e.canReview && (
            <Card title={t("exam.review")}>
              <ActionForm action={reviewExamAction} hideSubmit className="max-w-md space-y-3">
                <input type="hidden" name="examId" value={e.id} />
                <Field name="note" type="textarea" rows={2} label={t("exam.review.note")} optionalLabel={t("common.optional")} hint={t("exam.review.noteHint")} />
                <div className="flex flex-wrap gap-2">
                  {e.status === "SUBMITTED" && <SubmitButton intent="APPROVE">{t("exam.approve")}</SubmitButton>}
                  <SubmitButton intent="RETURN" variant="secondary" confirm={t("exam.return.confirm")}>{t("exam.return")}</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>

        <Card title={t("exam.history")}>
          {e.history.length === 0 ? <p className="text-sm text-muted">{t("exam.history.none")}</p> : (
            <ol className="space-y-3 text-sm">
              {e.history.map((h, i) => (
                <li key={i}><span className="font-medium">{t(`exam.ev.${h.kind}` as "exam.ev.SUBMIT")}</span><span className="block text-xs text-muted">{h.by} · {displayDateTime(h.at, school.timezone, ctx.locale)}</span></li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
