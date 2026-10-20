import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { myTeachingUnits } from "@/server/lesson-plans";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { createLessonAction } from "../../actions";

export const metadata: Metadata = { title: "New lesson plan" };

export default async function NewLessonPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["plans.write"])) return <NoAccess t={t} />;
  const units = await myTeachingUnits(ctx);
  const options = units.flatMap((u) => [
    ...(u.wholeClass ? [{ value: `${u.classId}|${u.subjectId}|`, label: `${u.className} · ${u.subjectName}` }] : []),
    ...u.streams.map((s) => ({ value: `${u.classId}|${u.subjectId}|${s.id}`, label: `${u.className} ${s.name} · ${u.subjectName}` })),
  ]);
  return (
    <>
      <PageHeader title={t("learn.lesson.new")} subtitle={t("learn.lesson.subtitle")} />
      {options.length === 0 ? <EmptyState>{t("learn.plan.noUnits")}</EmptyState> : (
        <Card>
          <ActionForm action={createLessonAction} submitLabel={t("learn.lesson.create")}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="unit" type="select" label={t("learn.plan.unit")} required options={options} />
              <Field name="lessonDate" type="date" label={t("learn.date")} required />
              <Field name="topic" label={t("learn.topic")} required />
            </div>
            <Field name="objectives" type="textarea" rows={3} label={t("learn.objectives")} required />
            <Field name="activities" type="textarea" rows={5} label={t("learn.activities")} required />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="resources" type="textarea" rows={2} label={t("learn.resources")} optionalLabel={t("common.optional")} />
              <Field name="assessment" type="textarea" rows={2} label={t("learn.assessment")} optionalLabel={t("common.optional")} />
              <Field name="homework" type="textarea" rows={2} label={t("learn.homework")} optionalLabel={t("common.optional")} />
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
