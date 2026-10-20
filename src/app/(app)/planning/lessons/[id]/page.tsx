import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { formatDateOnly, displayDate } from "@/lib/dates";
import { getLessonPlan } from "@/server/lesson-plans";
import { Badge, Card, DefList, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { ReviewBox } from "@/components/learning/review-box";
import { STATUS_TONE } from "@/lib/learning/labels";
import { reflectLessonAction, reviewLessonAction, submitLessonAction, updateLessonAction } from "../../actions";

export const metadata: Metadata = { title: "Lesson plan" };

export default async function LessonPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["plans.write", "plans.review"])) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let p: Awaited<ReturnType<typeof getLessonPlan>>;
  try { p = await getLessonPlan(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  return (
    <>
      <PageHeader title={p.topic} subtitle={`${p.className} · ${p.subjectName} · ${displayDate(p.lessonDate, ctx.locale)} · ${p.teacherName}`} actions={<Badge tone={STATUS_TONE[p.status]}>{t(`learn.status.${p.status}`)}</Badge>} />
      {p.reviewNote && <p role="note" className="mb-4 rounded-xl border border-warn/30 bg-amber-50 px-4 py-3 text-sm"><strong>{t("learn.plan.reviewerNote")}:</strong> {p.reviewNote}</p>}
      <div className="space-y-6">
        {p.editable ? (
          <Card>
            <ActionForm action={updateLessonAction} submitLabel={t("common.save")}>
              <input type="hidden" name="id" value={p.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="lessonDate" type="date" label={t("learn.date")} required defaultValue={formatDateOnly(p.lessonDate)} />
                <Field name="topic" label={t("learn.topic")} required defaultValue={p.topic} />
              </div>
              <Field name="objectives" type="textarea" rows={3} label={t("learn.objectives")} required defaultValue={p.objectives} />
              <Field name="activities" type="textarea" rows={5} label={t("learn.activities")} required defaultValue={p.activities} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field name="resources" type="textarea" rows={2} label={t("learn.resources")} optionalLabel={t("common.optional")} defaultValue={p.resources ?? ""} />
                <Field name="assessment" type="textarea" rows={2} label={t("learn.assessment")} optionalLabel={t("common.optional")} defaultValue={p.assessment ?? ""} />
                <Field name="homework" type="textarea" rows={2} label={t("learn.homework")} optionalLabel={t("common.optional")} defaultValue={p.homework ?? ""} />
              </div>
            </ActionForm>
          </Card>
        ) : (
          <Card>
            <DefList items={([["objectives", p.objectives], ["activities", p.activities], ["resources", p.resources], ["assessment", p.assessment], ["homework", p.homework]] as const).filter(([, v]) => v).map(([k, v]) => ({ label: t(`learn.${k}`), value: <span className="whitespace-pre-line">{v}</span> }))} />
          </Card>
        )}
        {p.editable && (
          <Card title={t("learn.plan.sendTitle")}>
            <p className="mb-3 text-sm text-muted">{t("learn.plan.sendHint")}</p>
            <ActionForm action={submitLessonAction} submitLabel={t("learn.plan.submit")}><input type="hidden" name="id" value={p.id} /></ActionForm>
          </Card>
        )}
        {p.canReview && <ReviewBox id={p.id} action={reviewLessonAction} labels={{ title: t("learn.plan.review"), send: t("learn.plan.sendReview"), decision: t("learn.plan.decision"), approve: t("learn.plan.approve"), return: t("learn.plan.return"), note: t("learn.plan.note"), noteHint: t("learn.plan.noteHint") }} />}
        {p.own && (
          <Card title={t("learn.lesson.reflection")}>
            <ActionForm action={reflectLessonAction} submitLabel={t("common.save")}>
              <input type="hidden" name="id" value={p.id} />
              <Field name="reflection" type="textarea" rows={4} label={t("learn.lesson.reflectionHint")} required defaultValue={p.reflection ?? ""} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
