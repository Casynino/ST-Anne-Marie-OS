import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, FileDown } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getMyReportCard } from "@/server/portal";
import { ReportCardView } from "@/components/results/report-card-view";

export const metadata: Metadata = { title: "Report card" };

export default async function FamilyReportCardPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let card: Awaited<ReturnType<typeof getMyReportCard>>;
  try {
    card = await getMyReportCard(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/family/${card.studentId}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("fam.back")}</Link>
        <a href={`/api/report-cards/${card.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 btn-primary"><FileDown className="size-4" aria-hidden />{t("rc.pdf")}</a>
      </div>
      <ReportCardView snap={card.snapshot} t={t} />
    </>
  );
}
