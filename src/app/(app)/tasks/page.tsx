import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { assignableStaff, listTasks, taskCounts, taskHref, visibleDepartments } from "@/server/workflow";
import { ActionForm, Field } from "@/components/form";
import { Badge, DataTable, EmptyState, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { assignTaskAction, completeTaskAction, refreshFinanceTasksAction, startTaskAction } from "./actions";

export const metadata: Metadata = { title: "Tasks" };
type Search = { department?: string; state?: string; page?: string };
const STATES = ["open", "overdue", "mine", "done"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (visibleDepartments(ctx).length === 0) return <NoAccess t={t} />;
  const sp = await searchParams;
  const state = (STATES as readonly string[]).includes(sp.state ?? "") ? sp.state! : "open";
  const data = await listTasks(ctx, { department: sp.department ?? "", state, page: Number(sp.page) || 1 });
  const [counts, staff] = await Promise.all([taskCounts(ctx), assignableStaff(ctx).catch(() => [])]);
  const chip = (href: string, active: boolean, label: string, n?: number) => (
    <li key={href}><Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface hover:bg-canvas"}`}>{label}{n !== undefined && <span className="tabular-nums opacity-80">{n}</span>}</Link></li>
  );
  const q = (o: Record<string, string | undefined>) => `/tasks?${new URLSearchParams(Object.entries({ department: sp.department, state, ...o }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <>
      <PageHeader title={t("task.title")} subtitle={t("task.sub")} actions={(ctx.permissions.has("tasks.finance") || ctx.permissions.has("tasks.admin")) ? <ActionForm action={refreshFinanceTasksAction} submitLabel={t("task.refresh")} inline className="space-y-0" /> : undefined} />
      <ul className="mb-3 flex flex-wrap gap-2" aria-label={t("task.dept")}>
        {chip(q({ department: undefined }), !sp.department, t("adm.stage.all"), counts.reduce((n, c) => n + c.open, 0))}
        {counts.map((c) => chip(q({ department: c.department }), sp.department === c.department, `${t(`task.dept.${c.department}` as "task.dept.ADMISSIONS")}${c.overdue > 0 ? ` (${c.overdue} ${t("task.overdue").toLowerCase()})` : ""}`, c.open))}
      </ul>
      <ul className="mb-4 flex flex-wrap gap-2" aria-label={t("common.status")}>
        {STATES.map((s) => chip(q({ state: s }), state === s, t(`task.state.${s}` as "task.state.open")))}
      </ul>
      {data.items.length === 0 ? <EmptyState>{t("task.none")}</EmptyState> : (
        <DataTable head={[t("task.col.task"), t("task.dept"), t("task.col.assigned"), t("task.col.due"), t("common.status"), ""]}>
          {data.items.map((r) => {
            const href = taskHref(r);
            return (
              <tr key={r.id}>
                <Td>
                  <span className="font-medium">{t(`task.kind.${r.kind}` as "task.kind.APPLICATION_REVIEW")}</span>
                  <span className="block text-sm text-muted">{href ? <Link href={href} className="text-link hover:underline">{r.relatedLabel ?? r.relatedId}</Link> : r.relatedLabel}</span>
                  {r.completionNote && <span className="block text-xs text-muted">{r.completionNote}</span>}
                </Td>
                <Td>{t(`task.dept.${r.department}` as "task.dept.ADMISSIONS")}</Td>
                <Td>{r.assignedTo ?? "—"}</Td>
                <Td className="whitespace-nowrap">{r.dueOn ? displayDate(r.dueOn, ctx.locale) : "—"}</Td>
                <Td>{r.overdue ? <Badge tone="bad">{t("task.overdue")}</Badge> : <Badge tone={r.status === "COMPLETED" ? "ok" : r.status === "CANCELLED" ? "neutral" : r.status === "IN_PROGRESS" ? "brand" : "warn"}>{t(`task.status.${r.status}` as "task.status.PENDING")}</Badge>}</Td>
                <Td>
                  {r.canWork && (r.status === "PENDING" || r.status === "IN_PROGRESS") && (
                    <div className="flex flex-wrap items-start gap-2">
                      {r.status === "PENDING" && <ActionForm action={startTaskAction} submitLabel={t("task.start")} inline className="space-y-0"><input type="hidden" name="id" value={r.id} /></ActionForm>}
                      <details><summary className="min-h-9 cursor-pointer text-xs text-link">{t("task.more")}</summary>
                        <div className="mt-2 grid gap-3 sm:w-64">
                          <ActionForm action={assignTaskAction} submitLabel={t("task.assign")} inline className="space-y-2"><input type="hidden" name="id" value={r.id} /><Field name="userId" type="select" label={t("task.col.assigned")} options={staff.map((u) => ({ value: u.id, label: u.fullName }))} defaultValue={r.assignedToId ?? ""} placeholder={t("task.unassigned")} /></ActionForm>
                          <ActionForm action={completeTaskAction} submitLabel={t("task.complete")} inline className="space-y-2"><input type="hidden" name="id" value={r.id} /><Field name="note" label={t("task.note")} optionalLabel={t("common.optional")} /></ActionForm>
                        </div>
                      </details>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </DataTable>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/tasks" params={{ department: sp.department, state }} t={t} />
    </>
  );
}
