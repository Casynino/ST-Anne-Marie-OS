import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Award, BarChart3, CalendarCheck, CheckCircle2, ClipboardList, Wallet } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getStudentProfile } from "@/server/students";
import { listClasses } from "@/server/academics";
import { AppError } from "@/lib/errors";
import { ageOn, displayDate, formatDateOnly, todayInTimezone } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { GuardianFields } from "@/components/guardian-fields";
import { guardianLabels } from "@/components/guardian-labels";
import { Badge, DefList, EmptyState, LinkButton } from "@/components/ui";
import { Cell, ColorBars, DonutStat, EmptyLine, GradientTile, Panel, Pill } from "@/components/dash/parts";
import { AreaChart } from "@/components/dash/charts-client";
import { Row } from "@/components/dash/rows";
import { CountTabs } from "@/components/lifecycle/parts";
import { studentInsights, type TermResult } from "@/server/student-profile";
import { attendanceRate, emptyCounts } from "@/server/attendance-reports";
import { getAttendanceSettings } from "@/server/attendance";
import { studentAccountState } from "@/server/portal";
import { createStudentAccountAction, resetPortalPasswordAction, setPortalActiveAction } from "@/app/(app)/guardians/actions";
import { RELATIONSHIPS } from "@/server/guardians";
import { listDocuments } from "@/server/documents";
import { db } from "@/lib/db";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { loadAdmissionAccount } from "@/server/admission-offers";
import { feeReviewFlag } from "@/server/fees";
import { listConcerns } from "@/server/concerns";
import { flagConcernAction } from "@/app/(app)/academic-office/actions";
import { classOccupancy } from "@/server/admission-queues";
import * as A from "../actions";
import { studentTimeline } from "@/server/year-readiness";
import { Timeline } from "@/components/lifecycle/timeline";

