import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { childTimetable } from "@/server/timetable";
import { childOrThrow } from "@/server/portal";
import { EmptyState, PageHeader } from "@/components/ui";
import { TimetableGrid } from "@/components/learning/timetable-grid";
import { dayLabels } from "@/lib/learning/labels";

export const metadata: Metadata = { title: "Timetable" };

export default async function ChildTimetablePage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  try {
    const child = await childOrThrow(ctx, studentId);
    const d = await childTimetable(ctx, studentId);
    return (
      <>
        <Link href={`/family/${studentId}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{child.name}</Link>
        <PageHeader title={t("learn.tt.title")} subtitle={`${child.name} · ${child.className ?? ""}${child.streamName ? ` ${child.streamName}` : ""}`} />
        {d.lessons.length === 0 ? <EmptyState>{t("learn.tt.familyEmpty")}</EmptyState> : <TimetableGrid periods={d.periods} lessons={d.lessons} detail="teacher" labels={{ day: dayLabels(t), break: t("learn.tt.break"), free: t("learn.tt.free"), whole: t("learn.tt.wholeClass"), add: t("learn.tt.addLesson") }} />}
      </>
    );
  } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
}
