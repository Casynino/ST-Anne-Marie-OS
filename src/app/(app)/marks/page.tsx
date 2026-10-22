import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { SUBMISSION_TONE } from "@/lib/results/ui";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamTerms } from "@/server/exams";
import { listSubmissions } from "@/server/marks";
import { Badge, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Td, segClass } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Marks" };

export default async function MarksPage({ searchParams }: { searchParams: Promise<{ termId?: string; view?: string; status?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["marks.enter", "marks.enter_any", "results.read", "results.read_assigned", "results.approve"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const canEnter = hasAny(ctx, ["marks.enter", "marks.enter_any"]);
  const canReview = hasAny(ctx, ["results.approve", "results.lock", "results.read"]);
  const view = sp.view === "all" && canReview ? "all" : canEnter && sp.view !== "queue" ? "mine" : canReview ? "queue" : "mine";
  const [terms, current] = await Promise.all([listExamTerms(ctx), getCurrentAcademicContext(ctx.schoolId)]);
  const termId = sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : (current.term?.id ?? terms[0]?.id);
  const all = termId ? await listSubmissions(ctx, { termId, mine: view === "mine" }) : [];
  const rows = view === "queue" ? all.filter((s) => s.status === "SUBMITTED" || s.status === "APPROVED") : sp.status ? all.filter((s) => s.status === sp.status) : all;

  const tab = (v: string, label: string) => (
    <Link key={v} href={`/marks?view=${v}${termId ? `&termId=${termId}` : ""}`} aria-current={view === v ? "page" : undefined} className={segClass(view === v)}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title={t("marks.title")} subtitle={t("marks.subtitle")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {canEnter && tab("mine", t("marks.tab.mine"))}
        {canReview && tab("queue", t("marks.tab.queue"))}
        {canReview && tab("all", t("marks.tab.all"))}
      </div>
      <FilterBar t={t} resetHref={`/marks?view=${view}`}>
        <input type="hidden" name="view" value={view} />
        <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={termId ?? ""} placeholder={t("exam.chooseTerm")} />
        {view !== "queue" && <Field name="status" type="select" label={t("marks.status")} options={(["DRAFT", "SUBMITTED", "APPROVED", "LOCKED", "RETURNED"] as const).map((s) => ({ value: s, label: t(`marks.status.${s}`) }))} defaultValue={sp.status ?? ""} placeholder={t("common.all")} />}
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState>{view === "queue" ? t("marks.queueEmpty") : view === "mine" ? t("marks.mineEmpty") : t("marks.empty")}</EmptyState>
      ) : (
        <DataTable head={[t("exam.name"), t("exam.class"), t("exam.subject"), t("marks.status"), t("marks.progress"), t("exam.deadline"), ""]}>
          {rows.map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/exams/${s.examId}`} className="hover:underline">{s.examName}</Link></Td>
              <Td>{s.className}{s.streamName ? ` · ${s.streamName}` : ""}</Td>
              <Td className="font-medium">{s.subjectName}</Td>
              <Td>
                <Badge tone={SUBMISSION_TONE[s.status as keyof typeof SUBMISSION_TONE]}>{t(`marks.status.${s.status}` as never)}</Badge>{" "}
                {s.overdue && <Badge tone="bad">{t("marks.overdue")}</Badge>}
              </Td>
              <Td className="tabular-nums">{s.entered}/{s.roster}</Td>
              <Td>{displayDate(s.deadline, ctx.locale)}</Td>
              <Td className="text-right"><Link href={`/marks/${s.id}`} className="text-sm font-semibold text-link hover:underline">{s.canEnter && (s.status === "DRAFT" || s.status === "RETURNED") ? t("marks.enter") : view === "queue" ? t("marks.review") : t("common.view")}</Link></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
