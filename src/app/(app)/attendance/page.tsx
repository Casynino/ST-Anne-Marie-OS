import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { todayInTimezone, parseDateOnly } from "@/lib/dates";
import { countPendingConflicts, registerOverview } from "@/server/attendance";
import { getSchoolBasics } from "@/server/settings";
import { Badge, EmptyState, FilterBar, NoAccess, PageHeader } from "@/components/ui";
import { Field } from "@/components/form";
import { AttendanceNav } from "@/components/attendance/subnav";
import { OfflinePanel } from "@/components/attendance/offline-panel";

export const metadata: Metadata = { title: "Attendance" };
type Search = { date?: string };
const TONE = { NOT_STARTED: "neutral", DRAFT: "warn", FINALISED: "ok" } as const;

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"])) return <NoAccess t={t} />;
  const school = await getSchoolBasics(ctx.schoolId);
  const sp = await searchParams;
  const today = todayInTimezone(school.timezone);
  const date = sp.date && parseDateOnly(sp.date) ? sp.date : today;
  const canTake = hasAny(ctx, ["attendance.take", "attendance.take_any"]);

  let overview: Awaited<ReturnType<typeof registerOverview>> | null = null;
  let problem: string | null = null;
  try {
    overview = await registerOverview(ctx, date);
  } catch (e) {
    if (e instanceof AppError) problem = e.fieldErrors?.date ? t("att.noYear") : e.message;
    else throw e;
  }
  const conflicts = await countPendingConflicts(ctx);
  const sessionName = (id: string) => {
    const s = overview?.sessions.find((x) => x.id === id);
    return ctx.locale === "SW" && s?.nameSw ? s.nameSw : (s?.name ?? "");
  };

  return (
    <>
      <PageHeader title={t("att.title")} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance" conflicts={conflicts} />
      {canTake && <OfflinePanel userId={ctx.userId} locale={ctx.locale} timezone={school.timezone} fullName={ctx.fullName} canTake />}
      <FilterBar t={t} resetHref="/attendance">
        <Field name="date" type="date" label={t("att.date")} defaultValue={date} max={undefined} />
      </FilterBar>
      {problem ? (
        <EmptyState>{problem}</EmptyState>
      ) : !overview || overview.rows.length === 0 ? (
        <EmptyState>{t("att.noClasses")}</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {overview.rows.map((r) => (
            <li key={`${r.classId}-${r.streamId}`} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {r.className}
                  {r.streamName ? ` · ${r.streamName}` : ""}
                </h2>
                <span className="text-sm text-muted">{t("att.students.count", { count: r.studentCount })}</span>
              </div>
              <div className="mt-3 space-y-3">
                {r.cells.map((c) => {
                  const href = `/attendance/take?classId=${r.classId}${r.streamId ? `&streamId=${r.streamId}` : ""}&sessionId=${c.sessionId}&date=${overview!.date}`;
                  const label = c.status === "FINALISED" ? t("att.view") : r.canTake ? (c.status === "DRAFT" ? t("att.continue") : t("att.take")) : t("att.view");
                  return (
                    <div key={c.sessionId} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        {overview!.sessions.length > 1 || overview!.settings.mode === "PER_SESSION" ? <p className="text-sm font-medium">{sessionName(c.sessionId)}</p> : null}
                        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                          <Badge tone={TONE[c.status]}>{c.status === "NOT_STARTED" ? t("att.notStarted") : c.status === "DRAFT" ? t("att.draft") : t("att.finalised")}</Badge>
                          {c.status !== "NOT_STARTED" && (
                            <span>
                              {t("att.status.PRESENT")} {c.counts.PRESENT} · {t("att.status.ABSENT")} {c.counts.ABSENT}
                            </span>
                          )}
                        </p>
                      </div>
                      <Link
                        href={href}
                        className={`inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-base font-semibold ${r.canTake && c.status !== "FINALISED" ? "bg-brand-700 text-white hover:bg-brand-800" : "border border-line bg-surface text-ink hover:bg-canvas"}`}
                      >
                        {label}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
