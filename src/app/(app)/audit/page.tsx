import type { Metadata } from "next";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { listAuditFilters, listAuditLogs } from "@/server/audit-log";
import { displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { Field } from "@/components/form";
import { DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };
type Search = { action?: string; entityType?: string; actorId?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  if (!ctx.permissions.has("audit.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total, pageSize }, filters, school] = await Promise.all([
    listAuditLogs(ctx, { ...sp, page }),
    listAuditFilters(ctx),
    getSchoolBasics(ctx.schoolId),
  ]);
  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.intro")} />
      <FilterBar t={t} resetHref="/audit">
        <Field name="action" label={t("audit.actionPrefix")} defaultValue={sp.action} placeholder="student." />
        <Field name="entityType" label={t("audit.entity")} type="select" defaultValue={sp.entityType} placeholder={t("common.all")} options={filters.entityTypes.map((e) => ({ value: e, label: e }))} />
        <Field name="actorId" label={t("audit.actor")} type="select" defaultValue={sp.actorId} placeholder={t("common.all")} options={filters.actors.map((a) => ({ value: a.id, label: a.fullName }))} />
        <Field name="from" label={t("audit.from")} type="date" defaultValue={sp.from} />
        <Field name="to" label={t("audit.to")} type="date" defaultValue={sp.to} />
      </FilterBar>
      {items.length === 0 ? <EmptyState>{t("common.noResults")}</EmptyState> : (
        <DataTable head={[t("audit.when"), t("audit.who"), t("audit.action"), t("audit.record"), t("audit.details")]}>
          {items.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap text-muted">{displayDateTime(l.createdAt, school.timezone, locale)}</Td>
              <Td>{l.actorName ?? t("audit.system")}</Td>
              <Td><code className="rounded bg-canvas px-1.5 py-0.5 text-xs">{l.action}</code></Td>
              <Td>{l.summary ?? `${l.entityType}`}</Td>
              <Td>
                {(l.changes || l.reason) && (
                  <details>
                    <summary className="cursor-pointer text-brand-700">{t("common.view")}</summary>
                    {l.reason && <p className="mt-1 text-xs">{t("common.reason")}: {l.reason}</p>}
                    {l.changes ? <pre className="mt-1 max-w-sm overflow-x-auto whitespace-pre-wrap break-words rounded bg-canvas p-2 text-xs">{JSON.stringify(l.changes, null, 1)}</pre> : null}
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/audit" params={{ action: sp.action, entityType: sp.entityType, actorId: sp.actorId, from: sp.from, to: sp.to }} t={t} />
    </>
  );
}
