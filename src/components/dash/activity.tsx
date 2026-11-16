import { Activity, LogIn, ShieldAlert, Users } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import type { activityPanel } from "@/server/ops";
import { DashSection, EmptyLine, HBars, KpiCard, Panel, PersonCell, Pill, StackedBars } from "./parts";

/** Who signs in and what the team does: sign-ins and actions per day, the busiest hours, where the work happens, who is online and who is not using the system. Shared by the administrator's home and the system page. */
export function ActivityBlock({ t, act, failed24, fmtDay, ago, id = "activity" }: { t: Translate; act: NonNullable<Awaited<ReturnType<typeof activityPanel>>>; failed24: number; fmtDay: (iso: string) => string; ago: (when: Date) => string; id?: string }) {
  return (
    <DashSection id={id} title={t("dash.sec.activity")} subtitle={t("dash.sec.activity.sub")}>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <li><KpiCard icon={Users} label={t("dash.act.signedInToday")} value={act.signedInToday} caption={t("dash.act.signedInToday.cap")} pill={{ text: t("dash.pill.live"), tone: "ok" }} /></li>
        <li><KpiCard icon={Activity} label={t("dash.act.actions14")} value={act.actions14.toLocaleString()} caption={t("dash.act.actions14.cap")} pill={{ text: t("dash.pill.activity"), tone: "info" }} /></li>
        <li><KpiCard icon={LogIn} label={t("dash.act.signIns14")} value={act.signIns14.toLocaleString()} caption={t("dash.act.signIns14.cap")} pill={{ text: t("dash.pill.signIns"), tone: "info" }} /></li>
        <li><KpiCard icon={ShieldAlert} label={t("dash.act.failed24")} value={failed24} caption={t("dash.act.failed24.cap")} pill={((failed24) === 0 ? { text: t("dash.pill.normal"), tone: "ok" } : (failed24) <= 5 ? { text: t("dash.pill.watch"), tone: "warn" } : { text: t("dash.pill.alert"), tone: "bad" })} /></li>
      </ul>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title={t("dash.act.signInsPerDay")} subtitle={t("dash.act.signInsPerDay.sub")}>
          <StackedBars points={act.signInsByRole.days.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={act.signInsByRole.series.map((r) => ({ key: r, label: r }))} label={t("dash.act.signInsPerDay")} summary={t("dash.act.signInsPerDay.sub")} />
        </Panel>
        <Panel title={t("dash.act.actionsPerDay")} subtitle={t("dash.act.actionsPerDay.sub")}>
          <StackedBars points={act.actionsByKind.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "staff", label: t("dash.act.kind.staff") }, { key: "family", label: t("dash.act.kind.family") }, { key: "visitor", label: t("dash.act.kind.visitor") }]} label={t("dash.act.actionsPerDay")} summary={t("dash.act.actionsPerDay.sub")} />
        </Panel>
        <Panel title={t("dash.act.busiest")} subtitle={act.peakHour === null ? t("dash.act.busiest.none") : t("dash.act.busiest.sub", { hour: `${String(act.peakHour).padStart(2, "0")}:00` })}>
          <StackedBars points={act.hours.map((n, h) => ({ key: String(h), label: `${h}h`, parts: { n } }))} series={[{ key: "n", label: t("dash.act.actions14") }]} every={3} label={t("dash.act.busiest")} summary={t("dash.act.busiest")} />
        </Panel>
        <Panel title={t("dash.act.where")} subtitle={t("dash.act.where.sub")}>
          {act.areas.length === 0 ? <EmptyLine>{t("dash.act.none")}</EmptyLine> : <HBars items={act.areas} label={t("dash.act.where")} summary={t("dash.act.where.sub")} />}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title={t("dash.act.recent")} subtitle={t("dash.act.recent.sub")} className="overflow-hidden">
          {act.recentSignIns.length === 0 ? <EmptyLine>{t("dash.act.none")}</EmptyLine> : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead><tr className="border-y border-line text-left text-[11px] font-bold uppercase tracking-[.12em] text-muted"><th className="px-5 py-2.5">{t("dash.act.person")}</th><th className="px-3 py-2.5">{t("dash.act.device")}</th><th className="px-3 py-2.5">{t("dash.act.from")}</th><th className="px-5 py-2.5 text-right">{t("audit.when")}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {act.recentSignIns.map((r, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5"><PersonCell name={r.name} sub={r.role} /></td>
                      <td className="px-3 py-3 text-ink/80">{r.device.label}</td>
                      <td className="px-3 py-3 font-mono text-xs text-muted">{r.ip ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted">{ago(r.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title={t("dash.act.online")} subtitle={t("dash.act.online.sub")} right={<span className="rounded-md bg-canvas px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{act.online.length}</span>}>
            {act.online.length === 0 ? <p className="text-sm text-muted">{t("dash.act.online.none")}</p> : <ul className="space-y-3">{act.online.slice(0, 6).map((o, i) => <li key={i}><PersonCell name={o.name} sub={o.role} /></li>)}</ul>}
          </Panel>
          <Panel title={t("dash.act.mostActive")} subtitle={t("dash.act.mostActive.sub")}>
            {act.mostActive.length === 0 ? <EmptyLine>{t("dash.act.none")}</EmptyLine> : <HBars items={act.mostActive.map((m) => ({ label: m.name, value: m.count }))} label={t("dash.act.mostActive")} summary={t("dash.act.mostActive.sub")} tone="#14a3b8" />}
          </Panel>
          <Panel title={t("dash.act.notUsing")} subtitle={t("dash.act.notUsing.sub")}>
            {act.inactive.length === 0 ? <p className="text-sm text-muted">{t("dash.act.notUsing.none")}</p> : (
              <ul className="space-y-2.5 text-sm">{act.inactive.map((u, i) => <li key={i} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate"><span className="font-semibold text-ink">{u.name}</span> <span className="text-muted">· {u.role}</span></span>{u.lastLoginAt ? <span className="shrink-0 text-muted">{ago(u.lastLoginAt)}</span> : <Pill tone="warn">{t("dash.act.never")}</Pill>}</li>)}</ul>
            )}
            {act.portalNeverSignedIn > 0 && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{t("dash.act.portalNever", { n: act.portalNeverSignedIn })}</p>}
          </Panel>
        </div>
      </div>
    </DashSection>
  );
}
