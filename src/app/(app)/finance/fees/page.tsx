import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { db } from "@/lib/db";
import { centsOf } from "@/lib/finance/money";
import { getCurrentAcademicContext, listAcademicYears } from "@/server/academics";
import { listExamClasses } from "@/server/exams";
import { getFeeSettings, listFeeItems, listStructures } from "@/server/fees";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";
import { createFeeItemAction, createStructureAction, setStructureActiveAction, updateFeeItemAction, updateFeeSettingsAction, updateStructureAction } from "../actions";

export const metadata: Metadata = { title: "Fees setup" };
const CATEGORIES = ["TUITION", "TRANSPORT", "MEALS", "BOARDING", "UNIFORM", "EXAM", "ADMISSION", "OTHER"] as const;

export default async function FeesSetupPage({ searchParams }: { searchParams: Promise<{ yearId?: string }> }) {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const manage = hasAny(ctx, ["fees.manage"]);
  const [items, years, classes, current, settings, levels] = await Promise.all([
    listFeeItems(ctx),
    listAcademicYears(ctx).catch(() => []),
    listExamClasses(ctx),
    getCurrentAcademicContext(ctx.schoolId),
    getFeeSettings(db, ctx.schoolId),
    db.academicLevel.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const yearId = years.find((y) => y.id === sp.yearId)?.id ?? current.year?.id ?? years[0]?.id;
  const structures = yearId ? await listStructures(ctx, { academicYearId: yearId }) : [];
  const active = items.filter((i) => i.isActive);
  const year = years.find((y) => y.id === yearId);
  const termOptions = [{ value: "", label: t("fin.fees.everyTerm") }, ...(year?.terms ?? []).map((x) => ({ value: String(x.sequence), label: x.name }))];
  const scopeLabel = (s: { classId: string | null; levelId: string | null }) => (s.classId ? (classes.find((c) => c.id === s.classId)?.name ?? "") : s.levelId ? (levels.find((l) => l.id === s.levelId)?.name ?? "") : t("fin.fees.everyone"));

  const lineFields = (existing?: Map<string, { amount: number; termSequence: number | null }>) => (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("fin.fees.lines")}</p>
      {active.length === 0 && <p className="text-sm text-muted">{t("fin.fees.addItemsFirst")}</p>}
      {active.map((i) => {
        const e = existing?.get(i.id);
        return (
          <div key={i.id} className="grid grid-cols-[1fr_8rem_9rem] items-end gap-2">
            <span className="pb-3 text-sm">{i.name}</span>
            <Field name={`amount:${i.id}`} label={t("fin.pdf.amount")} defaultValue={e ? e.amount / 100 : ""} />
            <Field name={`term:${i.id}`} type="select" label={t("exam.term")} options={termOptions.slice(1)} placeholder={termOptions[0]!.label} defaultValue={e?.termSequence ?? ""} />
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <PageHeader title={t("fin.fees.title")} subtitle={t("fin.fees.subtitle")} />
      <FinanceNav ctx={ctx} t={t} current="/finance/fees" unmatched={unmatched} />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <Card title={t("fin.fees.items")}>
            {items.length === 0 ? <p className="text-sm text-muted">{t("fin.fees.noItems")}</p> : (
              <ul className="divide-y divide-line text-sm">
                {items.map((i) => (
                  <li key={i.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{i.name}</span><Badge tone={i.isActive ? "brand" : "neutral"}>{tDynamic(t, "fin.cat", i.category)}</Badge></div>
                    {manage && (
                      <details className="mt-1"><summary className="min-h-9 cursor-pointer text-xs text-link">{t("common.edit")}</summary>
                        <ActionForm action={updateFeeItemAction} submitLabel={t("common.save")} className="mt-2 space-y-2">
                          <input type="hidden" name="id" value={i.id} />
                          <Field name="name" label={t("grade.name")} defaultValue={i.name} required />
                          <Field name="nameSw" label={`${t("grade.name")} (SW)`} defaultValue={i.nameSw ?? ""} optionalLabel={t("common.optional")} />
                          <Field name="category" type="select" label={t("exam.category")} options={CATEGORIES.map((c) => ({ value: c, label: tDynamic(t, "fin.cat", c) }))} defaultValue={i.category} required />
                          <Field name="isActive" type="select" label={t("marks.status")} options={[{ value: "true", label: t("common.active") }, { value: "false", label: t("common.inactive") }]} defaultValue={String(i.isActive)} />
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manage && (
              <ActionForm action={createFeeItemAction} submitLabel={t("fin.fees.addItem")} className="mt-4 space-y-3 border-t border-line pt-4">
                <Field name="name" label={t("grade.name")} required placeholder={t("fin.fees.itemPh")} />
                <Field name="category" type="select" label={t("exam.category")} options={CATEGORIES.map((c) => ({ value: c, label: tDynamic(t, "fin.cat", c) }))} defaultValue="TUITION" required />
              </ActionForm>
            )}
          </Card>
          {manage && (
            <Card title={t("fin.fees.settings")}>
              <ActionForm action={updateFeeSettingsAction} submitLabel={t("common.save")}>
                <Field name="defaultDueDays" type="number" label={t("fin.fees.dueDays")} defaultValue={settings.defaultDueDays} min={0} max={120} required />
                <Field name="clearanceMaxOutstanding" label={t("fin.fees.clearance")} defaultValue={settings.clearanceMaxOutstandingCents / 100} hint={t("fin.fees.clearanceHint")} />
                <Field name="paymentInstructions" type="textarea" rows={4} label={t("fin.fees.instructions")} defaultValue={settings.paymentInstructions} optionalLabel={t("common.optional")} hint={t("fin.fees.instructionsHint")} />
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
            <Field name="yearId" type="select" label={t("fin.fees.year")} options={years.map((y) => ({ value: y.id, label: y.name }))} defaultValue={yearId ?? ""} />
            <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("common.filter")}</button>
          </form>
          <h2 className="text-lg font-semibold">{t("fin.fees.structures")}</h2>
          <p className="-mt-4 text-sm text-muted">{t("fin.fees.structuresHint")}</p>
          {structures.length === 0 && <EmptyState>{t("fin.fees.noStructures")}</EmptyState>}
          {structures.map((s) => {
            const existing = new Map(s.lines.map((l) => [l.feeItemId, { amount: centsOf(l.amount), termSequence: l.termSequence }]));
            const total = s.lines.filter((l) => l.termSequence === null).reduce((n, l) => n + centsOf(l.amount), 0);
            return (
              <Card key={s.id} title={`${s.name} · ${scopeLabel(s)}`} actions={<Badge tone={s.isActive ? "ok" : "neutral"}>{s.isActive ? t("common.active") : t("common.inactive")}</Badge>}>
                <ul className="divide-y divide-line text-sm">
                  {s.lines.map((l) => <li key={l.id} className="flex justify-between py-1.5"><span>{l.feeItem.name} <span className="text-xs text-muted">{l.termSequence === null ? t("fin.fees.everyTerm") : (year?.terms.find((x) => x.sequence === l.termSequence)?.name ?? `#${l.termSequence}`)}</span></span><span className="tabular-nums">{money(centsOf(l.amount))}</span></li>)}
                </ul>
                <p className="mt-2 text-sm font-medium">{t("fin.fees.perTerm", { amount: money(total) })}</p>
                {manage && (
                  <details className="mt-3 border-t border-line pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-link">{t("common.edit")}</summary>
                    <p className="mt-2 text-xs text-muted">{t("fin.fees.editHint")}</p>
                    <ActionForm action={updateStructureAction} submitLabel={t("common.save")} className="mt-3 space-y-3">
                      <input type="hidden" name="id" value={s.id} /><input type="hidden" name="academicYearId" value={s.academicYearId} />
                      {s.levelId && <input type="hidden" name="levelId" value={s.levelId} />}{s.classId && <input type="hidden" name="classId" value={s.classId} />}
                      <Field name="name" label={t("grade.name")} defaultValue={s.name} required />
                      {lineFields(existing)}
                    </ActionForm>
                    <ActionForm action={setStructureActiveAction} submitLabel={s.isActive ? t("fin.fees.deactivate") : t("fin.fees.activate")} inline tone={s.isActive ? "danger" : "neutral"} className="mt-3 space-y-0"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={s.isActive ? "false" : "true"} /></ActionForm>
                  </details>
                )}
              </Card>
            );
          })}
          {manage && yearId && (
            <Card title={t("fin.fees.newStructure")}>
              <ActionForm action={createStructureAction} submitLabel={t("fin.fees.createStructure")}>
                <input type="hidden" name="academicYearId" value={yearId} />
                <Field name="name" label={t("grade.name")} required placeholder={t("fin.fees.structurePh")} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} placeholder={t("fin.fees.noClass")} />
                  <Field name="levelId" type="select" label={t("grade.level")} options={levels.map((l) => ({ value: l.id, label: l.name }))} placeholder={t("fin.fees.noLevel")} />
                </div>
                <p className="text-sm text-muted">{t("fin.fees.scopeHint")}</p>
                {lineFields()}
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
