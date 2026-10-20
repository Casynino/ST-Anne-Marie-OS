import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { getSmsAdapter } from "@/lib/sms/adapter";
import { SMS_PROVIDER_KEYS, smsProviderState, smsSecretEnvName } from "@/lib/sms/reports";
import { displayDateTime } from "@/lib/dates";
import { listBroadcasts } from "@/server/communication";
import { countStaffAttention } from "@/server/messaging";
import { getSchoolBasics } from "@/server/settings";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Td } from "@/components/ui";
import { CommunicationNav } from "@/components/communication-nav";

export const metadata: Metadata = { title: "Communication" };

export default async function CommunicationPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["comms.read"])) return <NoAccess t={t} />;
  const [rows, school, attention] = await Promise.all([listBroadcasts(ctx), getSchoolBasics(ctx.schoolId), countStaffAttention(ctx)]);
  const smsOn = getSmsAdapter().isConfigured();
  return (
    <>
      <PageHeader
        title={t("comm.title")}
        subtitle={t("comm.subtitle")}
        actions={<>
          {hasAny(ctx, ["comms.send"]) && <Link href="/communication/new?kind=ANNOUNCEMENT" className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("comm.newNotice")}</Link>}
          {hasAny(ctx, ["comms.fee_reminder"]) && <Link href="/communication/new?kind=FEE_REMINDER" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-canvas">{t("comm.newReminder")}</Link>}
        </>}
      />
      <CommunicationNav ctx={ctx} t={t} current="/communication" attention={attention} />
      <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${smsOn ? "border-ok/30 bg-green-50 text-ok" : "border-warn/30 bg-amber-50 text-warn"}`} role="note">
        {smsOn ? t("comm.sms.on") : t("comm.sms.off")}
      </div>
      {rows.length === 0 ? <EmptyState>{t("comm.empty")}</EmptyState> : (
        <DataTable head={[t("fin.pdf.date"), t("comm.col.message"), t("comm.col.recipients"), t("comm.col.status"), ""]}>
          {rows.map((b) => (
            <tr key={b.id}>
              <Td className="whitespace-nowrap text-sm">{displayDateTime(b.sendAt, school.timezone)}</Td>
              <Td><Link href={`/communication/${b.id}`} className="font-medium text-brand-800 hover:underline">{b.title}</Link><p className="text-xs text-muted">{t(`comm.kind.${b.kind}` as never)}</p></Td>
              <Td className="tabular-nums">{b.recipientCount}</Td>
              <Td className="text-sm">
                {b.cancelledAt && <Badge tone="bad">{t("comm.status.cancelled")}</Badge>}
                {!b.cancelledAt && b.pending > 0 && <Badge tone="warn">{t("comm.status.waiting", { count: b.pending })}</Badge>}
                {!b.cancelledAt && b.pending === 0 && <Badge tone="ok">{t("comm.status.processed")}</Badge>}
                {b.failed > 0 && <> <Badge tone="bad">{t("comm.status.failed", { count: b.failed })}</Badge></>}
              </Td>
              <Td className="text-right"><Link href={`/communication/${b.id}`} className="text-sm font-medium text-brand-800 hover:underline">{t("common.view")}</Link></Td>
            </tr>
          ))}
        </DataTable>
      )}
      {hasAny(ctx, ["comms.manage"]) && (
        <Card title={t("comm.providers.title")} className="mt-8">
          <p className="mb-3 text-sm text-muted">{t("comm.providers.help")}</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {SMS_PROVIDER_KEYS.map((k) => { const p = smsProviderState(k); return <li key={k} className="flex items-center justify-between rounded-lg border border-line px-3 py-2"><span><span className="font-medium">{k}</span> <code className="text-xs text-muted">{smsSecretEnvName(k)}</code></span><Badge tone={p.configured ? "ok" : "neutral"}>{p.configured ? t("fin.recon.configured") : t("fin.recon.notConfigured")}</Badge></li>; })}
          </ul>
        </Card>
      )}
    </>
  );
}
