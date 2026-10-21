import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, displayDateTime, todayInTimezone } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { listInterviewers, listInterviews, type InterviewRow } from "@/server/interviews";
import { listInterviewDays } from "@/server/interview-days";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, Card, EmptyState, FilterBar, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { addInterviewDayAction, removeInterviewDayAction, setApplicationsOpenAction } from "../actions";
import { loadWebsiteSettings } from "@/server/website";

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
  const [range, waiting, recent, interviewers, interviewDays] = await Promise.all([
    listInterviews(ctx, { from: new Date(`${from}T00:00:00Z`), to: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000), status: "SCHEDULED", interviewerId: sp.interviewer || undefined }),
    listInterviews(ctx, { to: new Date(), status: "SCHEDULED" }),
    listInterviews(ctx, { from: new Date(Date.now() - 14 * 86_400_000), to: new Date() }),
    listInterviewers(ctx),
    listInterviewDays(ctx),
  ]);
  const canSet = ctx.permissions.has("admission.interview.manage");
  const windowOpen = (await loadWebsiteSettings(ctx.schoolId)).applicationsOpen;
  const canWindow = ctx.permissions.has("admission.window.manage") || ctx.permissions.has("website.manage");
  const upcoming = range.filter((r) => r.scheduledAt.getTime() >= Date.now() - 3_600_000);
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(d);
  const days = [...new Set(upcoming.map((r) => dayKey(r.scheduledAt)))];
  const done = recent.filter((r) => r.status !== "SCHEDULED").reverse().slice(0, 15);

  return (
    <>
      <PageHeader title={t("adm.iv.page.title")} subtitle={t("adm.iv.page.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/interviews" />
      <Card title={t("adm.window.title")} className="mb-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Badge tone={windowOpen ? "ok" : "neutral"}>{windowOpen ? t("adm.window.open") : t("adm.window.closedNow")}</Badge>
          <span className="min-w-0 flex-1 text-muted">{t("adm.window.sub")}</span>
          {canWindow && (
            <ActionForm action={setApplicationsOpenAction} submitLabel={windowOpen ? t("adm.window.close") : t("adm.window.openNow")} inline tone="neutral" confirm={windowOpen ? t("adm.window.confirmClose") : undefined}>
              <input type="hidden" name="open" value={windowOpen ? "0" : "1"} />
            </ActionForm>
          )}
        </div>
      </Card>
      <Card title={t("adm.days.title")} className="mb-5">
        <p className="mb-3 text-sm text-muted">{t("adm.days.sub")}</p>
        {interviewDays.length === 0 ? (
          <p className="text-sm text-muted">{t("adm.days.none")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {interviewDays.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{displayDate(new Date(`${d.on}T00:00:00Z`), ctx.locale)} · {d.time}</span>
                  {d.venue && <span className="ml-2 text-muted">{d.venue}</span>}
                  <span className="block text-xs text-muted">
                    {d.from && d.until ? t("adm.days.window", { from: displayDate(new Date(`${d.from}T00:00:00Z`), ctx.locale), until: displayDate(new Date(`${d.until}T00:00:00Z`), ctx.locale) }) : d.from ? t("adm.days.windowFrom", { from: displayDate(new Date(`${d.from}T00:00:00Z`), ctx.locale) }) : d.until ? t("adm.days.windowUntil", { until: displayDate(new Date(`${d.until}T00:00:00Z`), ctx.locale) }) : t("adm.days.anytime")}
                  </span>
                </span>
                <span className="tabular-nums text-muted">{d.capacity > 0 ? t("adm.days.placedOf", { n: String(d.placed), max: String(d.capacity) }) : t("adm.days.placed", { n: String(d.placed) })}</span>
                {canSet && (
                  <ActionForm action={removeInterviewDayAction} submitLabel={t("adm.days.remove")} inline tone="neutral" confirm={t("adm.days.removeNote")}>
                    <input type="hidden" name="id" value={d.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {canSet && (
          <details className="mt-4 rounded-lg border border-line px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-link">{t("adm.days.add")}</summary>
            <ActionForm action={addInterviewDayAction} submitLabel={t("adm.days.save")} className="space-y-4 pb-4 pt-1">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field name="on" type="date" label={t("adm.days.on")} required />
                <Field name="time" type="time" label={t("adm.days.time")} defaultValue="09:00" required />
                <Field name="venue" label={t("adm.days.venue")} optionalLabel={t("common.optional")} />
                <Field name="from" type="date" label={t("adm.days.from")} optionalLabel={t("common.optional")} />
                <Field name="until" type="date" label={t("adm.days.until")} optionalLabel={t("common.optional")} />
                <Field name="capacity" type="number" min={0} label={t("adm.days.capacity")} optionalLabel={t("common.optional")} />
              </div>
              <p className="text-xs text-muted">{t("adm.days.hint")}</p>
            </ActionForm>
          </details>
        )}
      </Card>
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
