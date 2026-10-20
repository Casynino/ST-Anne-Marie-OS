import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { listPeriods } from "@/server/timetable";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { createPeriodAction, deletePeriodAction, updatePeriodAction } from "../actions";

export const metadata: Metadata = { title: "Lesson periods" };

export default async function PeriodsPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["timetable.manage"])) return <NoAccess t={t} />;
  const periods = await listPeriods(ctx);
  return (
    <>
      <PageHeader title={t("learn.periods.title")} subtitle={t("learn.periods.subtitle")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          {periods.length === 0 && <EmptyState>{t("learn.periods.none")}</EmptyState>}
          {periods.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-center gap-3">
                <p className="display text-xl text-heading">{p.name}</p>
                <span className="text-sm tabular-nums text-muted">{p.startTime}–{p.endTime}</span>
                {p.isBreak && <Badge tone="warn">{t("learn.tt.break")}</Badge>}
              </div>
              <details className="mt-3">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-link">{t("common.edit")}</summary>
                <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
                  <ActionForm action={updatePeriodAction} submitLabel={t("common.save")} className="grid gap-3 sm:grid-cols-4">
                    <input type="hidden" name="id" value={p.id} />
                    <Field name="name" label={t("learn.periods.name")} required defaultValue={p.name} />
                    <Field name="startTime" type="time" label={t("learn.periods.start")} required defaultValue={p.startTime} />
                    <Field name="endTime" type="time" label={t("learn.periods.end")} required defaultValue={p.endTime} />
                    <Field name="isBreak" type="checkbox" label={t("learn.periods.isBreak")} defaultValue={p.isBreak} className="self-end" />
                  </ActionForm>
                  <ActionForm action={deletePeriodAction} submitLabel={t("common.delete")} tone="danger" confirm={t("learn.periods.deleteConfirm")} inline>
                    <input type="hidden" name="id" value={p.id} />
                  </ActionForm>
                </div>
              </details>
            </Card>
          ))}
        </div>
        <Card title={t("learn.periods.new")}>
          <ActionForm action={createPeriodAction} submitLabel={t("learn.periods.add")}>
            <Field name="name" label={t("learn.periods.name")} required placeholder="P1" />
            <div className="grid grid-cols-2 gap-3">
              <Field name="startTime" type="time" label={t("learn.periods.start")} required />
              <Field name="endTime" type="time" label={t("learn.periods.end")} required />
            </div>
            <Field name="isBreak" type="checkbox" label={t("learn.periods.isBreak")} />
            <p className="text-sm text-muted">{t("learn.periods.hint")}</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
