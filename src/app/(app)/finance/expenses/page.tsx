import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { listExpenseCategories, listExpenses } from "@/server/expenses";
import { Badge, Card, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";
import { createCategoryAction, recordExpenseAction, toggleCategoryAction, voidExpenseAction } from "../actions";

export const metadata: Metadata = { title: "Expenses" };
type Search = { from?: string; to?: string; categoryId?: string; includeVoid?: string; page?: string };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ctx, t, money, unmatched, timezone } = await financePage();
  if (!hasAny(ctx, ["expense.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const clean = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const categories = await listExpenseCategories(ctx);
  const categoryId = categories.find((c) => c.id === sp.categoryId)?.id;
  const data = await listExpenses(ctx, { from: clean(sp.from), to: clean(sp.to), categoryId, includeVoid: sp.includeVoid === "on" ? "on" : "", page: Number(sp.page) || 1 });
  const manage = hasAny(ctx, ["expense.manage"]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  return (
    <>
      <PageHeader title={t("fin.expenses.title")} subtitle={t("fin.expenses.subtitle")} />
      <FinanceNav ctx={ctx} t={t} current="/finance/expenses" unmatched={unmatched} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div>
          <FilterBar t={t} resetHref="/finance/expenses">
            <Field name="from" type="date" label={t("fin.from")} defaultValue={clean(sp.from)} />
            <Field name="to" type="date" label={t("fin.to")} defaultValue={clean(sp.to)} />
            <Field name="categoryId" type="select" label={t("fin.expenses.category")} options={categories.map((c) => ({ value: c.id, label: c.name }))} defaultValue={categoryId ?? ""} placeholder={t("common.all")} />
            <Field name="includeVoid" type="checkbox" label={t("fin.expenses.showVoid")} defaultValue={sp.includeVoid === "on"} />
          </FilterBar>
          <p className="mb-3 text-sm text-muted">{t("fin.expenses.total", { amount: money(data.totalCents), count: data.total })}</p>
          {data.items.length === 0 ? <EmptyState>{t("fin.expenses.empty")}</EmptyState> : (
            <DataTable head={[t("fin.pdf.date"), t("fin.expenses.category"), t("fin.expenses.payee"), t("fin.pdf.method"), t("fin.pdf.amount"), ""]}>
              {data.items.map((e) => (
                <tr key={e.id} className={e.voided ? "text-muted" : undefined}>
                  <Td className="whitespace-nowrap">{displayDate(e.spentOn, ctx.locale)}</Td>
                  <Td>{e.category.name}</Td>
                  <Td>{e.payee}{e.description && <p className="text-xs text-muted">{e.description}</p>}{e.voided && <p className="text-xs text-bad">{t("fin.state.VOID")}: {e.voidReason}</p>}</Td>
                  <Td>{tDynamic(t, "fin.method", e.method)}{e.reference && <p className="text-xs text-muted">{e.reference}</p>}</Td>
                  <Td className={`tabular-nums font-medium ${e.voided ? "line-through" : ""}`}>{money(e.amountCents)}</Td>
                  <Td>{manage && !e.voided && (
                    <details><summary className="min-h-9 cursor-pointer text-xs text-bad">{t("fin.expenses.void")}</summary>
                      <ActionForm action={voidExpenseAction} submitLabel={t("fin.expenses.void")} inline tone="danger" confirm={t("fin.expenses.voidConfirm")} className="mt-2 space-y-1"><input type="hidden" name="id" value={e.id} /><Field name="reason" label={t("marks.reason")} required /></ActionForm>
                    </details>
                  )}{e.voided && <Badge>{t("fin.state.VOID")}</Badge>}</Td>
                </tr>
              ))}
            </DataTable>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/finance/expenses" params={{ from: clean(sp.from), to: clean(sp.to), categoryId, includeVoid: sp.includeVoid }} t={t} />
        </div>
        <div className="space-y-6">
          {manage && (
            <Card title={t("fin.expenses.record")}>
              <ActionForm action={recordExpenseAction} submitLabel={t("fin.expenses.record")}>
                <Field name="categoryId" type="select" label={t("fin.expenses.category")} options={categories.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))} required placeholder={t("common.select")} />
                <Field name="amount" label={t("fin.pdf.amount")} required />
                <Field name="payee" label={t("fin.expenses.payee")} required />
                <Field name="spentOn" type="date" label={t("fin.pdf.date")} defaultValue={today} required />
                <Field name="method" type="select" label={t("fin.pdf.method")} options={(["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((m) => ({ value: m, label: tDynamic(t, "fin.method", m) }))} defaultValue="CASH" required />
                <Field name="reference" label={t("fin.pdf.reference")} optionalLabel={t("fin.referenceOptional")} />
                <Field name="description" label={t("common.notes")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
          <Card title={t("fin.expenses.categories")}>
            <ul className="divide-y divide-line text-sm">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0"><span className={c.isActive ? "" : "text-muted line-through"}>{c.name} <span className="text-xs text-muted">({c._count.expenses})</span></span>
                  {manage && <ActionForm action={toggleCategoryAction} submitLabel={c.isActive ? t("common.inactive") : t("common.active")} inline className="space-y-0"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.isActive ? "false" : "true"} /></ActionForm>}</li>
              ))}
            </ul>
            {manage && <ActionForm action={createCategoryAction} submitLabel={t("fin.expenses.addCategory")} className="mt-4 space-y-3 border-t border-line pt-4"><Field name="name" label={t("grade.name")} required /></ActionForm>}
          </Card>
        </div>
      </div>
    </>
  );
}
