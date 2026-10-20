import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getAttendanceSheet } from "@/server/attendance";
import { EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { SheetEditor } from "@/components/attendance/sheet-editor";

export const metadata: Metadata = { title: "Take attendance" };
type Search = { classId?: string; streamId?: string; sessionId?: string; date?: string };

export default async function TakeAttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  if (!sp.classId || !sp.sessionId || !sp.date) redirect("/attendance");

  let sheet: Awaited<ReturnType<typeof getAttendanceSheet>>;
  try {
    sheet = await getAttendanceSheet(ctx, { classId: sp.classId, streamId: sp.streamId, sessionId: sp.sessionId, date: sp.date });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <NoAccess t={t} />;
    if (e instanceof AppError) return <EmptyState>{e.fieldErrors?.date ? t("att.noYear") : e.message}</EmptyState>;
    throw e;
  }

  return (
    <>
      <PageHeader
        title={t("att.take")}
        actions={
          <>
            {sheet.register && (
              <Link href={`/attendance/register/${sheet.register.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">
                {t("att.openRegister")}
              </Link>
            )}
            <Link href={`/attendance?date=${sheet.date}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">
              {t("common.back")}
            </Link>
          </>
        }
      />
      {sheet.isFuture && <p className="mb-3 text-sm text-warn">{t("att.future")}</p>}
      <SheetEditor
        key={`${sheet.register?.id ?? "new"}-${sheet.register?.status ?? ""}`}
        userId={ctx.userId}
        locale={ctx.locale}
        source="server"
        sheet={{
          date: sheet.date,
          academicYearId: sheet.academicYearId,
          class: sheet.class,
          stream: sheet.stream,
          session: sheet.session,
          register: sheet.register ? { id: sheet.register.id, status: sheet.register.status, startedByName: sheet.register.startedByName, finalisedByName: sheet.register.finalisedByName, finalisedAt: sheet.register.finalisedAt } : null,
          students: sheet.students,
          records: sheet.records,
          markedElsewhere: sheet.markedElsewhere,
          canTake: sheet.canTake,
        }}
      />
    </>
  );
}
