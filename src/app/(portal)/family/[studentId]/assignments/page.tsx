import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDateTime } from "@/lib/dates";
import { childAssignments } from "@/server/assignments";
import { childOrThrow } from "@/server/portal";
import { schoolTimezone } from "@/server/learning-access";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Homework" };

export default async function ChildAssignmentsPage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  try {
    const child = await childOrThrow(ctx, studentId);
    const [d, tz] = await Promise.all([childAssignments(ctx, studentId), schoolTimezone(ctx.schoolId)]);
    const open = d.items.filter((i) => !i.closed);
    const rest = d.items.filter((i) => i.closed);
    const row = (i: (typeof d.items)[number]) => {
      const s = i.submission;
      const chip = !s ? (i.overdue ? { tone: "bad" as const, label: t("learn.fam.overdue") } : i.closed ? { tone: "neutral" as const, label: t("learn.fam.closed") } : { tone: "warn" as const, label: t("learn.fam.todo") }) : s.state === "RETURNED" ? { tone: "warn" as const, label: t("learn.sub.returned") } : s.state === "GRADED" ? { tone: "ok" as const, label: i.maxScore !== null && s.score !== null ? t("learn.sub.markedScore", { score: s.score, max: i.maxScore }) : t("learn.sub.marked") } : { tone: "brand" as const, label: t("learn.sub.handedIn") };
      return (
        <li key={i.id}>
          <Link href={`/family/${studentId}/assignments/${i.id}`} className="flex min-h-20 items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-brand-400">
            <span className="min-w-0 flex-1"><span className="block text-xs font-bold uppercase tracking-wider text-link">{i.subjectName}</span><span className="block truncate text-base font-semibold">{i.title}</span><span className="block text-sm text-muted">{t("learn.asg.due")}: {displayDateTime(i.dueAt, tz, ctx.locale)}</span></span>
            <Badge tone={chip.tone}>{chip.label}</Badge>
            <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
          </Link>
        </li>
      );
    };
    return (
      <>
        <Link href={`/family/${studentId}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{child.name}</Link>
        <PageHeader title={t("learn.fam.homework")} subtitle={child.name} />
        {d.items.length === 0 ? <EmptyState>{t("learn.fam.noHomework")}</EmptyState> : (
          <div className="space-y-8">
            {open.length > 0 && <section aria-labelledby="open-h"><h2 id="open-h" className="mb-3 text-lg font-semibold">{t("learn.fam.current")}</h2><ul className="space-y-3">{open.map(row)}</ul></section>}
            {rest.length > 0 && <section aria-labelledby="done-h"><h2 id="done-h" className="mb-3 text-lg font-semibold">{t("learn.fam.past")}</h2><ul className="space-y-3">{rest.map(row)}</ul></section>}
          </div>
        )}
      </>
    );
  } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
}
