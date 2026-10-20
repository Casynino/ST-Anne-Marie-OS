import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { getBroadcast } from "@/server/communication";
import { getSchoolBasics } from "@/server/settings";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { CommunicationNav } from "@/components/communication-nav";
import { cancelBroadcastAction } from "../actions";

export const metadata: Metadata = { title: "Message" };
const TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "brand"> = { DELIVERED: "ok", SUBMITTED: "brand", STORED: "ok", QUEUED: "warn", FAILED: "bad", UNKNOWN: "warn", SKIPPED: "neutral" };

export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["comms.read"])) return <NoAccess t={t} />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getBroadcast>>;
  try { d = await getBroadcast(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const school = await getSchoolBasics(ctx.schoolId);
  const b = d.broadcast;
  const canCancel = hasAny(ctx, [b.kind === "FEE_REMINDER" ? "comms.fee_reminder" : "comms.send"]) && !b.cancelledAt && d.events.pending > 0;
  const channel = (c: "IN_APP" | "SMS") => d.deliveries.filter((x) => x.channel === c);
  return (
    <>
      <PageHeader title={b.title} subtitle={`${t(`comm.kind.${b.kind}` as never)} · ${t("comm.by", { name: d.author })} · ${displayDateTime(b.sendAt, school.timezone)}`} actions={<Link href="/communication" className="text-sm font-medium text-link hover:underline">{t("comm.title")}</Link>} />
      <CommunicationNav ctx={ctx} t={t} current="/communication" />
      {b.cancelledAt && <div role="note" className="mb-4 rounded-lg border border-bad/30 bg-red-50 px-4 py-3 text-sm text-bad">{t("comm.cancelledNote", { when: displayDateTime(b.cancelledAt, school.timezone) })}</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("comm.text")}>
          <p className="whitespace-pre-line text-sm">{b.bodyEn}</p>
          {b.bodySw && <><p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">Kiswahili</p><p className="whitespace-pre-line text-sm">{b.bodySw}</p></>}
          <p className="mt-3 text-xs text-muted">{t("comm.channels", { sms: b.sendSms ? t("common.yes") : t("common.no"), inApp: b.sendInApp ? t("common.yes") : t("common.no") })}</p>
        </Card>
        <Card title={t("comm.progress")}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">{t("comm.col.recipients")}</dt><dd className="text-xl font-semibold tabular-nums">{b.recipientCount}</dd></div>
            <div><dt className="text-muted">{t("comm.progress.waiting")}</dt><dd className="text-xl font-semibold tabular-nums">{d.events.pending}</dd></div>
            <div><dt className="text-muted">{t("comm.progress.done")}</dt><dd className="text-xl font-semibold tabular-nums">{d.events.processed}</dd></div>
            <div><dt className="text-muted">{t("comm.progress.failed")}</dt><dd className="text-xl font-semibold tabular-nums">{d.events.failed}</dd></div>
          </dl>
          {canCancel && <ActionForm action={cancelBroadcastAction} submitLabel={t("comm.cancel")} tone="danger" confirm={t("comm.cancelConfirm", { count: d.events.pending })} className="mt-4 space-y-0"><input type="hidden" name="id" value={b.id} /></ActionForm>}
        </Card>
        {(["SMS", "IN_APP"] as const).map((c) => (
          <Card key={c} title={c === "SMS" ? t("comm.f.sms") : t("comm.f.inApp")}>
            {channel(c).length === 0 ? <p className="text-sm text-muted">{t("comm.noDeliveries")}</p> : (
              <ul className="space-y-2 text-sm">{channel(c).map((x) => <li key={x.status} className="flex items-center justify-between"><Badge tone={TONE[x.status] ?? "neutral"}>{t(`comm.delivery.${x.status}` as never)}</Badge><span className="tabular-nums">{x.count}</span></li>)}</ul>
            )}
            {c === "SMS" && <p className="mt-3 text-xs text-muted">{t("comm.smsHonest")}</p>}
          </Card>
        ))}
      </div>
    </>
  );
}
