import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamClasses, listExamTerms } from "@/server/exams";
import { getClassResults } from "@/server/results";
import { Badge, EmptyState, FilterBar, NoAccess, PageHeader } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Results" };
type Search = { termId?: string; classId?: string; streamId?: string; basis?: string };

export default async function ResultsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["results.read", "results.read_assigned"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [terms, classes, current] = await Promise.all([listExamTerms(ctx), listExamClasses(ctx), getCurrentAcademicContext(ctx.schoolId)]);
  const termId = sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : (current.term?.id ?? terms[0]?.id);
  const cls = classes.find((c) => c.id === sp.classId);
  const streamId = cls?.streams.some((s) => s.id === sp.streamId) ? sp.streamId : undefined;
  const basis = sp.basis === "PROVISIONAL" ? "PROVISIONAL" : "OFFICIAL";

  let data: Awaited<ReturnType<typeof getClassResults>> | null = null;
  let problem: string | null = null;
  if (termId && cls) {
    try {
      data = await getClassResults(ctx, { termId, classId: cls.id, streamId, basis });
    } catch (e) {
      if (e instanceof AppError) problem = e.message;
      else throw e;
    }
  }
  const dec = data?.policy.decimals ?? 1;
  const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(dec));

  return (
    <>
      <PageHeader title={t("res.title")} subtitle={t("res.subtitle")} />
      <FilterBar t={t} resetHref="/results">
        <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={termId ?? ""} />
        <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={sp.classId ?? ""} placeholder={t("res.chooseClass")} />
        {cls && cls.streams.length > 0 && <Field name="streamId" type="select" label={t("exam.stream")} options={cls.streams.map((s) => ({ value: s.id, label: s.name }))} defaultValue={streamId ?? ""} placeholder={t("res.allStreams")} />}
        <Field name="basis" type="select" label={t("res.basis")} options={[{ value: "OFFICIAL", label: t("res.basis.OFFICIAL") }, { value: "PROVISIONAL", label: t("res.basis.PROVISIONAL") }]} defaultValue={basis} />
      </FilterBar>

      {!cls ? (
        <EmptyState>{t("res.pick")}</EmptyState>
      ) : problem ? (
        <EmptyState>{problem}</EmptyState>
      ) : !data ? null : (
        <>
          {!data.scale && <div role="alert" className="mb-4 rounded-lg border border-warn/30 bg-amber-50 px-4 py-3 text-sm text-warn">{t("res.noScale")}</div>}
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={data.coverage.complete ? "ok" : "warn"}>{data.coverage.complete ? t("res.complete") : t("res.incomplete")}</Badge>
            <span className="text-muted">{t("res.coverage", { counted: data.coverage.counted, total: data.coverage.total })}</span>
            {data.scale && <span className="text-muted">· {t("exam.scale")}: {data.scale.name}</span>}
            <span className="text-muted">· {t("res.policy", { absent: t(`res.absent.${data.policy.absentAs}` as never), by: t(`res.rank.${data.policy.positionBy}` as never) })}</span>
          </div>
          {!data.coverage.complete && <p className="mb-4 text-sm text-muted">{basis === "OFFICIAL" ? t("res.incompleteOfficial") : t("res.incompleteProvisional")}</p>}
          {data.rows.length === 0 ? (
            <EmptyState>{t("res.noStudents")}</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-3 font-medium">{t("res.pos")}</th>
                    <th scope="col" className="px-3 py-3 font-medium">{t("marks.student")}</th>
                    {data.streams.length > 0 && !streamId && <th scope="col" className="px-3 py-3 font-medium">{t("exam.stream")}</th>}
                    {data.subjects.map((s) => <th key={s.id} scope="col" className="whitespace-nowrap px-3 py-3 text-right font-medium" title={s.name}>{s.code || s.name}</th>)}
                    <th scope="col" className="px-3 py-3 text-right font-medium">{t("res.total")}</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">{t("res.average")}</th>
                    <th scope="col" className="px-3 py-3 font-medium">{t("marks.grade")}</th>
                    {data.scale?.divisionBestN ? <th scope="col" className="px-3 py-3 font-medium">{t("res.division")}</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r) => (
                    <tr key={r.studentId} className={r.student.status !== "ENROLLED" ? "text-muted" : undefined}>
                      <td className="px-3 py-2 tabular-nums font-semibold">{r.position ?? "—"}</td>
                      <td className="px-3 py-2"><p className="font-medium">{r.student.name}</p><p className="text-xs text-muted">{r.student.admissionNo}</p></td>
                      {data.streams.length > 0 && !streamId && <td className="px-3 py-2">{r.streamName ?? "—"}</td>}
                      {data.subjects.map((s) => {
                        const l = r.subjects.find((x) => x.subjectId === s.id);
                        return <td key={s.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l ? <>{fmt(l.percent)} <span className="text-xs text-muted">{l.grade ?? ""}</span></> : "—"}</td>;
                      })}
                      <td className="px-3 py-2 text-right tabular-nums">{r.subjectCount ? fmt(r.total) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.average)}</td>
                      <td className="px-3 py-2 font-semibold">{r.grade ?? "—"}</td>
                      {data.scale?.divisionBestN ? <td className="px-3 py-2">{r.subjectCount ? (r.division ?? "—") : "—"}</td> : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line bg-canvas text-xs text-muted">
                  <tr>
                    <td className="px-3 py-2" colSpan={2 + (data.streams.length > 0 && !streamId ? 1 : 0)}>{t("res.classMean")}</td>
                    {data.subjects.map((s) => <td key={s.id} className="px-3 py-2 text-right tabular-nums">{fmt(data.summaries[s.id]?.mean ?? null)}</td>)}
                    <td colSpan={data.scale?.divisionBestN ? 4 : 3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
