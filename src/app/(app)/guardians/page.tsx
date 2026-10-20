import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { listGuardians } from "@/server/guardians";
import { guardianAccountStates } from "@/server/portal";
import { ActionForm } from "@/components/form";
import { Badge } from "@/components/ui";
import { createGuardianAccountAction, resetPortalPasswordAction, setPortalActiveAction } from "./actions";
import { Field } from "@/components/form";
import { DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Guardians" };

export default async function GuardiansPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("guardian.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total, pageSize } = await listGuardians(ctx, { q: sp.q, page });
  const canOpenStudents = ctx.permissions.has("student.read");
  const canPortal = ctx.permissions.has("portal.manage");
  const accounts = canPortal ? await guardianAccountStates(ctx, items.map((g) => g.id)) : new Map();
  return (
    <>
      <PageHeader title={t("guardian.title")} />
      <FilterBar t={t} resetHref="/guardians"><Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("guardian.search")} className="min-w-56 flex-1" /></FilterBar>
      {items.length === 0 ? <EmptyState>{t("common.noResults")}</EmptyState> : (
        <DataTable head={[t("common.name"), t("common.phone"), t("guardian.children"), ...(canPortal ? [t("portal.admin.account")] : [])]}>
          {items.map((g) => (
            <tr key={g.id}>
              <Td><span className="font-medium">{g.fullName}</span>{g.email && <p className="text-xs text-muted">{g.email}</p>}</Td>
              <Td className="whitespace-nowrap">{g.phone}{g.altPhone && <p className="text-xs text-muted">{g.altPhone}</p>}</Td>
              <Td>
                <ul className="space-y-0.5">
                  {g.students.map((l) => (
                    <li key={l.studentId}>{canOpenStudents ? <Link className="text-brand-700 hover:underline" href={`/students/${l.studentId}`}>{l.student.firstName} {l.student.lastName}</Link> : `${l.student.firstName} ${l.student.lastName}`} <span className="text-xs text-muted">· {l.student.admissionNo}</span></li>
                  ))}
                </ul>
              </Td>
              {canPortal && (
                <Td>
                  {(() => {
                    const acc = accounts.get(g.id);
                    if (!acc) {
                      return g.students.length === 0 ? <span className="text-xs text-muted">{t("portal.admin.needsChild")}</span> : (
                        <ActionForm action={createGuardianAccountAction} submitLabel={t("portal.admin.create")} inline className="space-y-1">
                          <input type="hidden" name="guardianId" value={g.id} />
                        </ActionForm>
                      );
                    }
                    return (
                      <div className="space-y-1.5">
                        <p className="flex flex-wrap items-center gap-1.5 text-xs"><Badge tone={acc.status === "ACTIVE" ? "ok" : "bad"}>{acc.status === "ACTIVE" ? t("common.active") : t("portal.admin.suspended")}</Badge>{acc.mustChangePassword && <span className="text-muted">{t("portal.admin.notYetChanged")}</span>}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <ActionForm action={resetPortalPasswordAction} submitLabel={t("portal.admin.resetPassword")} inline confirm={t("portal.admin.resetConfirm")} className="space-y-1"><input type="hidden" name="userId" value={acc.id} /></ActionForm>
                          <ActionForm action={setPortalActiveAction} submitLabel={acc.status === "ACTIVE" ? t("portal.admin.suspend") : t("portal.admin.reactivate")} inline tone={acc.status === "ACTIVE" ? "danger" : "neutral"} className="space-y-1"><input type="hidden" name="userId" value={acc.id} /><input type="hidden" name="active" value={acc.status === "ACTIVE" ? "false" : "true"} /></ActionForm>
                        </div>
                      </div>
                    );
                  })()}
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/guardians" params={{ q: sp.q }} t={t} />
    </>
  );
}