export const metadata: Metadata = { title: "Student" };
const STATUS_TONE = { ENROLLED: "ok", TRANSFERRED: "warn", WITHDRAWN: "bad", GRADUATED: "brand" } as const;

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; term?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  const s = await getStudentProfile(ctx, id).catch((e) => (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN") ? null : Promise.reject(e)));
  if (!s) notFound();

  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const canEnroll = ctx.permissions.has("student.enroll") && s.status === "ENROLLED";
  const classes = canEnroll ? await listClasses(ctx).catch(() => []) : [];
  const occupancy = canEnroll ? await classOccupancy(ctx.schoolId) : new Map();
  const placementOptions = classes.filter((c) => c.isActive).flatMap((c) => {
    const o = occupancy.get(c.id);
    const note = o?.capacity ? ` (${o.count}/${o.capacity}${o.count >= o.capacity ? ` ${t("adm.place.full")}` : ""})` : "";
    return c.streams.length ? c.streams.map((st) => ({ value: `${c.id}|${st.id}`, label: `${c.name} – ${st.name}${note}` })) : [{ value: c.id, label: `${c.name}${note}` }];
  });
  // How the student came in: the application (with its offer and the admission fee), or a direct registration.
  const application = ctx.permissions.has("admission.read") ? await db.application.findFirst({ where: { schoolId: ctx.schoolId, studentId: id }, select: { id: true, applicationNo: true, classAppliedId: true } }) : null;
  const admission = application ? await loadAdmissionAccount(db, ctx.schoolId, application.id) : null;
  const canFlag = ctx.permissions.has("concern.flag") || ctx.permissions.has("concern.manage");
  const concernRows = canFlag ? await listConcerns(ctx, { status: "open", studentId: id }).catch(() => []) : [];
  const feeFlag = ctx.permissions.has("fees.status.read") || ctx.permissions.has("fees.read") ? await feeReviewFlag(ctx, id).catch(() => null) : null;
  const current = s.enrollments.find((e) => e.status === "ACTIVE");
  // End-of-year decisions and yearly registrations (enrolments and status changes already have their own cards below).
  const yearHistory = ctx.permissions.has("progression.read") || ctx.permissions.has("registration.read") ? (await studentTimeline(ctx, s.id)).filter((e) => e.kind === "DECISION" || e.kind === "REGISTRATION") : [];
  const canManageGuardians = ctx.permissions.has("guardian.manage");
  const labels = await guardianLabels(ctx.permissions.has("guardian.read") || canManageGuardians);
  const fullName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
  const statusTargets = s.status === "ENROLLED" ? (["TRANSFERRED", "WITHDRAWN", "GRADUATED"] as const) : (["ENROLLED"] as const);
  const docs = ctx.permissions.has("document.read") ? await listDocuments(ctx, { studentId: id }).catch(() => []) : [];
  const portalAccount = ctx.permissions.has("portal.manage") ? await studentAccountState(ctx, id) : undefined;
  const canSeeAttendance = ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"].some((p) => ctx.permissions.has(p as "attendance.read"));
  const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") }));

  const ins = await studentInsights(ctx, id).catch(() => null);
  const perf = ins?.performance ?? null;
  const att = ins?.attendance ?? null;
  const fees = ins?.fees ?? null;
  const hw = ins?.homework ?? null;
  const beh = ins?.behaviour ?? null;
  const attSettings = att ? await getAttendanceSettings(db, ctx.schoolId) : null;
  const terms = perf?.terms ?? [];
  const chosen: TermResult | undefined = terms.find((x) => x.id === sp.term) ?? terms.at(-1);
  const prev: TermResult | undefined = chosen ? terms[terms.indexOf(chosen) - 1] : undefined;
  void prev;
  const money = (c: number) => formatMoney(c, school.currency);
  const compact = (c: number) => { const n = c / 100; return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)); };
  const fmtMonth = (m: string) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const months = (() => {
    if (!att || !attSettings) return [] as { month: string; rate: number }[];
    const by = new Map<string, ReturnType<typeof emptyCounts>>();
    for (const r of att.records) { const k = r.date.slice(0, 7); const c = by.get(k) ?? emptyCounts(); c[r.status]++; by.set(k, c); }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([m, c]) => { const rate = attendanceRate(c, attSettings); return rate === null ? [] : [{ month: m, rate }]; });
  })();
  const recorded = att ? att.counts.PRESENT + att.counts.ABSENT + att.counts.LATE + att.counts.EXCUSED : 0;
  const missed = att ? att.records.filter((r) => r.status !== "PRESENT").slice(0, 20) : [];
  const sortedSubjects = chosen ? [...chosen.subjects].sort((a, b) => b.percent - a.percent) : [];
  const strong = sortedSubjects.slice(0, 3);
  const weak = sortedSubjects.length > 3 ? [...sortedSubjects].reverse().slice(0, 3) : [];

  const hasLearning = !!hw || (beh && beh.length > 0) || concernRows.length > 0;
  const hasFamily = s.canSeeGuardians || s.canSeeMedical || docs.length > 0 || s.siblings.length > 0;
  const tabs = [
    { id: "overview", label: t("sp.tab.overview") },
    ...(perf ? [{ id: "performance", label: t("sp.tab.performance") }] : []),
    ...(att ? [{ id: "attendance", label: t("sp.tab.attendance") }] : []),
    ...(hasLearning ? [{ id: "learning", label: t("sp.tab.learning") }] : []),
    ...(hasFamily ? [{ id: "family", label: t("sp.tab.family") }] : []),
    { id: "records", label: t("sp.tab.records") },
  ];
  const tab = tabs.some((x) => x.id === sp.tab) ? (sp.tab as string) : "overview";
  const href = (id: string, extra = "") => `/students/${s.id}${id === "overview" ? "" : `?tab=${id}`}${extra}`;
  const classLabel = current ? `${current.class.name}${current.stream ? ` · ${current.stream.name}` : ""}` : t("student.notPlaced");
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const toneOf = (p: number) => (p >= 70 ? "text-ok" : p >= 50 ? "text-warn" : "text-bad");
  const changeOf = (c: number | null) => (c === null ? <span className="text-muted">—</span> : <span className={c > 0 ? "text-ok" : c < 0 ? "text-bad" : "text-muted"}>{c > 0 ? "▲ " : c < 0 ? "▼ " : ""}{Math.abs(c).toFixed(1)}</span>);

  return (
    <>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-brand-600/15 text-xl font-bold text-link ring-1 ring-inset ring-brand-600/25">{initials}</span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{fullName}</h1>
              <p className="mt-0.5 text-sm text-muted"><span className="tabular-nums">{s.admissionNo}</span> · {classLabel}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge tone={STATUS_TONE[s.status]}>{t(`student.status.${s.status}`)}</Badge>
                {feeFlag?.status === "REVIEW" && <Badge tone="warn">{t("fin.fees.reviewBadge")}</Badge>}
                <span>{s.gender === "MALE" ? t("student.male") : t("student.female")} · {t("sp.age", { n: ageOn(s.dateOfBirth) })} · {t("sp.admitted", { date: displayDate(s.admissionDate, locale) })}</span>
              </p>
            </div>
          </div>
          {ctx.permissions.has("student.update") && <LinkButton href={`/students/${s.id}/edit`} variant="secondary"><Pencil className="size-4" aria-hidden /> {t("student.profile.edit")}</LinkButton>}
        </div>
      </section>

      {(att || chosen || fees || hw) && (
        <ul className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(11rem,13.5rem))]" aria-label={t("sp.tab.overview")}>
          {att && <li><GradientTile icon={CalendarCheck} tone={att.low ? "rose" : "teal"} label={t("sp.tile.attendance")} value={att.rate === null ? "—" : `${att.rate}%`} caption={t("sp.tile.attendance.cap")} /></li>}
          {chosen && chosen.average !== null && <li><GradientTile icon={BarChart3} tone="violet" label={t("sp.tile.average")} value={chosen.average.toFixed(1)} caption={chosen.term} /></li>}
          {chosen && chosen.position !== null && <li><GradientTile icon={Award} tone="indigo" label={t("sp.tile.position")} value={`${chosen.position}/${chosen.classSize}`} caption={t("sp.tile.position.cap", { n: chosen.classSize })} /></li>}
          {fees && <li><GradientTile icon={Wallet} tone={fees.outstanding > 0 ? "orange" : "green"} label={t("sp.tile.fees")} value={fees.outstanding > 0 ? `${school.currency} ${compact(fees.outstanding)}` : "—"} caption={fees.overdue > 0 ? t("sp.tile.fees.cap", { amount: money(fees.overdue) }) : t("sp.tile.fees.clear")} /></li>}
          {hw && <li><GradientTile icon={ClipboardList} tone="teal" label={t("sp.tile.homework")} value={hw.averagePct === null ? String(hw.handedIn) : `${hw.averagePct}%`} caption={t("sp.tile.homework.cap", { late: hw.late })} /></li>}
        </ul>
      )}

      <div className="mt-4"><CountTabs items={tabs.map((x) => ({ href: href(x.id), label: x.label, active: x.id === tab }))} /></div>

      {tab === "overview" && (
        <>
          <Row>
            {perf && (
              <Panel className="flex-[2_1_30rem]" title={t("sp.subjects")} subtitle={chosen ? t("sp.subjects.sub", { term: chosen.term }) : undefined}>
                {!chosen ? <EmptyLine>{t("sp.nomarks")}</EmptyLine> : <ColorBars label={t("sp.subjects")} max={100} unit="%" labelWidth="8rem" items={sortedSubjects.map((x) => ({ label: x.name, value: x.percent, mark: x.classMean }))} />}
              </Panel>
            )}
            {att && recorded > 0 && (
              <Panel className="flex-[1_1_19rem]" title={t("sp.att.title")} subtitle={t("sp.tile.attendance.cap")}>
                <DonutStat label={t("sp.att.title")} center={att.rate === null ? "—" : `${att.rate}%`} caption={t("att.status.PRESENT")} segments={(["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const).map((k) => ({ label: t(`att.status.${k}`), value: att.counts[k], color: { PRESENT: "#2fd08f", LATE: "#f3b94c", EXCUSED: "#8b80ff", ABSENT: "#ff8574" }[k] }))} />
              </Panel>
            )}
            <Panel className="flex-[2_1_30rem]" title={t("student.profile.details")}>
            <DefList items={[
              { label: t("student.dob"), value: `${displayDate(s.dateOfBirth, locale)} (${ageOn(s.dateOfBirth)})` },
              { label: t("student.gender"), value: s.gender === "MALE" ? t("student.male") : t("student.female") },
              { label: t("student.admissionDate"), value: displayDate(s.admissionDate, locale) },
              { label: t("student.nationality"), value: s.nationality },
              { label: t("student.religion"), value: s.religion },
              { label: t("student.birthCert"), value: s.birthCertificateNo },
              { label: t("student.previousSchool"), value: s.previousSchool },
              { label: t("common.address"), value: s.address },
              ...(s.exitedOn ? [{ label: t("common.status"), value: `${t(`student.status.${s.status}`)} — ${t("student.exited", { date: displayDate(s.exitedOn, locale) })}${s.exitReason ? `: ${s.exitReason}` : ""}` }] : []),
            ]} />
          </Panel>

            {fees && (
              <Panel className="flex-[1_1_19rem]" title={t("sp.fees.title")} right={ctx.permissions.has("fees.read") ? <Link href={`/finance/students/${id}`} className="text-sm font-medium text-link hover:underline">{t("fin.student.statement")}</Link> : undefined}>
                <DefList items={[
                  { label: t("sp.fees.billed"), value: money(fees.billed) },
                  { label: t("sp.fees.paid"), value: money(fees.applied) },
                  { label: t("sp.fees.owed"), value: <span className={fees.outstanding > 0 ? "font-semibold text-warn" : ""}>{money(fees.outstanding)}</span> },
                  { label: t("sp.fees.overdue"), value: <span className={fees.overdue > 0 ? "font-semibold text-bad" : ""}>{money(fees.overdue)}</span> },
                  ...(fees.credit > 0 ? [{ label: t("sp.fees.credit"), value: money(fees.credit) }] : []),
                ]} />
                {fees.billed > 0 && <div aria-hidden className="mt-3 h-2 overflow-hidden rounded-sm bg-line"><div className="h-full rounded-sm bg-ok" style={{ width: `${Math.min(100, Math.round((fees.applied / fees.billed) * 100))}%` }} /></div>}
              </Panel>
            )}
          </Row>
        </>
      )}

      {tab === "performance" && perf && (
        !chosen ? <EmptyState>{t("sp.nomarks")}</EmptyState> : (
          <>
            {terms.length > 1 && <CountTabs items={terms.map((x) => ({ href: href("performance", `&term=${x.id}`), label: x.term, active: x.id === chosen.id }))} />}
            {perf.scope === "MINE" && <p className="mb-3 text-sm text-muted">{t("sp.mine")}</p>}
            <Row>
              {perf.scope === "ALL" && (
                <Panel className="flex-[2_1_30rem]" title={t("sp.trend")}>
                  {terms.filter((x) => x.average !== null).length >= 2
                    ? <AreaChart height={200} label={t("sp.trend")} summary={t("sp.trend")} yMin={0} yMax={100} points={terms.filter((x) => x.average !== null).map((x) => ({ key: x.id, label: x.term.split(" · ")[0]!, value: x.average as number }))} />
                    : <ColorBars label={t("sp.trend")} max={100} labelWidth="9rem" items={terms.filter((x) => x.average !== null).map((x) => ({ label: x.term, value: x.average as number }))} />}
                </Panel>
              )}
              <Panel className="flex-[1_1_19rem]" title={t("sp.summary")} subtitle={chosen.term} right={ctx.permissions.has("reportcard.read") ? <a href={`/api/report-cards/${chosen.id}`} target="_blank" rel="noopener" className="text-sm font-medium text-link hover:underline">{t("sp.card.pdf")}</a> : undefined}>
                <DefList items={[
                  ...(chosen.average !== null ? [{ label: t("sp.tile.average"), value: chosen.average.toFixed(1) }] : []),
                  ...(chosen.grade ? [{ label: t("sp.col.grade"), value: `${chosen.grade}${chosen.division ? ` · ${chosen.division}` : ""}` }] : []),
                  ...(chosen.position !== null ? [{ label: t("sp.col.position"), value: `${chosen.position} / ${chosen.classSize}` }] : []),
                  { label: t("sp.table.title"), value: String(chosen.subjects.length) },
                ]} />
              </Panel>
            </Row>
            <Row>
              <Panel className="flex-[2_1_34rem]" title={t("sp.table.title")} subtitle={chosen.term}>
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted"><th className="px-5 py-2.5">{t("sp.col.subject")}</th><th className="px-3 py-2.5">{t("sp.col.score")}</th><th className="px-3 py-2.5">{t("sp.col.grade")}</th><th className="px-3 py-2.5 text-right">{t("sp.col.class")}</th><th className="px-3 py-2.5 text-right">{t("sp.col.position")}</th><th className="px-5 py-2.5 text-right">{t("sp.col.change")}</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {sortedSubjects.map((x) => (
                        <tr key={x.id} className="hover:bg-canvas/50">
                          <Cell className="py-2.5 font-medium text-ink">{x.name}</Cell>
                          <Cell className="py-2.5"><span className="flex items-center gap-2.5"><span className="relative h-2 w-28 overflow-hidden rounded-sm bg-line"><span className={`block h-full rounded-sm ${x.percent >= 70 ? "bg-ok" : x.percent >= 50 ? "bg-warn" : "bg-bad"}`} style={{ width: `${Math.min(100, x.percent)}%` }} /></span><span className={`tabular-nums ${toneOf(x.percent)}`}>{x.percent.toFixed(1)}%</span></span></Cell>
                          <Cell className="py-2.5">{x.grade ?? "—"}</Cell>
                          <Cell right className="py-2.5 text-muted">{x.classMean === null ? "—" : `${x.classMean.toFixed(1)}%`}</Cell>
                          <Cell right className="py-2.5">{x.position === null ? "—" : `${x.position}/${x.classCount}`}</Cell>
                          <Cell right className="py-2.5">{changeOf(x.change)}</Cell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <div className="flex flex-[1_1_19rem] flex-col gap-4">
                <Panel title={t("sp.strong")}><ColorBars label={t("sp.strong")} max={100} unit="%" labelWidth="7rem" items={strong.map((x) => ({ label: x.name, value: x.percent, mark: x.classMean }))} /></Panel>
                {weak.length > 0 && <Panel title={t("sp.weak")}><ColorBars label={t("sp.weak")} max={100} unit="%" labelWidth="7rem" items={weak.map((x) => ({ label: x.name, value: x.percent, mark: x.classMean }))} /></Panel>}
              </div>
            </Row>
            {chosen.exams.length > 0 && (
              <Row>
                <Panel className="flex-[1_1_100%]" title={t("sp.exams")} subtitle={t("sp.exams.sub")}>
                  <div className="-mx-5 overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-sm">
                      <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted"><th className="px-5 py-2.5">{t("sp.col.subject")}</th>{chosen.exams.map((e) => <th key={e.id} className="px-3 py-2.5 text-right">{e.name}</th>)}</tr></thead>
                      <tbody className="divide-y divide-line">
                        {sortedSubjects.map((x) => (
                          <tr key={x.id} className="hover:bg-canvas/50">
                            <Cell className="py-2.5 font-medium text-ink">{x.name}</Cell>
                            {chosen.exams.map((e) => { const r = x.exams.find((y) => y.examId === e.id); return <Cell key={e.id} right className={`py-2.5 ${r?.percent != null ? toneOf(r.percent) : "text-muted"}`}>{r?.percent != null ? `${r.percent.toFixed(0)}%` : r?.status === "ABSENT" ? t("att.status.ABSENT") : "—"}</Cell>; })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </Row>
            )}
          </>
        )
      )}

      {tab === "attendance" && att && (
        recorded === 0 ? <EmptyState>{t("sp.att.none")}</EmptyState> : (
          <>
            <Row>
              <Panel className="flex-[1_1_19rem]" title={t("sp.att.rate")} subtitle={t("sp.att.sub", { from: displayDate(new Date(`${att.from}T00:00:00Z`), locale), to: displayDate(new Date(`${att.to}T00:00:00Z`), locale) })}>
                <DonutStat label={t("sp.att.title")} center={att.rate === null ? "—" : `${att.rate}%`} caption={t("att.status.PRESENT")} segments={(["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const).map((k) => ({ label: t(`att.status.${k}`), value: att.counts[k], color: { PRESENT: "#2fd08f", LATE: "#f3b94c", EXCUSED: "#8b80ff", ABSENT: "#ff8574" }[k] }))} />
                {att.low && <p className="mt-3 text-sm text-warn">{t("sp.att.low", { n: att.thresholdPct })}</p>}
              </Panel>
              {months.length > 0 && (
                <Panel className="flex-[1_1_22rem]" title={t("sp.att.byMonth")}>
                  <ColorBars label={t("sp.att.byMonth")} max={100} unit="%" labelWidth="5rem" items={months.map((m) => ({ label: fmtMonth(m.month), value: m.rate, mark: att.thresholdPct }))} />
                </Panel>
              )}
            </Row>
            <Row>
              <Panel className="flex-[1_1_100%]" title={t("sp.att.missed")} right={<Link href={`/attendance/reports?view=student&studentId=${id}`} className="text-sm font-medium text-link hover:underline">{t("sp.att.full")}</Link>}>
                {missed.length === 0 ? <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="size-4" aria-hidden />{t("sp.att.noMissed")}</p> : (
                  <div className="-mx-5 overflow-x-auto">
                    <table className="w-full min-w-[28rem] text-sm">
                      <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted"><th className="px-5 py-2.5">{t("learn.date")}</th><th className="px-3 py-2.5">{t("common.status")}</th><th className="px-5 py-2.5">{t("common.notes")}</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {missed.map((r, i) => (
                          <tr key={`${r.date}-${i}`}><Cell className="py-2.5 whitespace-nowrap">{displayDate(new Date(`${r.date}T00:00:00Z`), locale)}</Cell><Cell className="py-2.5"><Pill tone={r.status === "ABSENT" ? "bad" : r.status === "LATE" ? "warn" : "info"}>{t(`att.status.${r.status}`)}</Pill></Cell><Cell className="py-2.5 text-muted">{r.note ?? r.corrected ?? "—"}</Cell></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </Row>
          </>
        )
      )}

      {tab === "learning" && (
        <Row>
          {hw && (
            <Panel className="flex-[2_1_30rem]" title={t("sp.hw.title")} subtitle={t("sp.hw.sub")}>
              {hw.handedIn === 0 ? <EmptyLine>{t("sp.hw.none")}</EmptyLine> : (
                <>
                  <dl className="mb-4 grid grid-cols-3 gap-2.5">
                    {[[t("sp.hw.handed"), String(hw.handedIn)], [t("sp.hw.avg"), hw.averagePct === null ? "—" : `${hw.averagePct}%`], [t("sp.hw.late"), String(hw.late)]].map(([l, v]) => <div key={l} className="rounded-lg bg-canvas/60 px-3 py-2.5"><dt className="text-xs text-muted">{l}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{v}</dd></div>)}
                  </dl>
                  <div className="-mx-5 overflow-x-auto">
                    <table className="w-full min-w-[26rem] text-sm">
                      <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted"><th className="px-5 py-2.5">{t("sp.recent")}</th><th className="px-3 py-2.5">{t("sp.col.subject")}</th><th className="px-5 py-2.5 text-right">{t("sp.col.score")}</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {hw.recent.map((h) => <tr key={h.id}><Cell className="py-2.5 font-medium text-ink">{h.title}{h.late && <span className="ml-2 text-xs text-warn">{t("sp.hw.late")}</span>}</Cell><Cell className="py-2.5 text-muted">{h.subject}</Cell><Cell right className={`py-2.5 ${h.scorePct !== null ? toneOf(h.scorePct) : "text-muted"}`}>{h.scorePct === null ? "—" : `${h.scorePct}%`}</Cell></tr>)}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Panel>
          )}
          <div className="flex flex-[1_1_19rem] flex-col gap-4">
            {beh && (
              <Panel title={t("sp.beh.title")}>
                {beh.length === 0 ? <EmptyLine>{t("sp.beh.none")}</EmptyLine> : (
                  <ul className="divide-y divide-line">
                    {beh.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 py-2.5"><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{b.category}</span><span className="block truncate text-xs text-muted">{displayDate(b.occurredOn, locale)} · {b.recordedBy}</span></span><Pill tone={b.type === "POSITIVE" ? "ok" : b.type === "CONCERN" ? "warn" : "bad"}>{t(`learn.bh.type.${b.type}`)}</Pill></li>)}
                  </ul>
                )}
              </Panel>
            )}
            {concernRows.length > 0 && (
              <Panel title={t("sp.concerns.title")}>
                <ul className="divide-y divide-line text-sm">{concernRows.map((c) => <li key={c.id} className="py-2"><Link href={`/academic-office/concerns/${c.id}`} className="font-medium text-link hover:underline">{t(`concern.cat.${c.category}` as "concern.cat.OTHER")}</Link> <span className="text-muted">· {c.summary}</span></li>)}</ul>
              </Panel>
            )}
          </div>
        </Row>
      )}

      {tab === "family" && (
        <Row>
          <div className="flex flex-[2_1_34rem] flex-col gap-4">
          <Panel title={t("student.guardians")}>
            {!s.canSeeGuardians ? (
              <p className="text-sm text-muted">{t("student.noGuardianAccess")}</p>
            ) : (
              <div className="space-y-4">
                {s.guardians.map((g) => (
                  <div key={g.guardianId} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{g.guardian.fullName} <span className="font-normal text-muted">· {t(`student.rel.${g.relationship}` as "student.rel.FATHER")}</span></p>
                        <p className="text-sm text-muted">{g.guardian.phone}{g.guardian.altPhone ? ` · ${g.guardian.altPhone}` : ""}{g.guardian.email ? ` · ${g.guardian.email}` : ""}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {g.isPrimary && <Badge tone="brand">{t("student.primary")}</Badge>}
                        {g.isFinanciallyResponsible && <Badge>{t("student.financial")}</Badge>}
                        <Badge tone={g.verifiedAt ? "ok" : "warn"}>{g.verifiedAt ? t("student.verified") : t("student.unverified")}</Badge>
                      </div>
                    </div>
                    {(canManageGuardians || ctx.permissions.has("guardian.verify")) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {ctx.permissions.has("guardian.verify") && (
                          <ActionForm buttonClassName="btn-sm" action={A.verifyGuardianAction} submitLabel={g.verifiedAt ? t("student.unverify") : t("student.verify")} inline className="inline">
                            <input type="hidden" name="studentId" value={s.id} /><input type="hidden" name="guardianId" value={g.guardianId} /><input type="hidden" name="verified" value={g.verifiedAt ? "false" : "true"} />
                          </ActionForm>
                        )}
                        {canManageGuardians && (
                          <>
                            <details className="w-full">
                              <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium text-link">{t("common.edit")}</summary>
                              <div className="mt-2 grid gap-4 md:grid-cols-2">
                                <ActionForm buttonClassName="btn-sm" action={A.updateRelationshipAction} submitLabel={t("common.save")} className="space-y-3">
                                  <input type="hidden" name="studentId" value={s.id} /><input type="hidden" name="guardianId" value={g.guardianId} />
                                  <Field name="relationship" label={t("student.relationship")} type="select" options={relOptions} defaultValue={g.relationship} required />
                                  <Field name="isPrimary" type="checkbox" label={t("student.primary")} defaultValue={g.isPrimary} />
                                  <Field name="isFinanciallyResponsible" type="checkbox" label={t("student.financial")} defaultValue={g.isFinanciallyResponsible} />
                                  <Field name="receivesNotifications" type="checkbox" label={t("student.notify")} defaultValue={g.receivesNotifications} />
                                </ActionForm>
                                <ActionForm buttonClassName="btn-sm" action={A.updateGuardianAction} submitLabel={t("guardian.edit")} className="space-y-3">
                                  <input type="hidden" name="guardianId" value={g.guardianId} />
                                  <Field name="fullName" label={t("users.fullName")} defaultValue={g.guardian.fullName} required />
                                  <Field name="phone" label={t("common.phone")} type="tel" defaultValue={g.guardian.phone} required />
                                  <Field name="altPhone" label={t("guardian.altPhone")} type="tel" defaultValue={g.guardian.altPhone} optionalLabel={t("common.optional")} />
                                  <Field name="email" label={t("common.email")} type="email" defaultValue={g.guardian.email} optionalLabel={t("common.optional")} />
                                  <Field name="occupation" label={t("guardian.occupation")} defaultValue={g.guardian.occupation} optionalLabel={t("common.optional")} />
                                </ActionForm>
                              </div>
                            </details>
                            {!g.isPrimary && s.guardians.length > 1 && (
                              <details className="w-full">
                                <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium text-bad">{t("student.unlink")}</summary>
                                <ActionForm buttonClassName="btn-sm" action={A.unlinkGuardianAction} submitLabel={t("student.unlink")} tone="danger" className="mt-2 space-y-3" confirm={t("common.confirmAction")}>
                                  <input type="hidden" name="studentId" value={s.id} /><input type="hidden" name="guardianId" value={g.guardianId} />
                                  <Field name="reason" label={t("common.reason")} required />
                                </ActionForm>
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {canManageGuardians && (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("student.link")}</summary>
                    <ActionForm buttonClassName="btn-sm" action={A.linkGuardianAction} submitLabel={t("student.link")} className="mt-2 space-y-3">
                      <input type="hidden" name="studentId" value={s.id} />
                      <GuardianFields prefix="" labels={labels} canSearch={labels.canSearch} />
                    </ActionForm>
                  </details>
                )}
              </div>
            )}
          </Panel>
          {s.canSeeGuardians && s.emergencyContacts.length > 0 && (
            <Panel title={t("student.emergency")}>
              <ul className="divide-y divide-line text-sm">
                {s.emergencyContacts.map((c) => <li key={c.id} className="py-2"><strong>{c.name}</strong> · {c.relationship} · {c.phone}</li>)}
              </ul>
            </Panel>
          )}
          {s.canSeeMedical && (
            <Panel title={t("student.medical")}>
              <p className="whitespace-pre-wrap text-sm">{s.medicalNotes || "—"}</p>
            </Panel>
          )}
          {docs.length > 0 && (
            <Panel title={t("doc.title")}>
              <p className="mb-2 text-sm text-muted">{t("doc.access")}</p>
              <ul className="divide-y divide-line text-sm">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 break-words"><strong>{d.fileName}</strong> <span className="text-muted">· {t(`doc.type.${d.docType as "OTHER"}`)}</span></span>
                    <a href={`/api/documents/${d.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 font-medium text-link hover:bg-canvas btn-secondary">{t("doc.download")}</a>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          </div>
          <div className="flex flex-[1_1_19rem] flex-col gap-4">
          {s.siblings.length > 0 && (
            <Panel title={t("student.profile.siblings")}>
              <ul className="space-y-1 text-sm">
                {s.siblings.map((x) => <li key={x.id}><Link href={`/students/${x.id}`} className="text-link hover:underline">{x.firstName} {x.lastName}</Link> <span className="text-muted">· {x.admissionNo}</span></li>)}
              </ul>
            </Panel>
          )}
          </div>
        </Row>
      )}

      {tab === "records" && (
        <Row>
          <div className="flex flex-[1_1_22rem] flex-col gap-4">
          {canEnroll && !current && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("stu.awaitingClass")}</p>}
          {canEnroll && placementOptions.length > 0 && (
            <Panel title={current ? t("student.enrol.move") : t("student.enrol.title")}>
              <ActionForm buttonClassName="btn-sm" action={A.enrollStudentAction} submitLabel={t("student.enrol.button")} className="space-y-3">
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="placement" label={`${t("student.class")} / ${t("student.stream")}`} type="select" options={placementOptions} placeholder={t("common.select")} required />
                {ctx.permissions.has("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
              </ActionForm>
            </Panel>
          )}
          {ctx.permissions.has("portal.manage") && s.status === "ENROLLED" && (
            <Panel title={t("portal.admin.studentAccount")}>
              {portalAccount ? (
                <div className="space-y-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><Badge tone={portalAccount.status === "ACTIVE" ? "ok" : "bad"}>{portalAccount.status === "ACTIVE" ? t("common.active") : t("portal.admin.suspended")}</Badge>{portalAccount.mustChangePassword && <span className="text-muted">{t("portal.admin.notYetChanged")}</span>}</p>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm buttonClassName="btn-sm" action={resetPortalPasswordAction} submitLabel={t("portal.admin.resetPassword")} inline confirm={t("portal.admin.resetConfirm")} className="space-y-1"><input type="hidden" name="userId" value={portalAccount.id} /></ActionForm>
                    <ActionForm buttonClassName="btn-sm" action={setPortalActiveAction} submitLabel={portalAccount.status === "ACTIVE" ? t("portal.admin.suspend") : t("portal.admin.reactivate")} inline tone={portalAccount.status === "ACTIVE" ? "danger" : "neutral"} className="space-y-1"><input type="hidden" name="userId" value={portalAccount.id} /><input type="hidden" name="active" value={portalAccount.status === "ACTIVE" ? "false" : "true"} /></ActionForm>
                  </div>
                </div>
              ) : (
                <ActionForm buttonClassName="btn-sm" action={createStudentAccountAction} submitLabel={t("portal.admin.create")} className="space-y-3">
                  <input type="hidden" name="studentId" value={s.id} />
                  <p className="text-sm text-muted">{t("portal.admin.studentHint")}</p>
                  <Field name="email" type="email" label={t("common.email")} optionalLabel={t("common.optional")} />
                  <Field name="phone" type="tel" label={t("common.phone")} optionalLabel={t("common.optional")} />
                </ActionForm>
              )}
            </Panel>
          )}
          {ctx.permissions.has("student.status_change") && (
            <Panel title={t("student.status.title")}>
              <ActionForm buttonClassName="btn-sm" action={A.changeStatusAction} submitLabel={t("common.confirm")} tone="danger" className="space-y-3" confirm={t("common.confirmAction")}>
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="status" label={t("student.status.new")} type="select" placeholder={t("common.select")} options={statusTargets.map((v) => ({ value: v, label: v === "ENROLLED" ? t("student.status.reinstate") : t(`student.status.${v}`) }))} required />
                <Field name="effectiveOn" label={t("student.status.effective")} type="date" defaultValue={today} required />
                <Field name="reason" label={t("common.reason")} type="textarea" rows={2} required />
              </ActionForm>
            </Panel>
          )}
          {canFlag && s.status === "ENROLLED" && (
            <Panel title={t("concern.flag")}>
              {concernRows.length > 0 && (
                <ul className="mb-3 divide-y divide-line text-sm">{concernRows.map((c) => <li key={c.id} className="py-2"><Link href={`/academic-office/concerns/${c.id}`} className="font-medium text-link hover:underline">{t(`concern.cat.${c.category}` as "concern.cat.OTHER")}</Link> <span className="text-muted">· {c.summary}</span></li>)}</ul>
              )}
              <p className="mb-3 text-sm text-muted">{t("concern.flag.hint")}</p>
              <ActionForm buttonClassName="btn-sm" action={flagConcernAction} submitLabel={t("concern.flag")} className="space-y-3">
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="category" type="select" label={t("concern.category")} required options={(["ABSENCE", "LOW_MARKS", "MISSING_WORK", "DECLINE", "BEHAVIOUR", "OTHER"] as const).map((k) => ({ value: k, label: t(`concern.cat.${k}` as "concern.cat.OTHER") }))} placeholder={t("common.select")} />
                <Field name="summary" label={t("concern.flag.summary")} required />
                <Field name="notes" type="textarea" rows={2} label={t("concern.flag.notes")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Panel>
          )}
          </div>
          <div className="flex flex-[1_1_22rem] flex-col gap-4">
          {application && (
            <Panel title={t("stu.admission.title")}>
              <ul className="space-y-1 text-sm">
                <li><span className="text-muted">{t("stu.admission.application")}:</span> <Link href={`/admissions/${application.id}`} className="font-medium text-link hover:underline">{application.applicationNo}</Link></li>
                {admission?.offer && <li><span className="text-muted">{t("stu.admission.offer")}:</span> {admission.offer.letterNo}</li>}
                {admission?.account && <li><span className="text-muted">{t("stu.admission.fee")}:</span> {formatMoney(admission.account.verifiedCents, school.currency)} / {formatMoney(admission.account.requiredCents, school.currency)} · {t(`adm.pay.status.${admission.account.status}` as "adm.pay.status.PAID")}</li>}
                {admission?.payments.filter((p) => p.receiptNo).map((p) => <li key={p.id}><a href={`/api/admission-receipts/${p.id}?lang=${locale}`} target="_blank" rel="noopener" className="font-medium text-link hover:underline">{t("adm.pay.receipt")} {p.receiptNo}</a> <span className="text-muted">({formatMoney(centsOf(p.amount), school.currency)})</span></li>)}
              </ul>
            </Panel>
          )}
          <Panel title={t("student.profile.enrollments")}>
            {s.enrollments.length === 0 ? <p className="text-sm text-muted">{t("student.notPlaced")}</p> : (
              <ul className="space-y-3 text-sm">
                {s.enrollments.map((e) => (
                  <li key={e.id}>
                    <p className="font-medium">{e.class.name}{e.stream ? ` – ${e.stream.name}` : ""} <span className="font-normal text-muted">· {e.academicYear.name}</span></p>
                    <p className="text-muted">{displayDate(e.startedOn, locale)} → {e.endedOn ? displayDate(e.endedOn, locale) : "…"} · <Badge tone={e.status === "ACTIVE" ? "ok" : "neutral"}>{t(`student.enrollment.${e.status}`)}</Badge></p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {yearHistory.length > 0 && (
            <Panel title={t("lc.student.years")}>
              <Timeline entries={yearHistory} t={t} locale={ctx.locale} limit={12} />
            </Panel>
          )}
          {s.statusHistory.length > 0 && (
            <Panel title={t("student.profile.statusHistory")}>
              <ul className="space-y-3 text-sm">
                {s.statusHistory.map((h) => (
                  <li key={h.id}>
                    <p className="font-medium">{t(`student.status.${h.fromStatus}`)} → {t(`student.status.${h.toStatus}`)} <span className="font-normal text-muted">· {formatDateOnly(h.effectiveOn)}</span></p>
                    <p className="text-muted">{h.reason}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          </div>
        </Row>
      )}
    </>
  );
}
