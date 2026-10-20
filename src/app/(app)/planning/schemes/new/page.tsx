import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { currentTerms, myTeachingUnits } from "@/server/lesson-plans";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { WeeksEditor } from "@/components/learning/weeks-editor";
import { createSchemeAction } from "../../actions";

export const metadata: Metadata = { title: "New scheme of work" };

export default async function NewSchemePage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["plans.write"])) return <NoAccess t={t} />;
  const [units, terms] = await Promise.all([myTeachingUnits(ctx), currentTerms(ctx)]);
  return (
    <>
      <PageHeader title={t("learn.scheme.new")} subtitle={t("learn.scheme.subtitle")} />
      {units.length === 0 ? <EmptyState>{t("learn.plan.noUnits")}</EmptyState> : (
        <Card>
          <ActionForm action={createSchemeAction} submitLabel={t("learn.scheme.create")}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="unit" type="select" label={t("learn.plan.unit")} required options={units.map((u) => ({ value: `${u.classId}|${u.subjectId}`, label: `${u.className} · ${u.subjectName}` }))} />
              <Field name="termId" type="select" label={t("learn.term")} optionalLabel={t("common.optional")} placeholder={t("learn.wholeYear")} options={terms.map((x) => ({ value: x.id, label: x.name }))} />
              <Field name="title" label={t("learn.title")} required placeholder={t("learn.scheme.titlePh")} />
            </div>
            <h2 className="pt-2 text-base font-semibold">{t("learn.weeks")}</h2>
            <WeeksEditor initial={[]} labels={{ week: t("learn.week"), topic: t("learn.topic"), objectives: t("learn.objectives"), activities: t("learn.activities"), resources: t("learn.resources"), assessment: t("learn.assessment"), add: t("learn.addWeek"), remove: t("learn.removeWeek") }} />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
