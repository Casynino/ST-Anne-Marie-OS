import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listImportBatches, MAX_IMPORT_BYTES } from "@/server/import";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm } from "@/components/form";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { inputClass } from "@/components/form";
import { uploadImportAction } from "./actions";

export const metadata: Metadata = { title: "Import students" };
const TONE = { PREVIEW: "warn", IMPORTED: "ok", FAILED: "bad", CANCELLED: "neutral" } as const;

export default async function ImportPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("student.import") || !ctx.permissions.has("student.create") || !ctx.permissions.has("guardian.manage")) return <NoAccess t={t} />;
  const [batches, school] = await Promise.all([listImportBatches(ctx), getSchoolBasics(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("imp.title")} subtitle={t("imp.intro")} />
      <div className="space-y-5">
        <Card title={t("imp.formats.title")}>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {(["imp.formats.1", "imp.formats.2", "imp.formats.3", "imp.formats.4", "imp.formats.5"] as const).map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
          <a href="/api/import/template" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-link hover:bg-canvas btn-secondary">
            <Download className="size-4" aria-hidden /> {t("imp.template")}
          </a>
        </Card>
        <Card title={t("imp.upload")}>
          <ActionForm action={uploadImportAction} submitLabel={t("imp.upload")} className="space-y-3">
            <div>
              <label htmlFor="import-file" className="mb-1 block text-sm font-medium">{t("imp.file")}</label>
              <input id="import-file" name="file" type="file" required accept=".csv,text/csv" className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link`} />
              <p className="mt-1 text-sm text-muted">{t("imp.file.hint")} ({Math.floor(MAX_IMPORT_BYTES / 1_000_000)} MB)</p>
            </div>
          </ActionForm>
        </Card>
        <Card title={t("imp.recent")}>
          {batches.length === 0 ? (
            <p className="text-sm text-muted">{t("imp.none")}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/students/import/${b.id}`} className="font-medium text-link hover:underline">{b.fileName}</Link>
                    <span className="ml-2 text-muted">{displayDateTime(b.createdAt, school.timezone, ctx.locale)}</span>
                  </span>
                  <Badge tone={TONE[b.status]}>{t(`imp.batch.${b.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
