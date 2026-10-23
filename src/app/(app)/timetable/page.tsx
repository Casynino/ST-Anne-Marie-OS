import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { classTimetable, teacherTimetable, timetableOptions, type Lesson } from "@/server/timetable";
import { listPeriods } from "@/server/timetable";
import { Card, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, segClass } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { PrintButton } from "@/components/print-button";
import { Panel } from "@/components/dash/parts";
import { db } from "@/lib/db";
import { TimetableGrid } from "@/components/learning/timetable-grid";
import { dayLabels } from "@/lib/learning/labels";
import { clearLessonAction, setLessonAction } from "./actions";

export const metadata: Metadata = { title: "Timetable" };

type SP = { view?: string; classId?: string; streamId?: string; teacherId?: string; day?: string; period?: string };

export default async function TimetablePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["timetable.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const canManage = hasAny(ctx, ["timetable.manage"]);
  const opts = await timetableOptions(ctx);
  const view = sp.view === "class" ? "class" : sp.view === "teacher" ? "teacher" : ctx.staffId && !canManage ? "teacher" : "class";
  // The class shown first: the one asked for, else the first class that has lessons (so the page never opens on an empty class).
  const withLessons = sp.classId ? new Set<string>() : new Set((await db.timetableEntry.findMany({ where: { schoolId: ctx.schoolId }, distinct: ["classId"], select: { classId: true } })).map((x) => x.classId));
  const cls = opts.classes.find((c) => c.id === sp.classId) ?? opts.classes.find((c) => withLessons.has(c.id)) ?? opts.classes[0];
  const stream = cls?.streams.find((s) => s.id === sp.streamId);
  // The teacher shown first: the one asked for; else the person themselves if they have lessons; else the first teacher who has any (never an empty week by default).
  const ownHasLessons = view === "teacher" && !sp.teacherId && ctx.staffId ? (await db.timetableEntry.count({ where: { schoolId: ctx.schoolId, teacherStaffId: ctx.staffId }, take: 1 })) > 0 : false;
  const firstWithLessons = view === "teacher" && !sp.teacherId && !ownHasLessons ? (await db.timetableEntry.findFirst({ where: { schoolId: ctx.schoolId, teacherStaffId: { not: null } }, orderBy: { createdAt: "asc" }, select: { teacherStaffId: true } }))?.teacherStaffId ?? null : null;
  const teacherId = view === "teacher" ? (opts.teachers.find((x) => x.id === sp.teacherId)?.id ?? (ownHasLessons ? ctx.staffId : null) ?? firstWithLessons ?? ctx.staffId ?? opts.teachers[0]?.id ?? null) : null;
  const data = view === "class" ? (cls ? await classTimetable(ctx, { classId: cls.id, streamId: stream?.id }) : { periods: await listPeriods(ctx), lessons: [] as Lesson[] }) : await teacherTimetable(ctx, teacherId);
  // Who teaches what: periods a week per subject and teacher in a class, or per class and subject for one teacher.
  const tally = (key: (l: Lesson) => string, label: (l: Lesson) => [string, string]) => {
    const m = new Map<string, { a: string; b: string; n: number }>();
    for (const l of data.lessons) { const k = key(l); const [a, b] = label(l); const e = m.get(k) ?? { a, b, n: 0 }; e.n++; m.set(k, e); }
    return [...m.values()].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  };
  const byClassRows = view === "class" ? tally((l) => `${l.subjectId}|${l.teacherStaffId ?? ""}`, (l) => [l.subjectName, l.teacherName ?? t("learn.tt.noTeacher")]) : [];
  const byTeacherRows = view === "teacher" ? tally((l) => `${l.classId}|${l.streamId ?? ""}|${l.subjectId}`, (l) => [`${l.className}${l.streamName ? ` ${l.streamName}` : ""}`, l.subjectName]) : [];
  const teacherName = opts.teachers.find((x) => x.id === teacherId)?.name;
  const labels = { day: dayLabels(t), break: t("learn.tt.break"), free: t("learn.tt.free"), whole: t("learn.tt.wholeClass"), add: t("learn.tt.addLesson") };

  // The editor opens on the slot that was clicked.
  const day = Number(sp.day) || 0;
  const slotPeriod = data.periods.find((p) => p.id === sp.period);
  const slotLessons = view === "class" && canManage && day && slotPeriod ? data.lessons.filter((l) => l.dayOfWeek === day && l.periodId === sp.period && (stream ? l.streamId === stream.id || l.streamId === null : true)) : [];
  const editing = slotLessons.find((l) => (stream ? l.streamId === stream.id : l.streamId === null)) ?? slotLessons[0];
  const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); return `/timetable?${p}`; };

  return (
    <>
      <PageHeader title={t("learn.tt.title")} subtitle={t("learn.tt.subtitle")} actions={<span className="no-print flex items-center gap-2"><PrintButton label={t("learn.tt.print")} />{canManage ? <LinkButton href="/timetable/periods" variant="secondary">{t("learn.periods.title")}</LinkButton> : null}</span>} />
      <p className="no-print -mt-2 mb-4 text-sm text-muted">{canManage ? t("learn.tt.preparedByYou") : t("learn.tt.preparedBy")}</p>
      <nav aria-label={t("learn.tt.title")} className="no-print mb-4 flex gap-2">
        {([["class", t("learn.tt.byClass")], ["teacher", t("learn.tt.byTeacher")]] as const).map(([v, label]) => (
          <Link key={v} href={qs({ view: v })} aria-current={view === v ? "page" : undefined} className={segClass(view === v)}>{label}</Link>
        ))}
      </nav>
      {view === "class" ? (
        <FilterBar t={t} resetHref="/timetable?view=class">
          <input type="hidden" name="view" value="class" />
          <Field name="classId" type="select" label={t("learn.class")} options={opts.classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={cls?.id ?? ""} />
          <Field name="streamId" type="select" label={t("learn.stream")} placeholder={t("learn.allStreams")} options={(cls?.streams ?? []).map((s) => ({ value: s.id, label: s.name }))} defaultValue={stream?.id ?? ""} />
        </FilterBar>
      ) : (
        <FilterBar t={t} resetHref="/timetable?view=teacher">
          <input type="hidden" name="view" value="teacher" />
          <Field name="teacherId" type="select" label={t("learn.teacher")} options={opts.teachers.map((x) => ({ value: x.id, label: x.name }))} defaultValue={teacherId ?? ""} />
        </FilterBar>
      )}

      {data.periods.length === 0 ? (
        <EmptyState>{canManage ? <>{t("learn.tt.noPeriods")} <Link href="/timetable/periods" className="font-semibold text-link underline">{t("learn.periods.title")}</Link></> : t("learn.tt.noPeriodsReadOnly")}</EmptyState>
      ) : (
        <div className="space-y-6">
          <TimetableGrid periods={data.periods} lessons={data.lessons} labels={labels} detail={view === "class" ? "teacher" : "class"} cellHref={view === "class" && canManage && cls ? (d, p, l) => `${qs({ view: "class", classId: cls.id, streamId: stream?.id ?? l?.streamId ?? undefined, day: String(d), period: p })}#editor` : undefined} />
          {view === "teacher" && data.lessons.length === 0 && <EmptyState>{t("learn.tt.teacherEmpty")}</EmptyState>}
          {data.lessons.length > 0 && (
            <Panel title={view === "class" ? t("learn.tt.who") : t("learn.tt.myClasses", { name: teacherName ?? "" })} subtitle={view === "class" ? `${cls?.name ?? ""}${stream ? ` ${stream.name}` : ""}` : t("learn.tt.totalPeriods", { n: data.lessons.length })}>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead><tr className="border-y border-line text-left text-xs text-muted"><th className="px-5 py-2 font-medium">{view === "class" ? t("learn.subject") : t("learn.class")}</th><th className="px-3 py-2 font-medium">{view === "class" ? t("learn.teacher") : t("learn.subject")}</th><th className="px-5 py-2 text-right font-medium">{t("learn.tt.periodsWeek")}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {(view === "class" ? byClassRows : byTeacherRows).map((r) => (
                      <tr key={`${r.a}|${r.b}`}><td className="px-5 py-2 font-medium text-ink">{r.a}</td><td className="px-3 py-2 text-muted">{r.b}</td><td className="px-5 py-2 text-right tabular-nums text-ink">{r.n}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          {view === "class" && canManage && cls && (
            <Card title={editing ? t("learn.tt.editLesson") : t("learn.tt.newLesson")} className="scroll-mt-24">
              <div id="editor" />
              {!day || !slotPeriod ? <p className="text-sm text-muted">{t("learn.tt.pickSlot")}</p> : (
                <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
                  <ActionForm key={`${editing?.id ?? "new"}-${editing?.subjectId ?? ""}-${editing?.teacherStaffId ?? ""}-${editing?.room ?? ""}`} action={setLessonAction} submitLabel={t("common.save")} className="grid gap-4 sm:grid-cols-2">
                    <input type="hidden" name="classId" value={cls.id} />
                    <input type="hidden" name="dayOfWeek" value={day} />
                    <input type="hidden" name="periodId" value={slotPeriod.id} />
                    <p className="text-sm font-semibold text-heading sm:col-span-2">{labels.day[day]} · {slotPeriod.name} ({slotPeriod.startTime}–{slotPeriod.endTime})</p>
                    <Field name="streamId" type="select" label={t("learn.stream")} placeholder={t("learn.tt.wholeClass")} options={cls.streams.map((s) => ({ value: s.id, label: s.name }))} defaultValue={editing?.streamId ?? stream?.id ?? ""} />
                    <Field name="subjectId" type="select" label={t("learn.subject")} required options={cls.subjects.map((s) => ({ value: s.id, label: s.name }))} defaultValue={editing?.subjectId ?? ""} />
                    <Field name="teacherStaffId" type="select" label={t("learn.teacher")} placeholder={t("learn.tt.noTeacher")} options={opts.teachers.map((x) => ({ value: x.id, label: x.name }))} defaultValue={editing?.teacherStaffId ?? ""} />
                    <Field name="room" label={t("learn.tt.room")} optionalLabel={t("common.optional")} defaultValue={editing?.room ?? ""} />
                  </ActionForm>
                  {editing && (
                    <ActionForm action={clearLessonAction} submitLabel={t("learn.tt.clear")} tone="danger" confirm={t("learn.tt.clearConfirm")} inline>
                      <input type="hidden" name="id" value={editing.id} />
                    </ActionForm>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
