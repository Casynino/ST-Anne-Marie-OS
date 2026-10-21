import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, displayDateTime, todayInTimezone } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { listInterviewers, listInterviews, type InterviewRow } from "@/server/interviews";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, Card, EmptyState, FilterBar, NoAccess, PageHeader } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Interviews" };
const IV_TONE = { SCHEDULED: "brand", COMPLETED: "ok", CANCELLED: "neutral", NO_SHOW: "bad" } as const;
const OUTCOME_TONE = { PASSED: "ok", NOT_PASSED: "bad", DEFERRED: "warn", FURTHER_ASSESSMENT: "warn", AWAITING_DECISION: "warn" } as const;

function Row({ r, t, locale, timezone }: { r: InterviewRow; t: Awaited<ReturnType<typeof getT>>; locale: "EN" | "SW"; timezone: string }) {
  const time = new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(r.scheduledAt);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
      <span className="w-14 shrink-0 font-semibold tabular-nums">{time}</span>
      <span className="min-w-0 flex-1">
        <Link href={`/admissions/${r.applicationId}`} className="font-medium text-link hover:underline">{r.applicantName}</Link>
        <span className="ml-2 text-muted">{r.applicationNo}{r.className ? ` · ${r.className}` : ""}</span>
        <span className="block text-muted">{[r.location, r.method, r.interviewer, `${r.durationMinutes} min`].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="flex items-center gap-2">
        {r.outcome && <Badge tone={OUTCOME_TONE[r.outcome as keyof typeof OUTCOME_TONE]}>{t(`adm.iv.outcome.${r.outcome}` as "adm.iv.outcome.PASSED")}</Badge>}
        <Badge tone={IV_TONE[r.status as keyof typeof IV_TONE]}>{t(`adm.iv.status.${r.status}` as "adm.iv.status.SCHEDULED")}</Badge>
      </span>
    </div>
  );
}

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; interviewer?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read") && !ctx.permissions.has("admission.interview.manage")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : today;
  const toDefault = new Date(new Date(`${from}T00:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : toDefault;
  const [range, waiting, recent, interviewers] = await Promise.all([
    listInterviews(ctx, { from: new Date(`${from}T00:00:00Z`), to: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000), status: "SCHEDULED", interviewerId: sp.interviewer || undefined }),
    listInterviews(ctx, { to: new Date(), status: "SCHEDULED" }),
    listInterviews(ctx, { from: new Date(Date.now() - 14 * 86_400_000), to: new Date() }),
    listInterviewers(ctx),
  ]);
  const upcoming = range.filter((r) => r.scheduledAt.getTime() >= Date.now() - 3_600_000);
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(d);
  const days = [...new Set(upcoming.map((r) => dayKey(r.scheduledAt)))];
  const done = recent.filter((r) => r.status !== "SCHEDULED").reverse().slice(0, 15);

  return (
    <>
      <PageHeader title={t("adm.iv.page.title")} subtitle={t("adm.iv.page.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/interviews" />
      {waiting.length > 0 && (
        <Card title={`${t("adm.iv.waiting")} (${waiting.length})`} className="mb-5 border-warn/40">
          <div className="divide-y divide-line">{waiting.map((r) => <div key={r.id}><p className="pt-2 text-xs text-muted">{displayDateTime(r.scheduledAt, school.timezone, ctx.locale)}</p><Row r={r} t={t} locale={ctx.locale} timezone={school.timezone} /></div>)}</div>
        </Card>
      )}
      <FilterBar t={t} resetHref="/admissions/interviews">
        <Field name="from" type="date" label={t("adm.iv.from")} defaultValue={from} />
        <Field name="to" type="date" label={t("adm.iv.to")} defaultValue={to} />
        <Field name="interviewer" type="select" label={t("adm.iv.interviewer")} defaultValue={sp.interviewer} placeholder={t("common.all")} options={interviewers.map((u) => ({ value: u.id, label: u.fullName }))} />
      </FilterBar>
      <div className="space-y-5">
        {days.length === 0 ? <EmptyState>{t("adm.iv.noUpcoming")}</EmptyState> : days.map((d) => (
          <Card key={d} title={`${d === today ? `${t("adm.iv.today")} · ` : ""}${displayDate(new Date(`${d}T00:00:00Z`), ctx.locale)}`}>
            <div className="divide-y divide-line">{upcoming.filter((r) => dayKey(r.scheduledAt) === d).map((r) => <Row key={r.id} r={r} t={t} locale={ctx.locale} timezone={school.timezone} />)}</div>
          </Card>
        ))}
        {done.length > 0 && (
          <Card title={t("adm.iv.recent")}>
            <div className="divide-y divide-line">{done.map((r) => <div key={r.id}><p className="pt-2 text-xs text-muted">{displayDateTime(r.scheduledAt, school.timezone, ctx.locale)}</p><Row r={r} t={t} locale={ctx.locale} timezone={school.timezone} /></div>)}</div>
          </Card>
        )}
      </div>
    </>
  );
}
