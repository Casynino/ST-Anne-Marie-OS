import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { classReport, listReportTerms, schoolReport, studentReport, termReport, type Counts } from "@/server/attendance-reports";
import { registerOverview } from "@/server/attendance";
import { getCurrentAcademicContext } from "@/server/academics";
import { listStudents } from "@/server/students";
import { getSchoolBasics } from "@/server/settings";
import { ExportMenu } from "@/components/export-menu";
import { Badge, Card, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Stat, Td } from "@/components/ui";
import { Field } from "@/components/form";
import { AttendanceNav } from "@/components/attendance/subnav";
import type { Translate } from "@/lib/i18n";

export const metadata: Metadata = { title: "Attendance reports" };
type Search = { view?: string; target?: string; from?: string; to?: string; termId?: string; studentId?: string; q?: string };
const VIEWS = ["class", "student", "term", "school"] as const;
type View = (typeof VIEWS)[number];
const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
const TONE = { PRESENT: "ok", ABSENT: "bad", LATE: "warn", EXCUSED: "brand" } as const;

const pct = (r: number | null) => (r === null ? "—" : `${r}%`);

function CountsCells({ c }: { c: Counts }) {
  return STATUSES.map((s) => <Td key={s} className="tabular-nums">{c[s]}</Td>);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "class";
  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const { term } = await getCurrentAcademicContext(ctx.schoolId);
  const from = sp.from && parseDateOnly(sp.from) ? sp.from : term ? formatDateOnly(term.startsOn) : today.slice(0, 8) + "01";
  const to = sp.to && parseDateOnly(sp.to) ? sp.to : today;

  // Class/stream options come from what this user may see.
  const overview = await registerOverview(ctx, today).catch(() => null);
  const targets = overview?.rows ?? [];
  const classOptions = targets.map((r) => ({ value: `${r.classId}|${r.streamId ?? ""}`, label: `${r.className}${r.streamName ? ` · ${r.streamName}` : ""}` }));
  const terms = await listReportTerms(ctx).catch(() => []);

  let body: React.ReactNode = null;
  let error: string | null = null;
  try {
    if (view === "class" && sp.target) {
      const [classId, streamId] = sp.target.split("|");
      const r = await classReport(ctx, { classId, streamId: streamId || undefined, from, to });
      body = (
        <>
          <Summary t={t} rate={r.rate} totals={r.totals} lowCount={r.lowCount} threshold={r.thresholdPct} days={r.daysRecorded} />
          {r.rows.length === 0 ? (
            <EmptyState>{t("rep.noData")}</EmptyState>
          ) : (
            <DataTable head={[t("common.name"), t("student.admissionNo"), ...STATUSES.map((s) => t(`att.status.${s}`)), t("rep.rate")]}>
              {r.rows.map((s) => (
                <tr key={s.studentId} className={s.low ? "bg-red-50/60" : undefined}>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/attendance/reports?view=student&studentId=${s.studentId}&from=${from}&to=${to}`}>{s.name}</Link></Td>
                  <Td className="whitespace-nowrap tabular-nums">{s.admissionNo}</Td>
                  <CountsCells c={s.counts} />
                  <Td className="whitespace-nowrap font-medium tabular-nums">{pct(s.rate)} {s.low && <Badge tone="bad">{t("rep.low")}</Badge>}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      );
    } else if (view === "student" && sp.studentId) {
      const r = await studentReport(ctx, sp.studentId, { from, to });
      body = (
        <>
          <h2 className="mb-3 text-lg font-semibold">{r.student.name} <span className="text-sm font-normal text-muted">{r.student.admissionNo}</span></h2>
          <Summary t={t} rate={r.rate} totals={r.counts} lowCount={r.low ? 1 : 0} threshold={r.thresholdPct} />
          {r.records.length === 0 ? (
            <EmptyState>{t("rep.noData")}</EmptyState>
          ) : (
            <DataTable head={[t("rep.date"), t("att.session"), t("common.status"), t("rep.note")]}>
              {r.records.map((x, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap">{x.date}</Td>
                  <Td>{x.session}</Td>
                  <Td><Badge tone={TONE[x.status]}>{t(`att.status.${x.status}`)}</Badge> {x.corrected && <span className="text-xs text-muted">{t("rep.corrected")}: {x.corrected}</span>}</Td>
                  <Td>{x.note ?? ""}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      );
    } else if ((view === "term" && sp.termId) || view === "school") {
      const r = view === "term" ? await termReport(ctx, sp.termId!) : await schoolReport(ctx, { from, to });
      body = (
        <>
          {"termName" in r ? <h2 className="mb-1 text-lg font-semibold">{String(r.termName)}</h2> : null}
          <p className="mb-3 text-sm text-muted">{r.from} → {r.to}</p>
          <Summary t={t} rate={r.rate} totals={r.totals} lowCount={r.lowCount} threshold={r.thresholdPct} />
          {r.classes.length === 0 ? (
            <EmptyState>{t("rep.noData")}</EmptyState>
          ) : (
            <DataTable head={[t("att.class"), t("rep.students"), ...STATUSES.map((s) => t(`att.status.${s}`)), t("rep.rate"), t("rep.low")]}>
              {r.classes.map((c) => (
                <tr key={`${c.classId}-${c.streamId}`}>
                  <Td>{c.className}{c.streamName ? ` · ${c.streamName}` : ""}</Td>
                  <Td className="tabular-nums">{c.students}</Td>
                  <CountsCells c={c.counts} />
                  <Td className="whitespace-nowrap font-medium tabular-nums">{pct(c.rate)}</Td>
                  <Td className="tabular-nums">{c.lowCount > 0 ? <Badge tone="bad">{c.lowCount}</Badge> : "0"}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      );
    }
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }

  let matches: Awaited<ReturnType<typeof listStudents>>["items"] = [];
  if (view === "student" && sp.q) matches = (await listStudents(ctx, { q: sp.q }).catch(() => ({ items: [] }))).items;
  const settings = (await import("@/server/attendance")).getAttendanceSettings;
  const policy = await settings((await import("@/lib/db")).db, ctx.schoolId);

  return (
    <>
      <PageHeader title={t("rep.title")} actions={view === "class" && sp.target ? <ExportMenu base={`/api/export/attendance?classId=${sp.target.split("|")[0]}${sp.target.split("|")[1] ? `&streamId=${sp.target.split("|")[1]}` : ""}&from=${from}&to=${to}`} t={t} /> : undefined} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance/reports" />
      <nav className="mb-3 flex flex-wrap gap-2" aria-label={t("rep.title")}>
        {VIEWS.map((v) => (
          <Link key={v} href={`/attendance/reports?view=${v}`} aria-current={view === v ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${view === v ? "bg-brand-100 text-brand-800" : "text-muted hover:bg-white"}`}>
            {t(`rep.view.${v}`)}
          </Link>
        ))}
      </nav>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3">
        <input type="hidden" name="view" value={view} />
        {view === "class" && <Field name="target" type="select" required label={t("att.class")} defaultValue={sp.target} options={classOptions} placeholder={t("common.select")} />}
        {view === "term" && <Field name="termId" type="select" required label={t("rep.term")} defaultValue={sp.termId ?? terms.find((x) => x.isCurrent)?.id} options={terms.map((x) => ({ value: x.id, label: x.label }))} placeholder={t("common.select")} />}
        {view === "student" && (
          <>
            <Field name="q" label={t("rep.selectStudent")} defaultValue={sp.q} placeholder={t("student.search")} className="min-w-56 flex-1" />
            {sp.studentId && <input type="hidden" name="studentId" value={sp.studentId} />}
          </>
        )}
        {view !== "term" && (
          <>
            <Field name="from" type="date" label={t("rep.from")} defaultValue={from} />
            <Field name="to" type="date" label={t("rep.to")} defaultValue={to} />
          </>
        )}
        <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("common.filter")}</button>
      </form>

      {view === "student" && matches.length > 0 && (
        <ul className="mb-4 divide-y divide-line rounded-xl border border-line bg-white">
          {matches.slice(0, 8).map((s) => (
            <li key={s.id}>
              <Link className="flex min-h-11 items-center justify-between px-3 text-sm hover:bg-canvas" href={`/attendance/reports?view=student&studentId=${s.id}&from=${from}&to=${to}`}>
                <span>{s.firstName} {s.lastName}</span>
                <span className="tabular-nums text-muted">{s.admissionNo}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error ? <EmptyState>{error}</EmptyState> : body}
      <p className="mt-4 text-xs text-muted">{t("rep.rateNote", { late: policy.lateCountsAsPresent ? t("common.yes") : t("common.no"), excused: policy.excusedCountsAsPresent ? t("common.yes") : t("common.no") })}</p>
    </>
  );
}

function Summary({ t, rate, totals, lowCount, threshold, days }: { t: Translate; rate: number | null; totals: Counts; lowCount: number; threshold: number; days?: number }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label={t("rep.rate")} value={pct(rate)} hint={days !== undefined ? t("rep.days", { days }) : undefined} />
      <Stat label={t("att.status.PRESENT")} value={totals.PRESENT + totals.LATE} hint={`${t("att.status.LATE")}: ${totals.LATE}`} />
      <Stat label={t("att.status.ABSENT")} value={totals.ABSENT} hint={`${t("att.status.EXCUSED")}: ${totals.EXCUSED}`} />
      <Stat label={t("rep.low")} value={lowCount} hint={t("rep.threshold", { pct: threshold })} />
    </div>
  );
}
