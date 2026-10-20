import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { todayInTimezone } from "@/lib/dates";
import { behaviourStudents } from "@/server/behaviour";
import { schoolTimezone } from "@/server/learning-access";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field, inputClass } from "@/components/form";
import { recordBehaviourAction } from "../actions";

export const metadata: Metadata = { title: "Record behaviour" };
const SUGGESTIONS = ["Helping others", "Good effort", "Leadership", "Respect", "Late to class", "Homework not done", "Disruption in class", "Uniform", "Conflict with another student"];

export default async function NewBehaviourPage({ searchParams }: { searchParams: Promise<{ q?: string; studentId?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["behaviour.record"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [students, tz] = await Promise.all([behaviourStudents(ctx, sp.q ?? ""), schoolTimezone(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("learn.bh.new")} subtitle={t("learn.bh.newHint")} />
      {students.length === 0 && !sp.q ? <EmptyState>{t("learn.bh.noStudents")}</EmptyState> : (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <Card title={t("learn.bh.findStudent")}>
            <form className="flex gap-2" role="search">
              <input name="q" defaultValue={sp.q ?? ""} placeholder={t("learn.bh.searchPh")} aria-label={t("learn.bh.findStudent")} className={inputClass} />
              <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-canvas">{t("common.search")}</button>
            </form>
            <p className="mt-3 text-sm text-muted">{students.length === 40 ? t("learn.bh.refine") : t("learn.bh.matches", { count: students.length })}</p>
          </Card>
          <Card>
            <ActionForm action={recordBehaviourAction} submitLabel={t("learn.bh.save")}>
              <Field name="studentId" type="select" label={t("learn.student")} required options={students.map((s) => ({ value: s.id, label: `${s.name} (${s.admissionNo})` }))} defaultValue={sp.studentId ?? ""} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field name="type" type="select" label={t("learn.bh.type")} required options={(["POSITIVE", "CONCERN", "INCIDENT"] as const).map((x) => ({ value: x, label: t(`learn.bh.type.${x}`) }))} defaultValue="POSITIVE" />
                <Field name="occurredOn" type="date" label={t("learn.bh.date")} required defaultValue={todayInTimezone(tz)} />
                <div>
                  <label htmlFor="bh-cat" className="mb-1 block text-sm font-medium">{t("learn.bh.category")} <span aria-hidden className="text-bad">*</span></label>
                  <input id="bh-cat" name="category" required maxLength={60} list="bh-cats" className={inputClass} />
                  <datalist id="bh-cats">{SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
                </div>
              </div>
              <Field name="description" type="textarea" rows={4} label={t("learn.bh.description")} required hint={t("learn.bh.descriptionHint")} />
              <Field name="action" type="textarea" rows={2} label={t("learn.bh.action")} optionalLabel={t("common.optional")} />
              <Field name="share" type="checkbox" label={t("learn.bh.shareNow")} />
              <p className="text-sm text-muted">{t("learn.bh.noEdit")}</p>
            </ActionForm>
          </Card>
        </div>
      )}
    </>
  );
}
