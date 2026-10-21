import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, todayInTimezone } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { listInterviewDays } from "@/server/interview-days";
import { listApplyClasses } from "@/server/public-applications";
import { loadWebsiteSettings } from "@/server/website";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { addInterviewDayAction, removeInterviewDayAction, setApplicationsOpenAction } from "../actions";

export const metadata: Metadata = { title: "Application windows" };

/**
 * Application windows. The office opens a window for the classes it is taking applications for, with the dates it is open and the interview
 * date already set: a family that applies for one of those classes while it is open knows its interview date at once. Applications are
 * received at any other time too; those wait for the office to review them and give a date when it accepts them.
 */
export default async function WindowsPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read") && !ctx.permissions.has("admission.interview.manage")) return <NoAccess t={t} />;
  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const [windows, classes, settings] = await Promise.all([listInterviewDays(ctx), listApplyClasses(ctx.schoolId, ctx.locale), loadWebsiteSettings(ctx.schoolId)]);
  const canSet = ctx.permissions.has("admission.interview.manage");
  const canPause = ctx.permissions.has("admission.window.manage") || ctx.permissions.has("website.manage");
  const d = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), ctx.locale);
  const status = (w: (typeof windows)[number]) => (w.from && today < w.from ? { tone: "neutral" as const, text: t("adm.win.status.upcoming", { date: d(w.from) }) } : w.until && today > w.until ? { tone: "neutral" as const, text: t("adm.win.status.closed") } : { tone: "ok" as const, text: t("adm.win.status.open") });
  const byLevel = [...new Set(classes.map((c) => c.level))].map((level) => ({ level, items: classes.filter((c) => c.level === level) }));

  return (
    <>
      <PageHeader title={t("adm.win.title")} subtitle={t("adm.win.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/windows" />

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <Badge tone={settings.applicationsOpen ? "ok" : "warn"}>{settings.applicationsOpen ? t("adm.win.receiving") : t("adm.win.paused")}</Badge>
        <span className="min-w-0 flex-1 text-muted">{settings.applicationsOpen ? t("adm.win.receiving.sub") : t("adm.win.paused.sub")}</span>
        {canPause && (
          <ActionForm action={setApplicationsOpenAction} submitLabel={settings.applicationsOpen ? t("adm.win.pause") : t("adm.win.resume")} inline tone="neutral" confirm={settings.applicationsOpen ? t("adm.win.pause.confirm") : undefined}>
            <input type="hidden" name="open" value={settings.applicationsOpen ? "0" : "1"} />
          </ActionForm>
        )}
      </div>

      {windows.length === 0 ? (
        <p className="mb-5 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t("adm.win.none")}</p>
      ) : (
        <ul className="mb-5 divide-y divide-line rounded-xl border border-line bg-surface">
          {windows.map((w) => {
            const st = status(w);
            return (
              <li key={w.id} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2"><span className="text-base font-semibold text-heading">{w.name || d(w.on)}</span><Badge tone={st.tone}>{st.text}</Badge></p>
                  <p className="mt-1 text-muted">{w.classNames.length ? w.classNames.join(", ") : t("adm.win.allClasses")}</p>
                  <p className="mt-1 text-xs text-muted">
                    {w.from || w.until ? t("adm.win.dates", { from: w.from ? d(w.from) : t("adm.win.now"), until: w.until ? d(w.until) : d(w.on) }) : t("adm.win.untilInterview")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{t("adm.win.interview")}: {d(w.on)} · {w.time}</p>
                  {w.venue && <p className="text-muted">{w.venue}</p>}
                  <p className="mt-1 tabular-nums text-xs text-muted">{w.capacity > 0 ? t("adm.days.placedOf", { n: String(w.placed), max: String(w.capacity) }) : t("adm.days.placed", { n: String(w.placed) })}</p>
                </div>
                {canSet && (
                  <ActionForm action={removeInterviewDayAction} submitLabel={t("adm.days.remove")} inline tone="neutral" confirm={t("adm.win.removeNote")}>
                    <input type="hidden" name="id" value={w.id} />
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canSet && (
        <Card title={t("adm.win.open")}>
          <ActionForm action={addInterviewDayAction} submitLabel={t("adm.win.openGo")} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="name" label={t("adm.win.name")} hint={t("adm.win.name.hint")} required />
              <Field name="venue" label={t("adm.days.venue")} optionalLabel={t("common.optional")} />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("adm.win.classes")}</legend>
              <p className="text-xs text-muted">{t("adm.win.classes.hint")}</p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {byLevel.map((g) => (
                  <div key={g.level}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{g.level}</p>
                    <div className="mt-1 space-y-1">
                      {g.items.map((c) => (
                        <label key={c.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="classIds" value={c.id} className="size-4 accent-brand-600" />{c.name}</label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="from" type="date" label={t("adm.win.from")} required />
              <Field name="until" type="date" label={t("adm.win.until")} required />
              <Field name="capacity" type="number" min={0} label={t("adm.days.capacity")} optionalLabel={t("common.optional")} />
              <Field name="on" type="date" label={t("adm.days.on")} required />
              <Field name="time" type="time" label={t("adm.days.time")} defaultValue="09:00" required />
            </div>
            <p className="text-xs text-muted">{t("adm.win.hint")}</p>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
