import Link from "next/link";
import { Plus } from "lucide-react";
import type { Lesson } from "@/server/timetable";

type Period = { id: string; name: string; startTime: string; endTime: string; isBreak: boolean };

/** Soft, readable subject colours picked from the name, so the same subject always looks the same. */
const TONES = ["bg-[#dff3fb] text-[#0b4f66]", "bg-[#dcf4e4] text-[#145232]", "bg-[#fbf3c4] text-[#6b5c00]", "bg-[#fde7e4] text-[#8a2c1f]", "bg-[#e6e4fb] text-[#27258f]", "bg-[#fdebd6] text-[#8a4b0f]"] as const;
export const toneFor = (name: string) => TONES[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length]!;

export type GridLabels = { day: Record<number, string>; break: string; free: string; whole: string; add: string };

/**
 * The week as a table on larger screens and as a day-by-day list on phones. `detail` decides the second line of each lesson
 * (the teacher, or the class for a teacher's own timetable). `cellHref` makes empty and filled cells links to the editor.
 */
export function TimetableGrid({ periods, lessons, labels, detail, cellHref }: { periods: Period[]; lessons: Lesson[]; labels: GridLabels; detail: "teacher" | "class" | "none"; cellHref?: (day: number, periodId: string, lesson?: Lesson) => string }) {
  const days = [1, 2, 3, 4, 5, ...(lessons.some((l) => l.dayOfWeek === 6) ? [6] : []), ...(lessons.some((l) => l.dayOfWeek === 7) ? [7] : [])];
  const at = (d: number, p: string) => lessons.filter((l) => l.dayOfWeek === d && l.periodId === p);
  const second = (l: Lesson) => (detail === "teacher" ? l.teacherName : detail === "class" ? `${l.className}${l.streamName ? ` ${l.streamName}` : ""}` : null);
  const cell = (l: Lesson) => (
    <div className={`rounded-xl px-2.5 py-2 text-left ${toneFor(l.subjectName)}`}>
      <p className="text-sm font-bold leading-tight">{l.subjectName}{l.streamName && detail !== "class" ? <span className="ml-1 text-xs font-semibold opacity-70">· {l.streamName}</span> : null}</p>
      {second(l) && <p className="mt-0.5 text-xs opacity-80">{second(l)}</p>}
      {l.room && <p className="mt-0.5 text-xs font-semibold opacity-70">{l.room}</p>}
    </div>
  );
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white shadow-[var(--shadow-card)] md:block">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="bg-brand-950 text-left text-xs font-bold uppercase tracking-wider text-brand-100">
              <th className="w-28 px-3 py-3">&nbsp;</th>
              {days.map((d) => <th key={d} className="px-2 py-3">{labels.day[d]}</th>)}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className={`border-t border-line align-top ${p.isBreak ? "bg-cream-deep/60" : ""}`}>
                <th scope="row" className="px-3 py-2 text-left"><span className="block font-semibold text-brand-900">{p.name}</span><span className="block text-xs font-normal text-muted">{p.startTime}–{p.endTime}</span></th>
                {p.isBreak ? (
                  <td colSpan={days.length} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-widest text-muted">{labels.break}</td>
                ) : (
                  days.map((d) => {
                    const ls = at(d, p.id);
                    return (
                      <td key={d} className="min-w-[8.5rem] px-1.5 py-1.5">
                        {ls.length ? (
                          <div className="space-y-1.5">{ls.map((l) => (cellHref ? <Link key={l.id} href={cellHref(d, p.id, l)} className="block rounded-xl ring-brand-500 hover:ring-2">{cell(l)}</Link> : <div key={l.id}>{cell(l)}</div>))}</div>
                        ) : cellHref ? (
                          <Link href={cellHref(d, p.id)} aria-label={`${labels.add}: ${labels.day[d]} ${p.name}`} className="flex min-h-14 items-center justify-center rounded-xl border border-dashed border-line text-muted hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"><Plus className="size-4" aria-hidden /></Link>
                        ) : (
                          <span aria-hidden className="block min-h-14 rounded-xl bg-canvas/60" />
                        )}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4 md:hidden">
        {days.map((d) => (
          <section key={d} aria-labelledby={`day-${d}`} className="overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
            <h3 id={`day-${d}`} className="bg-brand-950 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-brand-100">{labels.day[d]}</h3>
            <ul className="divide-y divide-line">
              {periods.map((p) => {
                const ls = at(d, p.id);
                if (p.isBreak) return <li key={p.id} className="bg-cream-deep/60 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted">{labels.break} · {p.startTime}–{p.endTime}</li>;
                return (
                  <li key={p.id} className="flex gap-3 px-3 py-2.5">
                    <div className="w-16 shrink-0 pt-1 text-xs"><span className="block font-semibold text-brand-900">{p.name}</span><span className="text-muted">{p.startTime}</span></div>
                    <div className="min-w-0 flex-1 space-y-1.5">{ls.length ? ls.map((l) => (cellHref ? <Link key={l.id} href={cellHref(d, p.id, l)} className="block">{cell(l)}</Link> : <div key={l.id}>{cell(l)}</div>)) : cellHref ? <Link href={cellHref(d, p.id)} className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-muted"><Plus className="size-4" aria-hidden />{labels.add}</Link> : <p className="py-1 text-sm text-muted">{labels.free}</p>}</div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
