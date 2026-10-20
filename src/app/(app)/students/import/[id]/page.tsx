import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { describeMessage } from "@/lib/import/messages";
import { getImportBatch } from "@/server/import";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Stat, Td } from "@/components/ui";
import { cancelImportAction, confirmImportAction } from "../actions";

export const metadata: Metadata = { title: "Check import" };
const ROW_TONE = { VALID: "ok", WARNING: "warn", ERROR: "bad", DUPLICATE: "neutral", IMPORTED: "ok", SKIPPED: "neutral" } as const;

export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("student.import")) return <NoAccess t={t} />;
  const { id } = await params;
  let batch: Awaited<ReturnType<typeof getImportBatch>>;
  try {
    batch = await getImportBatch(ctx, id);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  const s = batch.summary;
  const idxOf = (f: string) => batch.columns.findIndex((c) => c.field === f);
  const nameOf = (cells: string[]) => [cells[idxOf("firstName")], cells[idxOf("lastName")]].filter(Boolean).join(" ") || "—";
  const pending = batch.status === "PREVIEW";

  return (
    <>
      <PageHeader title={pending ? t("imp.preview.title") : t("imp.done.title")} subtitle={batch.fileName} actions={<Link href="/students/import" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas">{t("common.back")}</Link>} />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label={t("imp.total")} value={s.total} />
          <Stat label={t("imp.valid")} value={s.valid} />
          <Stat label={t("imp.warning")} value={s.warning} />
          <Stat label={t("imp.error")} value={s.error} />
          <Stat label={t("imp.duplicate")} value={s.duplicate} />
        </div>

        {batch.status === "IMPORTED" && (
          <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-ok">
            {t("imp.done.summary", { imported: s.imported ?? 0, skipped: s.skipped ?? 0, errors: s.error, duplicates: s.duplicate })}{" "}
            <Link href="/students" className="font-semibold underline">{t("imp.view.students")}</Link>
          </p>
        )}

        {pending && (
          <Card>
            {s.valid + s.warning === 0 ? (
              <p className="text-sm">{t("imp.nothing")}</p>
            ) : (
              <ActionForm action={confirmImportAction} submitLabel={t("imp.confirm", { count: s.valid })} hideSubmit={s.valid === 0 && s.warning === 0} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <p className="text-sm text-muted">{t("imp.confirm.hint")}</p>
                {s.warning > 0 && <Field name="includeWarnings" type="checkbox" label={t("imp.includeWarnings", { count: s.warning })} />}
              </ActionForm>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ActionForm action={cancelImportAction} inline tone="danger" submitLabel={t("imp.cancel")} confirm={t("common.confirmAction")} className="inline">
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            </div>
          </Card>
        )}

        {(s.error + s.duplicate + s.warning > 0 || (batch.status === "IMPORTED" && (s.skipped ?? 0) > 0)) && (
          <a href={`/api/import/${id}/errors`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-link hover:bg-canvas">
            <Download className="size-4" aria-hidden /> {t("imp.report")}
          </a>
        )}

        <Card title={t("imp.columns")}>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {batch.columns.map((c, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-line py-1">
                <span className="break-all font-medium">{c.header || "—"}</span>
                {c.field ? <span className="text-ok">{t(`imp.field.${c.field as "firstName"}`)}</span> : <span className="text-muted">{t("imp.column.ignored")}</span>}
              </li>
            ))}
          </ul>
        </Card>

        {batch.problems.length > 0 && (
          <section aria-label={t("imp.problems")}>
            <h2 className="mb-2 text-base font-semibold">{t("imp.problems")}</h2>
            <DataTable head={[t("imp.report.row"), t("common.name"), t("common.status"), t("imp.report.problem")]}>
              {batch.problems.map((r) => (
                <tr key={r.id}>
                  <Td className="tabular-nums">{r.rowNumber}</Td>
                  <Td>{nameOf(r.cells)}</Td>
                  <Td><Badge tone={ROW_TONE[r.status]}>{t(`imp.status.${r.status}`)}</Badge></Td>
                  <Td>
                    <ul className="space-y-1">
                      {r.messages.map((m, i) => (
                        <li key={i}>{describeMessage(t, m)}</li>
                      ))}
                    </ul>
                  </Td>
                </tr>
              ))}
            </DataTable>
            {s.error + s.duplicate + s.warning > 200 && <p className="mt-2 text-sm text-muted">{t("imp.problems.more")}</p>}
          </section>
        )}

        {batch.sample.length > 0 && (
          <section aria-label={t("imp.sample")}>
            <h2 className="mb-2 text-base font-semibold">{t("imp.sample")}</h2>
            <DataTable head={[t("imp.report.row"), t("common.name"), t("student.dob"), t("common.status")]}>
              {batch.sample.map((r) => (
                <tr key={r.id}>
                  <Td className="tabular-nums">{r.rowNumber}</Td>
                  <Td>{nameOf(r.cells)}</Td>
                  <Td>{r.cells[idxOf("dateOfBirth")] ?? ""}</Td>
                  <Td><Badge tone={ROW_TONE[r.status]}>{t(`imp.status.${r.status}`)}</Badge></Td>
                </tr>
              ))}
            </DataTable>
          </section>
        )}
      </div>
    </>
  );
}
