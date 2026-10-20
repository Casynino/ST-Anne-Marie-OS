import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamTerms, listExams } from "@/server/exams";
import { Badge, Card, DataTable, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { createExamAction } from "./actions";

export const metadata: Metadata = { title: "Examinations" };

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ termId?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["exam.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [terms, current] = await Promise.all([listExamTerms(ctx), getCurrentAcademicContext(ctx.schoolId)]);
  const termId = sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : (current.term?.id ?? terms[0]?.id);
  const exams = termId ? await listExams(ctx, { termId }) : [];
  const canManage = hasAny(ctx, ["exam.manage"]);
  const termOptions = terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }));

  return (
    <>
      <PageHeader title={t("exam.title")} subtitle={t("exam.subtitle")} actions={hasAny(ctx, ["marks.enter", "marks.enter_any", "results.approve", "results.read", "results.read_assigned"]) ? <LinkButton href="/marks" variant="secondary">{t("nav.marks")}</LinkButton> : undefined} />
      <FilterBar t={t} resetHref="/exams">
        <Field name="termId" type="select" label={t("exam.term")} options={termOptions} defaultValue={termId ?? ""} placeholder={t("exam.chooseTerm")} />
      </FilterBar>
      {!terms.length ? (
        <EmptyState>{t("exam.noTerms")}</EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <DataTable head={[t("exam.name"), t("exam.category"), t("exam.date"), t("exam.weight"), t("exam.subjects"), ""]} empty={exams.length ? undefined : <p className="px-4 py-10 text-center text-sm text-muted">{t("exam.none")}</p>}>
            {exams.map((e) => (
              <tr key={e.id}>
                <Td><Link href={`/exams/${e.id}`} className="font-medium text-link hover:underline">{e.name}</Link></Td>
                <Td><Badge tone="brand">{tDynamic(t, "exam.cat", e.category)}</Badge></Td>
                <Td>{displayDate(e.examDate, ctx.locale)}</Td>
                <Td className="tabular-nums">{Number(e.weight)}%</Td>
                <Td className="tabular-nums">{e._count.subjects}</Td>
                <Td className="text-right"><Link href={`/exams/${e.id}`} className="text-sm font-medium text-link hover:underline">{t("common.view")}</Link></Td>
              </tr>
            ))}
          </DataTable>
          {canManage && termId && (
            <Card title={t("exam.new")}>
              <ActionForm action={createExamAction} submitLabel={t("exam.create")}>
                <input type="hidden" name="termId" value={termId} />
                <Field name="name" label={t("exam.name")} required placeholder={t("exam.namePh")} />
                <Field name="category" type="select" label={t("exam.category")} options={["MONTHLY", "MIDTERM", "TERMINAL", "ANNUAL", "OTHER"].map((c) => ({ value: c, label: tDynamic(t, "exam.cat", c) }))} defaultValue="TERMINAL" required />
                <Field name="examDate" type="date" label={t("exam.date")} optionalLabel={t("common.optional")} />
                <div className="grid grid-cols-2 gap-3">
                  <Field name="maxMarks" type="number" label={t("exam.maxMarks")} defaultValue={100} required min={1} />
                  <Field name="weight" type="number" label={t("exam.weight")} defaultValue={100} required min={1} max={100} hint={t("exam.weightHint")} />
                </div>
                <Field name="submissionDeadline" type="date" label={t("exam.deadline")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
