import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { classTimetable, teacherTimetable, timetableOptions, type Lesson } from "@/server/timetable";
import { listPeriods } from "@/server/timetable";
import { Card, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
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
  const cls = opts.classes.find((c) => c.id === sp.classId) ?? opts.classes[0];
  const stream = cls?.streams.find((s) => s.id === sp.streamId);
  const teacherId = view === "teacher" ? (opts.teachers.find((x) => x.id === sp.teacherId)?.id ?? ctx.staffId ?? opts.teachers[0]?.id ?? null) : null;
  const data = view === "class" ? (cls ? await classTimetable(ctx, { classId: cls.id, streamId: stream?.id }) : { periods: await listPeriods(ctx), lessons: [] as Lesson[] }) : await teacherTimetable(ctx, teacherId);
  const labels = { day: dayLabels(t), break: t("learn.tt.break"), free: t("learn.tt.free"), whole: t("learn.tt.wholeClass"), add: t("learn.tt.addLesson") };

  // The editor opens on the slot that was clicked.
  const day = Number(sp.day) || 0;
  const slotPeriod = data.periods.find((p) => p.id === sp.period);
  const slotLessons = view === "class" && canManage && day && slotPeriod ? data.lessons.filter((l) => l.dayOfWeek === day && l.periodId === sp.period && (stream ? l.streamId === stream.id || l.streamId === null : true)) : [];
  const editing = slotLessons.find((l) => (stream ? l.streamId === stream.id : l.streamId === null)) ?? slotLessons[0];
  const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); return `/timetable?${p}`; };

  return (
    <>
      <PageHeader title={t("learn.tt.title")} subtitle={t("learn.tt.subtitle")} actions={canManage ? <LinkButton href="/timetable/periods" variant="secondary">{t("learn.periods.title")}</LinkButton> : undefined} />
      <nav aria-label={t("learn.tt.title")} className="mb-4 flex gap-2">
        {([["class", t("learn.tt.byClass")], ["teacher", t("learn.tt.byTeacher")]] as const).map(([v, label]) => (
          <Link key={v} href={qs({ view: v })} aria-current={view === v ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${view === v ? "bg-brand-700 text-white" : "border border-line bg-white text-ink hover:bg-canvas"}`}>{label}</Link>
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
        <EmptyState>{canManage ? <>{t("learn.tt.noPeriods")} <Link href="/timetable/periods" className="font-semibold text-brand-800 underline">{t("learn.periods.title")}</Link></> : t("learn.tt.noPeriodsReadOnly")}</EmptyState>
      ) : (
        <div className="space-y-6">
          <TimetableGrid periods={data.periods} lessons={data.lessons} labels={labels} detail={view === "class" ? "teacher" : "class"} cellHref={view === "class" && canManage && cls ? (d, p, l) => `${qs({ view: "class", classId: cls.id, streamId: stream?.id ?? l?.streamId ?? undefined, day: String(d), period: p })}#editor` : undefined} />
          {view === "teacher" && data.lessons.length === 0 && <EmptyState>{t("learn.tt.teacherEmpty")}</EmptyState>}
          {view === "class" && canManage && cls && (
            <Card title={editing ? t("learn.tt.editLesson") : t("learn.tt.newLesson")} className="scroll-mt-24">
              <div id="editor" />
              {!day || !slotPeriod ? <p className="text-sm text-muted">{t("learn.tt.pickSlot")}</p> : (
                <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
                  <ActionForm key={`${editing?.id ?? "new"}-${editing?.subjectId ?? ""}-${editing?.teacherStaffId ?? ""}-${editing?.room ?? ""}`} action={setLessonAction} submitLabel={t("common.save")} className="grid gap-4 sm:grid-cols-2">
                    <input type="hidden" name="classId" value={cls.id} />
                    <input type="hidden" name="dayOfWeek" value={day} />
                    <input type="hidden" name="periodId" value={slotPeriod.id} />
                    <p className="text-sm font-semibold text-brand-900 sm:col-span-2">{labels.day[day]} · {slotPeriod.name} ({slotPeriod.startTime}–{slotPeriod.endTime})</p>
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
