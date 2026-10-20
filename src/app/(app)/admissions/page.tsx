import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { listApplications } from "@/server/admissions";
import { Badge, DataTable, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Admissions" };
type Search = { q?: string; status?: string; page?: string };
const TONE = { APPLIED: "neutral", INTERVIEW: "warn", ACCEPTED: "brand", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;
const STATUSES = ["APPLIED", "INTERVIEW", "ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const;

export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total, pageSize, counts } = await listApplications(ctx, { q: sp.q, status: sp.status, page });

  return (
    <>
      <PageHeader title={t("adm.title")} actions={ctx.permissions.has("admission.create") ? <LinkButton href="/admissions/new"><Plus className="size-4" aria-hidden /> {t("adm.new")}</LinkButton> : undefined} />
      <ul className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <li key={s}>
            <Link href={`/admissions?status=${s}`} aria-current={sp.status === s ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${sp.status === s ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white hover:bg-canvas"}`}>
              {t(`adm.status.${s}`)} <span className="tabular-nums opacity-80">{counts[s] ?? 0}</span>
            </Link>
          </li>
        ))}
      </ul>
      <FilterBar t={t} resetHref="/admissions">
        <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("adm.search")} className="min-w-56 flex-1" />
        <Field name="status" label={t("common.status")} type="select" defaultValue={sp.status} placeholder={t("common.all")} options={STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}`) }))} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState>{t("adm.none")}</EmptyState>
      ) : (
        <DataTable head={[t("adm.applicant"), t("adm.applicationNo"), t("adm.classApplied"), t("adm.guardian"), t("adm.appliedOn"), t("common.status")]}>
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-canvas">
              <Td><Link href={`/admissions/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.firstName} {a.lastName}</Link></Td>
              <Td className="whitespace-nowrap tabular-nums">{a.applicationNo}</Td>
              <Td>{a.className ?? "—"}</Td>
              <Td>{a.primaryGuardian?.fullName ?? "—"}</Td>
              <Td className="whitespace-nowrap">{displayDate(a.createdAt, ctx.locale)}</Td>
              <Td><Badge tone={TONE[a.status]}>{t(`adm.status.${a.status}`)}</Badge></Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/admissions" params={{ q: sp.q, status: sp.status }} t={t} />
    </>
  );
}
