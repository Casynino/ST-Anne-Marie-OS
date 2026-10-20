import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Activity, AlertTriangle, Bug, CheckCircle2, DatabaseBackup, LogIn, ShieldAlert, Timer, Users } from "lucide-react";
import { requireContext, getT, getLocale, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { activityPanel, securityPanel, systemPanel } from "@/server/ops";
import { DashSection, EmptyLine, HBars, KpiCard, Panel, PersonCell, Pill, StackedBars } from "@/components/dash/parts";
import { NoAccess, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "System health" };

/** The technical side of the system for the person who looks after it: sign-ins, failed sign-ins, errors, jobs, speed and size. */
export default async function SystemHealthPage() {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  if (!hasAny(ctx, ["backup.read"])) return <NoAccess t={t} />;
  const [act, sec, sys] = await Promise.all([hasAny(ctx, ["audit.read"]) ? activityPanel(ctx) : null, hasAny(ctx, ["audit.read"]) ? securityPanel(ctx) : null, systemPanel(ctx)]);
  const fmtDay = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), locale).slice(0, 6);
  const ago = (when: Date) => { const m = Math.round((Date.now() - when.getTime()) / 60000); return m < 1 ? t("dash.ago.now") : m < 60 ? t("dash.ago.min", { n: m }) : m < 48 * 60 ? t("dash.ago.hours", { n: Math.round(m / 60) }) : t("dash.ago.days", { n: Math.round(m / 1440) }); };
  const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <>
      <Link href="/settings" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("settings.title")}</Link>
      <PageHeader title={t("sysh.title")} subtitle={t("sysh.subtitle")} />
      {act && (
        <DashSection id="activity" title={t("dash.sec.activity")} subtitle={t("dash.sec.activity.sub")}>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <li><KpiCard icon={Users} label={t("dash.act.signedInToday")} value={act.signedInToday} caption={t("dash.act.signedInToday.cap")} pill={{ text: t("dash.pill.live"), tone: "ok" }} /></li>
            <li><KpiCard icon={Activity} label={t("dash.act.actions14")} value={act.actions14.toLocaleString()} caption={t("dash.act.actions14.cap")} pill={{ text: t("dash.pill.activity"), tone: "info" }} /></li>
            <li><KpiCard icon={LogIn} label={t("dash.act.signIns14")} value={act.signIns14.toLocaleString()} caption={t("dash.act.signIns14.cap")} pill={{ text: t("dash.pill.signIns"), tone: "info" }} /></li>
            <li><KpiCard icon={ShieldAlert} label={t("dash.act.failed24")} value={sec?.failed24 ?? act.failed24} caption={t("dash.act.failed24.cap")} pill={((sec?.failed24 ?? act.failed24) === 0 ? { text: t("dash.pill.normal"), tone: "ok" } : (sec?.failed24 ?? act.failed24) <= 5 ? { text: t("dash.pill.watch"), tone: "warn" } : { text: t("dash.pill.alert"), tone: "bad" })} /></li>
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
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead><tr className="border-y border-line text-left text-[11px] font-bold uppercase tracking-[.12em] text-muted"><th className="px-5 py-2.5">{t("dash.act.person")}</th><th className="px-3 py-2.5">{t("dash.act.device")}</th><th className="px-3 py-2.5">{t("dash.act.from")}</th><th className="px-5 py-2.5 text-right">{t("audit.when")}</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {act.recentSignIns.map((r, i) => (
                        <tr key={i}>
                          <td className="px-5 py-3"><PersonCell name={r.name} sub={r.role} /></td>
                          <td className="px-3 py-3 text-ink/80">{r.device.label}</td>
                          <td className="px-3 py-3 font-mono text-xs text-muted">{r.ip ?? "—"}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-muted">{ago(r.at)}</td>
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
      )}

      {sec && (
        <DashSection id="security" title={t("dash.sec.security")} subtitle={t("dash.sec.security.sub")}>
          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Panel title={t("dash.sec2.perDay")} subtitle={t("dash.sec2.perDay.sub", { n: sec.failed14 })}>
              <StackedBars points={sec.perDay.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "failed", label: t("dash.sec2.failed"), color: "#e0a100" }]} label={t("dash.sec2.perDay")} summary={t("dash.sec2.perDay.sub", { n: sec.failed14 })} />
            </Panel>
            <Panel title={t("dash.sec2.latest")} subtitle={t("dash.sec2.latest.sub")}>
              {sec.latest.length === 0 ? <EmptyLine>{t("dash.sec2.none")}</EmptyLine> : (
                <ul className="divide-y divide-line">
                  {sec.latest.map((l, i) => <li key={i} className="py-2.5 first:pt-0 last:pb-0"><p className="break-all font-medium text-ink">{l.identifier}{l.repeats > 1 && <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs font-semibold text-muted">×{l.repeats}</span>}</p><p className="text-xs text-muted">{ago(l.at)} · <span className="font-mono">{l.ip ?? "—"}</span></p></li>)}
                </ul>
              )}
            </Panel>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Panel title={t("dash.sec2.byAddress")} subtitle={t("dash.sec2.byAddress.sub")} className="overflow-hidden">
              {sec.byAddress.length === 0 ? <EmptyLine>{t("dash.sec2.none")}</EmptyLine> : (
                <div className="-mx-5 overflow-x-auto"><table className="w-full min-w-[26rem] text-sm"><thead><tr className="border-y border-line text-left text-[11px] font-bold uppercase tracking-[.12em] text-muted"><th className="px-5 py-2.5">{t("dash.act.from")}</th><th className="px-3 py-2.5 text-right">{t("dash.sec2.tries")}</th><th className="px-3 py-2.5 text-right">{t("dash.sec2.accounts")}</th><th className="px-5 py-2.5 text-right">{t("dash.sec2.last")}</th></tr></thead>
                  <tbody className="divide-y divide-line">{sec.byAddress.map((a) => <tr key={a.ip}><td className="px-5 py-2.5 font-mono text-xs">{a.ip}</td><td className="px-3 py-2.5 text-right tabular-nums">{a.tries}</td><td className="px-3 py-2.5 text-right tabular-nums">{a.accounts}</td><td className="whitespace-nowrap px-5 py-2.5 text-right text-muted">{ago(a.last)}</td></tr>)}</tbody></table></div>
              )}
            </Panel>
            <section className={`flex items-center gap-4 rounded-2xl border p-5 ${sec.yourFailed24 === 0 ? "border-ok/30 bg-ok/10" : "border-warn/30 bg-warn/10"}`}>
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${sec.yourFailed24 === 0 ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>{sec.yourFailed24 === 0 ? <CheckCircle2 className="size-5" aria-hidden /> : <AlertTriangle className="size-5" aria-hidden />}</span>
              <div><h3 className="font-semibold text-ink">{t("dash.sec2.yours")}</h3><p className="text-sm text-muted">{sec.yourFailed24 === 0 ? t("dash.sec2.yours.ok") : t("dash.sec2.yours.bad", { n: sec.yourFailed24 })}</p></div>
            </section>
          </div>
        </DashSection>
      )}

      {sys && (
        <>
          <DashSection id="system" eyebrow={t("dash.sec.systemEyebrow")} title={t("dash.sec.system")} subtitle={t("dash.sec.system.sub")}>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <li><KpiCard icon={Bug} label={t("dash.sys.errors")} value={sys.errors24} caption={t("dash.sys.errors.cap")} pill={sys.errors24 === 0 ? { text: t("dash.pill.normal"), tone: "ok" } : { text: t("dash.pill.watch"), tone: "warn" }} /></li>
              <li><KpiCard icon={Timer} label={t("dash.sys.jobs")} value={`${sys.jobsGood} ${t("dash.sys.of")} ${sys.jobs.length}`} caption={t("dash.sys.jobs.cap")} pill={sys.jobsGood === sys.jobs.length ? { text: t("dash.pill.ok"), tone: "ok" } : { text: t("dash.pill.late"), tone: "bad" }} /></li>
              <li><KpiCard icon={AlertTriangle} label={t("dash.sys.lastError")} value={sys.lastError ? ago(sys.lastError.at) : t("dash.sys.none")} caption={sys.lastError ? `${sys.lastError.name}: ${sys.lastError.message}`.slice(0, 90) : t("dash.sys.lastError.none")} pill={sys.lastError ? { text: t("dash.pill.seen"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
              <li><KpiCard icon={DatabaseBackup} label={t("dash.sys.backup")} value={sys.backup.lastSuccessAt ? ago(sys.backup.lastSuccessAt) : t("dash.sys.none")} caption={t("dash.sys.backup.cap")} href="/settings/backups" openLabel={t("dash.kpi.open")} pill={sys.backup.level === "ok" ? { text: t("dash.pill.ok"), tone: "ok" } : sys.backup.level === "warn" ? { text: t("dash.pill.late"), tone: "warn" } : { text: t("dash.pill.alert"), tone: "bad" }} /></li>
            </ul>
            <div className="mt-4 rounded-2xl border border-line bg-surface p-5 text-sm shadow-[var(--shadow-card)]">
              <p className="font-semibold text-ink">{t("dash.sys.jobList")}</p>
              <ul className="mt-2 divide-y divide-line">{sys.jobs.map((j) => <li key={j.name} className="flex items-center justify-between gap-3 py-2"><span>{j.label}</span><span className="flex items-center gap-3 text-muted">{j.lastAt ? ago(j.lastAt) : t("dash.sys.neverRan")}<Pill tone={j.ok && j.onTime ? "ok" : "bad"}>{j.ok && j.onTime ? t("dash.pill.ok") : t("dash.pill.late")}</Pill></span></li>)}</ul>
            </div>
          </DashSection>

          <DashSection id="speed" title={t("dash.sec.speed")} subtitle={t("dash.sec.speed.sub")}>
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <Panel title={t("dash.speed.title")} subtitle={t("dash.speed.sub")}>
                <ul className="divide-y divide-line text-sm">{sys.speed.map((q) => <li key={q.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"><span>{t(`dash.speed.${q.label}` as "dash.speed.title")}</span><span className="flex items-center gap-3"><span className="font-semibold tabular-nums">{q.ms} ms</span><Pill tone={q.level}>{q.level === "ok" ? t("dash.speed.fast") : q.level === "warn" ? t("dash.speed.slowish") : t("dash.speed.slow")}</Pill></span></li>)}</ul>
              </Panel>
              <Panel title={t("dash.size.title")} subtitle={t("dash.size.sub")}>
                <p className="text-3xl font-semibold tabular-nums text-ink">{bytes(sys.dbBytes)}</p>
                <p className="mb-4 text-sm text-muted">{t("dash.size.files", { n: sys.files.count, size: bytes(sys.files.bytes) })}</p>
                <HBars items={sys.tables.map((x) => ({ label: `${x.name} · ${x.rows.toLocaleString()}`, value: x.bytes }))} label={t("dash.size.tables")} summary={t("dash.size.tables")} tone="#4f46e5" format={bytes} />
              </Panel>
            </div>
          </DashSection>
        </>
      )}
    </>
  );
}
