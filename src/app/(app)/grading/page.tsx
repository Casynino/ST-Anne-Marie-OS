import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { listLevels } from "@/server/academics";
import { TEMPLATES, getResultsSettings, listScales } from "@/server/grading";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { createScaleAction, deleteScaleAction, updateResultsSettingsAction, updateScaleAction } from "./actions";

export const metadata: Metadata = { title: "Grading" };

type Scale = Awaited<ReturnType<typeof listScales>>[number];
const bandsText = (s: Scale) => s.bands.map((b) => `${b.grade} | ${Number(b.minPercent)} | ${Number(b.maxPercent)}${b.points === null ? "" : ` | ${b.points}`}`).join("\n");
const divText = (s: Scale) => s.divisions.map((d) => `${d.division} | ${d.minPoints} | ${d.maxPoints}`).join("\n");

export default async function GradingPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["grading.manage"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [scales, settings, levels] = await Promise.all([listScales(ctx), getResultsSettings(db, ctx.schoolId), listLevels(ctx)]);
  const template = TEMPLATES.find((x) => x.key === sp.template);
  const levelOptions = levels.map((l) => ({ value: l.id, label: l.name }));

  const scaleFields = (s?: Scale | { name: string; bands: string; divisions: string; divisionBestN: number | null; note: string }) => {
    const isScale = s && "id" in s;
    const name = s ? s.name : "";
    const bands = s ? (isScale ? bandsText(s as Scale) : (s as { bands: string }).bands) : "A | 80 | 100 | 1\nB | 60 | 79 | 2\nC | 40 | 59 | 3\nD | 0 | 39 | 4";
    const divisions = s ? (isScale ? divText(s as Scale) : (s as { divisions: string }).divisions) : "";
    return (
      <>
        <Field name="name" label={t("grade.name")} defaultValue={name} required />
        <Field name="bands" type="textarea" rows={6} label={t("grade.bands")} defaultValue={bands} required hint={t("grade.bandsHint")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="passMark" type="number" label={t("grade.passMark")} optionalLabel={t("common.optional")} defaultValue={isScale && (s as Scale).passMark !== null ? Number((s as Scale).passMark) : ""} min={0} max={100} />
          <Field name="levelId" type="select" label={t("grade.level")} options={levelOptions} defaultValue={isScale ? ((s as Scale).levelId ?? "") : ""} placeholder={t("grade.anyLevel")} />
        </div>
        <Field name="divisions" type="textarea" rows={4} label={t("grade.divisions")} optionalLabel={t("common.optional")} defaultValue={divisions} hint={t("grade.divisionsHint")} />
        <Field name="divisionBestN" type="number" label={t("grade.bestN")} optionalLabel={t("common.optional")} defaultValue={isScale ? ((s as Scale).divisionBestN ?? "") : (s as { divisionBestN?: number | null } | undefined)?.divisionBestN ?? ""} min={1} max={20} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="isDefault" type="checkbox" label={t("grade.default")} defaultValue={isScale ? (s as Scale).isDefault : scales.length === 0} />
          <Field name="isActive" type="select" label={t("common.status")} options={[{ value: "true", label: t("common.active") }, { value: "false", label: t("common.inactive") }]} defaultValue={isScale ? String((s as Scale).isActive) : "true"} />
        </div>
        <Field name="notes" type="textarea" rows={2} label={t("grade.notes")} optionalLabel={t("common.optional")} defaultValue={isScale ? ((s as Scale).notes ?? "") : ""} />
      </>
    );
  };

  return (
    <>
      <PageHeader title={t("grade.title")} subtitle={t("grade.subtitle")} />
      <div className="mb-6 rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">{t("grade.noBuiltin")}</div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          {scales.length === 0 && <EmptyState>{t("grade.none")}</EmptyState>}
          {scales.map((s) => (
            <Card key={s.id} title={s.name} actions={<span className="flex gap-1">{s.isDefault && <Badge tone="brand">{t("grade.default")}</Badge>}{!s.isActive && <Badge>{t("common.inactive")}</Badge>}</span>}>
              <details>
                <summary className="min-h-11 cursor-pointer text-sm font-medium text-brand-800">{t("common.edit")}</summary>
                <div className="mt-3">
                  <ActionForm action={updateScaleAction} submitLabel={t("common.save")}>
                    <input type="hidden" name="id" value={s.id} />
                    {scaleFields(s)}
                  </ActionForm>
                  <div className="mt-4 border-t border-line pt-4">
                    <ActionForm action={deleteScaleAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("grade.confirmDelete")} className="space-y-0">
                      <input type="hidden" name="id" value={s.id} />
                    </ActionForm>
                  </div>
                </div>
              </details>
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-1 text-left font-medium">{t("marks.grade")}</th><th className="py-1 text-left font-medium">%</th><th className="py-1 text-left font-medium">{t("grade.points")}</th></tr></thead>
                <tbody className="divide-y divide-line">{s.bands.map((b) => <tr key={b.id}><td className="py-1 font-semibold">{b.grade}</td><td className="py-1 tabular-nums">{Number(b.minPercent)} – {Number(b.maxPercent)}</td><td className="py-1 tabular-nums">{b.points ?? "—"}</td></tr>)}</tbody>
              </table>
              {s.divisions.length > 0 && <p className="mt-3 text-sm text-muted">{t("grade.divisionLine", { n: s.divisionBestN ?? 0 })}: {s.divisions.map((d) => `${d.division} (${d.minPoints}–${d.maxPoints})`).join(", ")}</p>}
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          <Card title={t("grade.new")}>
            {TEMPLATES.length > 0 && (
              <div className="mb-4 rounded-lg border border-line bg-canvas p-3 text-sm">
                <p className="font-medium">{t("grade.templates")}</p>
                {TEMPLATES.map((x) => (
                  <p key={x.key} className="mt-1 text-muted">
                    <Link href={`/grading?template=${x.key}`} className="font-medium text-brand-800 hover:underline">{x.name}</Link> — {x.note}
                  </p>
                ))}
              </div>
            )}
            <ActionForm action={createScaleAction} submitLabel={t("grade.create")} key={template?.key ?? "blank"}>
              {scaleFields(template ? { name: template.name, bands: template.bands, divisions: template.divisions, divisionBestN: template.divisionBestN, note: template.note } : undefined)}
            </ActionForm>
          </Card>

          <Card title={t("grade.policy")}>
            <ActionForm action={updateResultsSettingsAction} submitLabel={t("common.save")}>
              <Field name="absentAs" type="select" label={t("grade.absentAs")} options={[{ value: "EXCLUDE", label: t("res.absent.EXCLUDE") }, { value: "ZERO", label: t("res.absent.ZERO") }]} defaultValue={settings.absentAs} required hint={t("grade.absentHint")} />
              <Field name="positionBy" type="select" label={t("grade.positionBy")} options={[{ value: "AVERAGE", label: t("res.rank.AVERAGE") }, { value: "TOTAL", label: t("res.rank.TOTAL") }]} defaultValue={settings.positionBy} required />
              <Field name="decimals" type="select" label={t("grade.decimals")} options={[{ value: "0", label: "0" }, { value: "1", label: "1" }, { value: "2", label: "2" }]} defaultValue={String(settings.decimals)} required />
              <Field name="requireAllMarksBeforeSubmit" type="checkbox" label={t("grade.requireAll")} defaultValue={settings.requireAllMarksBeforeSubmit} />
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
