import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { childBehaviour } from "@/server/behaviour";
import { childOrThrow } from "@/server/portal";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Behaviour" };
const TONE = { POSITIVE: "ok", CONCERN: "warn", INCIDENT: "bad" } as const;

export default async function ChildBehaviourPage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  try {
    const child = await childOrThrow(ctx, studentId);
    const rows = await childBehaviour(ctx, studentId);
    return (
      <>
        <Link href={`/family/${studentId}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft className="size-4" aria-hidden />{child.name}</Link>
        <PageHeader title={t("learn.bh.familyTitle")} subtitle={child.name} />
        {rows.length === 0 ? <EmptyState>{t("learn.bh.familyEmpty")}</EmptyState> : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[r.type]}>{t(`learn.bh.type.${r.type}`)}</Badge><span className="font-semibold">{r.category}</span><span className="ml-auto text-sm text-muted">{displayDate(r.occurredOn, ctx.locale)}</span></div>
                <p className="mt-2 whitespace-pre-line text-sm">{r.description}</p>
                {r.action && <p className="mt-1 text-sm text-muted"><strong>{t("learn.bh.action")}:</strong> {r.action}</p>}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
}
