import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { listStaffUsers } from "@/server/users";
import { displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { Badge, DataTable, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Staff & users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  if (!ctx.permissions.has("user.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total, pageSize }, school] = await Promise.all([listStaffUsers(ctx, { q: sp.q, page }), getSchoolBasics(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("users.title")} actions={ctx.permissions.has("user.create") ? <LinkButton href="/users/new"><Plus className="size-4" aria-hidden /> {t("users.new")}</LinkButton> : undefined} />
      <FilterBar t={t} resetHref="/users"><Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("users.search")} className="min-w-56 flex-1" /></FilterBar>
      {items.length === 0 ? <EmptyState>{t("common.noResults")}</EmptyState> : (
        <DataTable head={[t("common.name"), t("users.roles"), t("common.status"), t("users.lastLogin")]}>
          {items.map((u) => (
            <tr key={u.id} className="hover:bg-canvas">
              <Td>
                <Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.fullName}</Link>
                <p className="text-xs text-muted">{u.email ?? u.phone}{u.staff?.jobTitle ? ` · ${u.staff.jobTitle}` : ""}</p>
              </Td>
              <Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.roleId} tone="brand">{r.role.name}</Badge>)}</div></Td>
              <Td><Badge tone={u.status === "ACTIVE" ? "ok" : "bad"}>{t(`users.status.${u.status}`)}</Badge></Td>
              <Td className="whitespace-nowrap text-muted">{u.lastLoginAt ? displayDateTime(u.lastLoginAt, school.timezone, locale) : t("users.never")}</Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/users" params={{ q: sp.q }} t={t} />
    </>
  );
}
