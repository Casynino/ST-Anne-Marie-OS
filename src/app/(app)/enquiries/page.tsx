import type { Metadata } from "next";
import { Mail, Phone } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { listEnquiries } from "@/server/enquiries";
import { displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, EmptyState, FilterBar, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { updateEnquiryAction } from "./actions";

export const metadata: Metadata = { title: "Enquiries" };
const TONE = { NEW: "warn", IN_PROGRESS: "brand", RESOLVED: "ok" } as const;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  if (!ctx.permissions.has("enquiry.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total, pageSize, counts }, school] = await Promise.all([listEnquiries(ctx, { status: sp.status, page }), getSchoolBasics(ctx.schoolId)]);
  const canManage = ctx.permissions.has("enquiry.manage");
  const statuses = ["NEW", "IN_PROGRESS", "RESOLVED"] as const;

  return (
    <>
      <PageHeader title={t("enq.title")} subtitle={t("enq.intro")} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {statuses.map((s) => <div key={s} className="rounded-xl border border-line bg-white p-4"><p className="text-sm text-muted">{t(`enq.status.${s}`)}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{counts[s] ?? 0}</p></div>)}
      </div>
      <FilterBar t={t} resetHref="/enquiries"><Field name="status" label={t("common.status")} type="select" defaultValue={sp.status} placeholder={t("common.all")} options={statuses.map((s) => ({ value: s, label: t(`enq.status.${s}`) }))} /></FilterBar>
      {items.length === 0 ? <EmptyState>{t("enq.empty")}</EmptyState> : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li key={e.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{e.name} {e.topic && <span className="font-normal text-muted">· {e.topic}</span>}</p>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                      {e.phone && <a className="inline-flex items-center gap-1 hover:text-ink" href={`tel:${e.phone}`}><Phone className="size-4" aria-hidden />{e.phone}</a>}
                      {e.email && <a className="inline-flex items-center gap-1 hover:text-ink" href={`mailto:${e.email}`}><Mail className="size-4" aria-hidden />{e.email}</a>}
                      <span>{displayDateTime(e.createdAt, school.timezone, locale)}</span>
                    </p>
                  </div>
                  <Badge tone={TONE[e.status]}>{t(`enq.status.${e.status}`)}</Badge>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm">{e.message}</p>
                {canManage && (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-brand-700">{t("enq.update")}</summary>
                    <ActionForm action={updateEnquiryAction} submitLabel={t("common.save")} className="mt-2 grid gap-3 sm:grid-cols-3 sm:items-end">
                      <input type="hidden" name="id" value={e.id} />
                      <Field name="status" label={t("common.status")} type="select" defaultValue={e.status} options={statuses.map((s) => ({ value: s, label: t(`enq.status.${s}`) }))} required />
                      <Field name="internalNote" label={t("enq.note")} defaultValue={e.internalNote} optionalLabel={t("common.optional")} className="sm:col-span-2" />
                    </ActionForm>
                  </details>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/enquiries" params={{ status: sp.status }} t={t} />
    </>
  );
}
