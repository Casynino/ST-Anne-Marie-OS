import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { listGuardians } from "@/server/guardians";
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
  return (
    <>
      <PageHeader title={t("guardian.title")} />
      <FilterBar t={t} resetHref="/guardians"><Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("guardian.search")} className="min-w-56 flex-1" /></FilterBar>
      {items.length === 0 ? <EmptyState>{t("common.noResults")}</EmptyState> : (
        <DataTable head={[t("common.name"), t("common.phone"), t("guardian.children")]}>
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
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/guardians" params={{ q: sp.q }} t={t} />
    </>
  );
}
