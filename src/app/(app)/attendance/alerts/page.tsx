import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listNotificationEvents } from "@/server/notifications";
import { getSchoolBasics } from "@/server/settings";
import { Badge, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";
import { AttendanceNav } from "@/components/attendance/subnav";

export const metadata: Metadata = { title: "Absence alerts" };
const STATUS_TONE = { PENDING: "warn", PROCESSED: "ok", CANCELLED: "neutral", FAILED: "bad" } as const;
const DELIVERY_TONE = { QUEUED: "neutral", SUBMITTED: "warn", DELIVERED: "ok", FAILED: "bad", UNKNOWN: "warn", SKIPPED: "neutral", STORED: "ok" } as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("notification.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [data, school] = await Promise.all([listNotificationEvents(ctx, { status: sp.status, page }), getSchoolBasics(ctx.schoolId)]);

  return (
    <>
      <PageHeader title={t("alert.title")} subtitle={t("alert.intro")} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance/alerts" />
      {data.pending > 0 && <p className="mb-3 text-sm text-warn">{t("alert.pending", { count: data.pending })}</p>}
      <FilterBar t={t} resetHref="/attendance/alerts">
        <Field name="status" type="select" label={t("common.status")} defaultValue={sp.status} placeholder={t("common.all")} options={(["PENDING", "PROCESSED", "CANCELLED", "FAILED"] as const).map((s) => ({ value: s, label: t(`alert.status.${s}`) }))} />
      </FilterBar>
      {data.items.length === 0 ? (
        <EmptyState>{t("common.noResults")}</EmptyState>
      ) : (
        <DataTable head={[t("att.date"), t("alert.student"), t("alert.guardian"), t("common.status"), t("alert.delivery")]}>
          {data.items.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{e.payload.date}<span className="block text-xs text-muted">{displayDateTime(e.createdAt, school.timezone, ctx.locale)}</span></Td>
              <Td>{e.payload.studentName}<span className="block text-xs text-muted">{e.payload.className}{e.payload.streamName ? ` ${e.payload.streamName}` : ""} · {e.payload.sessionName}</span></Td>
              <Td>{e.payload.guardianName}</Td>
              <Td><Badge tone={STATUS_TONE[e.status]}>{t(`alert.status.${e.status}`)}</Badge>{e.lastError && <span className="block text-xs text-bad">{e.lastError}</span>}</Td>
              <Td>
                <ul className="space-y-1">
                  {e.deliveries.map((d) => (
                    <li key={d.channel} className="text-xs">
                      <span className="font-medium">{t(`alert.channel.${d.channel}`)}:</span> <Badge tone={DELIVERY_TONE[d.status]}>{t(`alert.delivery.${d.status}`)}</Badge>
                      {d.detail && <span className="block text-muted">{d.detail}</span>}
                    </li>
                  ))}
                </ul>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={data.pageSize} total={data.total} basePath="/attendance/alerts" params={{ status: sp.status }} t={t} />
    </>
  );
}
