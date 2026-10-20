import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getReportCard } from "@/server/report-cards";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { ReportCardView } from "@/components/results/report-card-view";
import { withdrawCardAction } from "../actions";

export const metadata: Metadata = { title: "Report card" };
const TONE = { GENERATED: "warn", PUBLISHED: "ok", WITHDRAWN: "bad" } as const;

export default async function ReportCardPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["reportcard.read"])) return <NoAccess t={t} />;
  const { id } = await params;
  let card: Awaited<ReturnType<typeof getReportCard>>;
  try {
    card = await getReportCard(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const s = card.snapshot;
  return (
    <>
      <PageHeader
        title={s.student.name}
        subtitle={`${s.class.name}${s.class.stream ? ` ${s.class.stream}` : ""} · ${s.term.name}, ${s.term.year}`}
        actions={
          <>
            <Badge tone={TONE[card.status]}>{t(`rc.status.${card.status}` as never)}</Badge>
            <a href={`/api/report-cards/${card.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"><FileDown className="size-4" aria-hidden />{t("rc.pdf")}</a>
            <Link href={`/report-cards?termId=${card.termId}&classId=${card.classId}${card.streamId ? `&streamId=${card.streamId}` : ""}`} className="text-sm font-medium text-link hover:underline">{t("rc.page.title")}</Link>
          </>
        }
      />
      {card.status === "WITHDRAWN" && card.withdrawReason && <div role="note" className="mb-4 rounded-lg border border-bad/30 bg-red-50 px-4 py-3 text-sm"><p className="font-medium text-bad">{t("rc.withdrawn.title")}</p><p className="mt-1">{card.withdrawReason}</p></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <ReportCardView snap={s} t={t} />
        {hasAny(ctx, ["reportcard.publish"]) && card.status !== "WITHDRAWN" && (
          <Card title={t("rc.withdraw")} className="h-fit">
            <ActionForm action={withdrawCardAction} submitLabel={t("rc.withdraw")} tone="danger" confirm={t("rc.withdraw.confirm")}>
              <input type="hidden" name="id" value={card.id} />
              <Field name="reason" type="textarea" label={t("marks.reason")} required rows={3} hint={t("rc.withdraw.hint")} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
