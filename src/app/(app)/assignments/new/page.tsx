import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { myTeachingUnits } from "@/server/lesson-plans";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { createAssignmentAction } from "../actions";

export const metadata: Metadata = { title: "New assignment" };

export default async function NewAssignmentPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["assignments.manage"])) return <NoAccess t={t} />;
  const units = await myTeachingUnits(ctx);
  const options = units.flatMap((u) => [
    ...(u.wholeClass ? [{ value: `${u.classId}|${u.subjectId}|`, label: `${u.className} · ${u.subjectName}` }] : []),
    ...u.streams.map((s) => ({ value: `${u.classId}|${u.subjectId}|${s.id}`, label: `${u.className} ${s.name} · ${u.subjectName}` })),
  ]);
  return (
    <>
      <PageHeader title={t("learn.asg.new")} subtitle={t("learn.asg.newHint")} />
      {options.length === 0 ? <EmptyState>{t("learn.plan.noUnits")}</EmptyState> : (
        <Card>
          <ActionForm action={createAssignmentAction} submitLabel={t("learn.asg.create")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="unit" type="select" label={t("learn.plan.unit")} required options={options} />
              <Field name="title" label={t("learn.title")} required />
            </div>
            <Field name="instructions" type="textarea" rows={6} label={t("learn.asg.instructions")} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="dueAt" type="datetime-local" label={t("learn.asg.due")} required hint={t("learn.asg.dueHint")} />
              <Field name="maxScore" type="number" min={1} max={1000} label={t("learn.asg.maxScore")} optionalLabel={t("common.optional")} hint={t("learn.asg.maxScoreHint")} />
            </div>
            <p className="text-sm text-muted">{t("learn.asg.draftHint")}</p>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
