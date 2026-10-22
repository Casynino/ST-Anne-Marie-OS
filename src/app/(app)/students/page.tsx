import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { listStudents } from "@/server/students";
import { listClasses } from "@/server/academics";
import { ageOn } from "@/lib/dates";
import { awaitingPlacement } from "@/server/admission-queues";
import { ExportMenu } from "@/components/export-menu";
import { Badge, DataTable, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Students" };
type Search = { q?: string; classId?: string; status?: string; page?: string };

const STATUS_TONE = { ENROLLED: "ok", TRANSFERRED: "warn", WITHDRAWN: "bad", GRADUATED: "brand" } as const;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["student.read", "student.read_assigned"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total, pageSize }, classes, noClass] = await Promise.all([
    listStudents(ctx, { q: sp.q, classId: sp.classId, status: sp.status, page }),
    ctx.permissions.has("academic.read") ? listClasses(ctx) : Promise.resolve([]),
    ctx.permissions.has("student.enroll") ? awaitingPlacement(ctx).then((r) => r.length).catch(() => 0) : Promise.resolve(0),
  ]);

  return (
    <>
      <PageHeader
        title={t("student.title")}
        actions={
          <>
            <ExportMenu base={`/api/export/students?${new URLSearchParams(Object.entries({ q: sp.q ?? "", classId: sp.classId ?? "", status: sp.status ?? "" }).filter(([, v]) => v))}`} t={t} />
            {ctx.permissions.has("registration.read") && <LinkButton href="/students/returning" variant="secondary">{t("lc.nav.returning")}</LinkButton>}
            {ctx.permissions.has("student.import") && <LinkButton href="/students/import" variant="secondary">{t("imp.title")}</LinkButton>}
            {ctx.permissions.has("student.create") && <LinkButton href="/students/new"><Plus className="size-4" aria-hidden /> {t("student.new")}</LinkButton>}
          </>
        }
      />
      {noClass > 0 && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-amber-50 px-3 py-2 text-sm text-warn">
          <span>{t("student.noClass.banner", { n: noClass })}</span>
          <Link href="/admissions/placement" className="font-medium text-link hover:underline">{t("student.noClass.go")}</Link>
        </p>
      )}
      <FilterBar t={t} resetHref="/students">
        <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("student.search")} className="min-w-56 flex-1" />
        <Field name="classId" label={t("student.class")} type="select" defaultValue={sp.classId} placeholder={t("common.all")} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
        <Field name="status" label={t("common.status")} type="select" defaultValue={sp.status} placeholder={t("common.all")} options={(["ENROLLED", "TRANSFERRED", "WITHDRAWN", "GRADUATED"] as const).map((s) => ({ value: s, label: t(`student.status.${s}`) }))} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState>{t("common.noResults")}</EmptyState>
      ) : (
        <DataTable head={[t("common.name"), t("student.admissionNo"), t("student.class"), t("student.gender"), t("student.age"), t("common.status")]}>
          {items.map((s) => {
            const enr = s.enrollments[0];
            return (
              <tr key={s.id} className="hover:bg-canvas">
                <Td><Link href={`/students/${s.id}`} className="font-medium text-link hover:underline">{s.firstName} {s.middleName ?? ""} {s.lastName}</Link></Td>
                <Td className="whitespace-nowrap tabular-nums">{s.admissionNo}</Td>
                <Td>{enr ? `${enr.class.name}${enr.stream ? ` – ${enr.stream.name}` : ""}` : <span className="text-muted">{t("student.notPlaced")}</span>}</Td>
                <Td>{s.gender === "MALE" ? t("student.male") : t("student.female")}</Td>
                <Td>{ageOn(s.dateOfBirth)}</Td>
                <Td><Badge tone={STATUS_TONE[s.status]}>{t(`student.status.${s.status}`)}</Badge></Td>
              </tr>
            );
          })}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/students" params={{ q: sp.q, classId: sp.classId, status: sp.status }} t={t} />
    </>
  );
}
