import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { formatMoney } from "@/lib/finance/money";
import { getSchoolBasics } from "@/server/settings";
import { admissionReport } from "@/server/admission-reports";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ExportMenu } from "@/components/export-menu";
import { HBars } from "@/components/dash/parts";
import { Card, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Admissions reports" };
const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export default async function AdmissionReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const from = ok(sp.from), to = ok(sp.to);
  const [r, school] = await Promise.all([admissionReport(ctx, { from, to }), getSchoolBasics(ctx.schoolId)]);
  const money = (c: number) => formatMoney(c, school.currency);
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  return (
    <>
      <PageHeader title={t("adm.report.title")} subtitle={t("adm.report.sub")} actions={<ExportMenu base={`/api/export/admissions${qs ? `?${qs}` : ""}`} t={t} />} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/reports" />
      <FilterBar t={t} resetHref="/admissions/reports">
        <Field name="from" type="date" label={t("adm.report.from")} defaultValue={from} />
        <Field name="to" type="date" label={t("adm.report.to")} defaultValue={to} />
      </FilterBar>
      {r.funnel[0]!.value === 0 && r.fees.verifiedCents === 0 ? <EmptyState>{t("adm.report.empty")}</EmptyState> : (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={t("adm.report.funnel")}>
              <HBars items={r.funnel.map((f) => ({ label: t(`adm.report.f.${f.key}` as "adm.report.f.received"), value: f.value }))} label={t("adm.report.funnel")} summary={r.funnel.map((f) => `${t(`adm.report.f.${f.key}` as "adm.report.f.received")}: ${f.value}`).join(", ")} />
            </Card>
            <Card title={t("adm.report.conversion")}>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted">{t("adm.report.c.receivedToEnrolled")}</dt><dd className="text-2xl font-semibold tabular-nums">{pct(r.conversion.receivedToEnrolled)}</dd></div>
                <div><dt className="text-muted">{t("adm.report.c.offeredToEnrolled")}</dt><dd className="text-2xl font-semibold tabular-nums">{pct(r.conversion.offeredToEnrolled)}</dd></div>
                <div><dt className="text-muted">{t("adm.report.c.interviewedToPassed")}</dt><dd className="text-2xl font-semibold tabular-nums">{pct(r.conversion.interviewedToPassed)}</dd></div>
              </dl>
              <h3 className="mb-2 mt-5 text-sm font-semibold">{t("adm.report.source")}</h3>
              <p className="text-sm"><Link href="/admissions?source=ONLINE" className="text-link hover:underline">{t("adm.channel.ONLINE")}: <b className="tabular-nums">{r.bySource.online}</b></Link> · <Link href="/admissions?source=STAFF" className="text-link hover:underline">{t("adm.channel.STAFF")}: <b className="tabular-nums">{r.bySource.physical}</b></Link></p>
            </Card>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={t("adm.report.status")}>
              <HBars items={(["APPLIED", "INTERVIEW", "ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const).map((s) => ({ label: t(`adm.status.${s}`), value: r.byStatus[s] ?? 0 }))} label={t("adm.report.status")} summary={t("adm.report.status")} />
            </Card>
            <Card title={t("adm.report.interviews")}>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted">{t("adm.report.interviews.scheduled")}</dt><dd className="text-xl font-semibold tabular-nums">{r.interviews.scheduled}</dd></div>
                <div><dt className="text-muted">{t("adm.report.interviews.completed")}</dt><dd className="text-xl font-semibold tabular-nums">{r.interviews.completed}</dd></div>
                <div><dt className="text-muted">{t("adm.report.interviews.cancelled")}</dt><dd className="text-xl font-semibold tabular-nums">{r.interviews.cancelled}</dd></div>
                <div><dt className="text-muted">{t("adm.report.interviews.noShow")}</dt><dd className="text-xl font-semibold tabular-nums">{r.interviews.noShow}</dd></div>
              </dl>
              <ul className="mt-4 space-y-1 text-sm">{Object.entries(r.interviews.outcomes).map(([k, v]) => <li key={k} className="flex justify-between"><span>{t(`adm.iv.outcome.${k}` as "adm.iv.outcome.PASSED")}</span><span className="tabular-nums">{v}</span></li>)}</ul>
            </Card>
          </div>
          <Card title={t("adm.report.byClass")}>
            <DataTable head={[t("adm.classApplied"), t("adm.report.f.received"), t("adm.report.f.enrolled")]}>
              {r.byClass.map((c) => <tr key={c.className}><Td>{c.className}</Td><Td className="tabular-nums">{c.received}</Td><Td className="tabular-nums">{c.enrolled}</Td></tr>)}
            </DataTable>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={t("adm.report.fees")}>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-muted">{t("adm.report.fees.verified")}</dt><dd className="text-lg font-semibold tabular-nums text-ok">{money(r.fees.verifiedCents)}</dd></div>
                <div><dt className="text-muted">{t("adm.report.fees.pending")}</dt><dd className="text-lg font-semibold tabular-nums">{money(r.fees.pendingCents)}</dd></div>
                <div><dt className="text-muted">{t("adm.report.fees.reversed")}</dt><dd className="text-lg font-semibold tabular-nums">{money(r.fees.reversedCents)}</dd></div>
              </dl>
              <ul className="mt-4 space-y-1 text-sm">{r.fees.byMethod.map((m) => <li key={m.method} className="flex justify-between"><span>{t(`fin.method.${m.method}` as "fin.method.CASH")}</span><span className="tabular-nums">{money(m.cents)}</span></li>)}</ul>
            </Card>
            <Card title={t("adm.report.placement")}>
              <p className="mb-3 text-sm text-muted">{t("adm.report.placement.awaiting")}: <b className="tabular-nums text-ink">{r.placement.awaiting}</b> / {r.placement.enrolled}</p>
              <ul className="space-y-1 text-sm">{r.placement.byClass.map((c) => <li key={c.className} className="flex justify-between"><span>{c.className}</span><span className="tabular-nums">{c.value}</span></li>)}</ul>
              <h3 className="mb-1 mt-5 text-sm font-semibold">{t("adm.report.leavers")}</h3>
              <p className="text-sm text-muted">{t("adm.report.l.transferred")}: <b className="tabular-nums text-ink">{r.leavers.transferred}</b> · {t("adm.report.l.withdrawn")}: <b className="tabular-nums text-ink">{r.leavers.withdrawn}</b> · {t("adm.report.l.graduated")}: <b className="tabular-nums text-ink">{r.leavers.graduated}</b></p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
