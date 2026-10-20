import Link from "next/link";
import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamClasses, listExamTerms } from "@/server/exams";
import { getReportCardSettings, listClassReportCards } from "@/server/report-cards";
import { db } from "@/lib/db";
import { Badge, Card, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { generateCardsAction, publishCardsAction, updateCardSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Report cards" };
type Search = { termId?: string; classId?: string; streamId?: string };
const TONE = { GENERATED: "warn", PUBLISHED: "ok", WITHDRAWN: "bad" } as const;

export default async function ReportCardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["reportcard.read", "remarks.class", "remarks.head"])) return <NoAccess t={t} />;
  const canRead = hasAny(ctx, ["reportcard.read"]);
  const sp = await searchParams;
  const [terms, classes, current] = await Promise.all([listExamTerms(ctx), listExamClasses(ctx), getCurrentAcademicContext(ctx.schoolId)]);
  const termId = sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : (current.term?.id ?? terms[0]?.id);
  const cls = classes.find((c) => c.id === sp.classId);
  const streamId = cls?.streams.some((s) => s.id === sp.streamId) ? sp.streamId : undefined;
  const canGenerate = hasAny(ctx, ["reportcard.generate"]);
  const canPublish = hasAny(ctx, ["reportcard.publish"]);

  let data: Awaited<ReturnType<typeof listClassReportCards>> | null = null;
  let problem: string | null = null;
  if (canRead && termId && cls) {
    try {
      data = await listClassReportCards(ctx, { termId, classId: cls.id, streamId });
    } catch (e) {
      if (e instanceof AppError) problem = e.message;
      else throw e;
    }
  }
  const settings = canPublish ? await getReportCardSettings(db, ctx.schoolId) : null;
  const q = `termId=${termId ?? ""}&classId=${cls?.id ?? ""}${streamId ? `&streamId=${streamId}` : ""}`;
  const hidden = (
    <>
      <input type="hidden" name="termId" value={termId ?? ""} />
      <input type="hidden" name="classId" value={cls?.id ?? ""} />
      {streamId && <input type="hidden" name="streamId" value={streamId} />}
    </>
  );

  return (
    <>
      <PageHeader
        title={t("rc.page.title")}
        subtitle={t("rc.page.subtitle")}
        actions={hasAny(ctx, ["remarks.class", "remarks.head"]) && cls ? <Link href={`/report-cards/remarks?${q}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-canvas">{t("rc.remarks.open")}</Link> : undefined}
      />
      <FilterBar t={t} resetHref="/report-cards">
        <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={termId ?? ""} />
        <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={sp.classId ?? ""} placeholder={t("res.chooseClass")} />
        {cls && cls.streams.length > 0 && <Field name="streamId" type="select" label={t("exam.stream")} options={cls.streams.map((s) => ({ value: s.id, label: s.name }))} defaultValue={streamId ?? ""} placeholder={t("res.allStreams")} />}
      </FilterBar>

      {!cls ? (
        <EmptyState>{t("res.pick")}</EmptyState>
      ) : !canRead ? (
        <EmptyState>{t("rc.remarksOnly")}</EmptyState>
      ) : problem ? (
        <EmptyState>{problem}</EmptyState>
      ) : !data ? null : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={data.coverage.complete ? "ok" : "warn"}>{data.coverage.complete ? t("res.complete") : t("res.incomplete")}</Badge>
            <span className="text-muted">{t("res.coverage", { counted: data.coverage.counted, total: data.coverage.total })}</span>
          </div>
          {!data.hasScale && <div role="alert" className="mb-4 rounded-lg border border-warn/30 bg-amber-50 px-4 py-3 text-sm text-warn">{t("res.noScale")}</div>}
          {!data.coverage.complete && <p className="mb-4 text-sm text-muted">{t("rc.needLocked")}</p>}

          <div className="mb-5 flex flex-wrap items-start gap-3">
            {canGenerate && <ActionForm action={generateCardsAction} submitLabel={t("rc.generate")} className="space-y-0">{hidden}</ActionForm>}
            {canPublish && <ActionForm action={publishCardsAction} submitLabel={t("rc.publish")} className="space-y-0" confirm={t("rc.publish.confirm")}>{hidden}</ActionForm>}
            {data.rows.some((r) => r.card && r.card.status !== "WITHDRAWN") && (
              <a href={`/api/report-cards/class?${q}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-canvas"><FileDown className="size-4" aria-hidden />{t("rc.printAll")}</a>
            )}
          </div>

          <DataTable head={[t("marks.student"), t("res.average"), t("res.pos"), t("rc.remarks"), t("marks.status"), ""]} empty={data.rows.length ? undefined : <p className="px-4 py-8 text-center text-sm text-muted">{t("res.noStudents")}</p>}>
            {data.rows.map((r) => (
              <tr key={r.studentId} className={r.studentStatus !== "ENROLLED" ? "text-muted" : undefined}>
                <Td><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.admissionNo}</p></Td>
                <Td className="tabular-nums">{r.average === null ? "—" : r.average.toFixed(1)}</Td>
                <Td className="tabular-nums">{r.position ?? "—"}</Td>
                <Td className="text-xs">{t("rc.remarks.class")}: {r.hasClassRemark ? "✓" : "—"} · {t("rc.remarks.head")}: {r.hasHeadRemark ? "✓" : "—"}</Td>
                <Td>{r.card ? <><Badge tone={TONE[r.card.status]}>{t(`rc.status.${r.card.status}` as never)}</Badge>{r.card.version > 1 && <span className="ml-1 text-xs text-muted">v{r.card.version}</span>}</> : <span className="text-sm text-muted">{t("rc.status.none")}</span>}</Td>
                <Td className="text-right">{r.card && <Link href={`/report-cards/${r.card.id}`} className="text-sm font-semibold text-link hover:underline">{t("common.view")}</Link>}</Td>
              </tr>
            ))}
          </DataTable>
          {data.rows.some((r) => r.card?.publishedAt) && <p className="mt-3 text-xs text-muted">{t("rc.lastPublished", { date: displayDate(data.rows.map((r) => r.card?.publishedAt).filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0], ctx.locale) })}</p>}
          {settings && (
            <Card title={t("rc.settings")} className="mt-8 max-w-xl">
              <ActionForm action={updateCardSettingsAction} submitLabel={t("common.save")}>
                <Field name="requireFinancialClearance" type="checkbox" label={t("rc.settings.clearance")} defaultValue={settings.requireFinancialClearance} />
                <p className="text-sm text-muted">{t("rc.settings.clearanceHint")}</p>
              </ActionForm>
            </Card>
          )}
        </>
      )}
    </>
  );
}
