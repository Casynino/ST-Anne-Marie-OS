import type { Translate } from "@/lib/i18n";
import type { ReportSnapshot } from "@/lib/results/report-types";

const f = (n: number | null, d: number) => (n === null ? "—" : n.toFixed(d));

/** On-screen version of the report card (the PDF carries the same content). Rendered from the stored snapshot only. */
export function ReportCardView({ snap, t }: { snap: ReportSnapshot; t: Translate }) {
  const d = snap.policy.decimals;
  const s = snap.summary;
  const showExams = snap.exams.length > 0 && snap.exams.length <= 3;
  const a = snap.attendance;
  const summary: [string, string][] = [
    [t("rc.total"), f(s.total, d)],
    [t("rc.average"), f(s.average, d)],
    [t("rc.grade"), s.grade ?? "—"],
    ...(snap.scale.divisionBestN ? ([[t("rc.division"), s.division ? `${s.division}${s.pointsSum !== null ? ` (${s.pointsSum})` : ""}` : "—"]] as [string, string][]) : []),
    [t("rc.classPosition"), s.position === null ? "—" : `${s.position} ${t("rc.of")} ${s.classSize}`],
    ...(s.streamPosition !== null && s.streamSize ? ([[t("rc.streamPosition"), `${s.streamPosition} ${t("rc.of")} ${s.streamSize}`]] as [string, string][]) : []),
  ];
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
      <header className="border-b-4 border-brand-600 px-5 py-5 text-center">
        <p className="text-lg font-bold uppercase tracking-wide text-brand-700">{snap.school.name}</p>
        {snap.school.motto && <p className="text-sm italic text-muted">{snap.school.motto}</p>}
        <p className="mt-0.5 text-xs text-muted">{[snap.school.address, snap.school.phone, snap.school.email].filter(Boolean).join("  ·  ")}</p>
        <h2 className="mt-3 text-sm font-bold uppercase tracking-widest">{t("rc.title")}</h2>
      </header>
      <dl className="grid gap-x-6 gap-y-2 bg-brand-50/60 px-5 py-4 text-sm sm:grid-cols-2">
        {([
          [t("rc.student"), snap.student.name], [t("rc.class"), `${snap.class.name}${snap.class.stream ? ` ${snap.class.stream}` : ""}`],
          [t("rc.admissionNo"), snap.student.admissionNo], [t("rc.term"), `${snap.term.name}, ${snap.term.year}`],
          [t("rc.dob"), snap.student.dateOfBirth], [t("rc.sex"), snap.student.gender === "MALE" ? t("rc.sex.MALE") : snap.student.gender === "FEMALE" ? t("rc.sex.FEMALE") : "—"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>
      <div className="overflow-x-auto px-2 py-4 sm:px-5">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="bg-brand-700 text-left text-xs uppercase tracking-wide text-white">
              <th scope="col" className="px-3 py-2 font-semibold">{t("rc.subject")}</th>
              {showExams && snap.exams.map((e) => <th key={e.id} scope="col" className="px-3 py-2 text-right font-semibold">{e.name}</th>)}
              <th scope="col" className="px-3 py-2 text-right font-semibold">{t("rc.score")}</th>
              <th scope="col" className="px-3 py-2 text-center font-semibold">{t("rc.grade")}</th>
              <th scope="col" className="px-3 py-2 text-center font-semibold">{t("rc.points")}</th>
              <th scope="col" className="px-3 py-2 text-center font-semibold">{t("rc.position")}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">{t("rc.classAvg")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snap.subjects.map((sub) => (
              <tr key={sub.subjectId}>
                <th scope="row" className="px-3 py-2 text-left font-medium">{sub.name}</th>
                {showExams && snap.exams.map((e) => {
                  const m = sub.exams.find((x) => x.examId === e.id);
                  return <td key={e.id} className="px-3 py-2 text-right tabular-nums text-muted">{!m ? "—" : m.status === "ABSENT" ? t("rc.absentShort") : m.status === "EXEMPT" ? t("rc.exemptShort") : `${m.score}/${m.maxMarks}`}</td>;
                })}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{f(sub.percent, d)}</td>
                <td className="px-3 py-2 text-center font-bold">{sub.grade ?? "—"}</td>
                <td className="px-3 py-2 text-center tabular-nums">{sub.points ?? "—"}</td>
                <td className="px-3 py-2 text-center tabular-nums">{sub.position === null ? "—" : `${sub.position}/${sub.classCount}`}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{f(sub.classMean, d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mx-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-brand-600 bg-line sm:grid-cols-3 lg:grid-cols-6">
        {summary.map(([k, v]) => (
          <div key={k} className="bg-white px-3 py-2 text-center"><dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt><dd className="text-base font-bold tabular-nums">{v}</dd></div>
        ))}
      </dl>
      {snap.scale.divisionBestN && s.division === "INC" && <p className="mx-5 mt-2 text-xs italic text-muted">{t("rc.incNote")}</p>}
      <section className="mx-5 mt-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-brand-700">{t("rc.attendance")}</h3>
        <p className="mt-1 text-sm">
          {a.recorded === 0 ? t("rc.attNone") : `${t("rc.attDays")}: ${a.recorded} · ${t("rc.attPresent")}: ${a.present} · ${t("rc.attAbsent")}: ${a.absent} · ${t("rc.attLate")}: ${a.late} · ${t("rc.attExcused")}: ${a.excused} · ${t("rc.attRate")}: ${a.ratePct === null ? "—" : `${a.ratePct}%`}`}
        </p>
      </section>
      <section className="mx-5 mt-5 grid gap-4 sm:grid-cols-2">
        {([[t("rc.remarkClass"), snap.remarks.class], [t("rc.remarkHead"), snap.remarks.head]] as const).map(([k, v]) => (
          <div key={k}><h3 className="text-xs font-bold uppercase tracking-wide text-brand-700">{k}</h3><p className={`mt-1 whitespace-pre-line rounded-lg border border-line p-3 text-sm ${v ? "" : "italic text-muted"}`}>{v ?? t("rc.noRemark")}</p></div>
        ))}
      </section>
      <footer className="mx-5 mb-5 mt-5 border-t border-line pt-3 text-xs text-muted">
        <p className="font-semibold">{t("rc.key")}: {snap.scale.name}</p>
        <p className="mt-0.5">{snap.scale.bands.map((b) => `${b.grade} ${b.min}–${b.max}${b.points !== null ? ` (${b.points})` : ""}`).join("   ")}</p>
      </footer>
    </article>
  );
}
