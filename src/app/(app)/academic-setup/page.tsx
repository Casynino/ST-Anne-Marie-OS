import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import * as ac from "@/server/academics";
import { displayDate } from "@/lib/dates";
import { ActionForm, CheckGroup, Field } from "@/components/form";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import * as A from "./actions";

export const metadata: Metadata = { title: "Academics" };

type Search = { tab?: string; year?: string };
const TABS = ["years", "classes", "subjects", "assignments"] as const;

export default async function AcademicsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("academic.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "years";
  const labels = { years: t("academics.years"), classes: t("academics.classes"), subjects: t("academics.subjects"), assignments: t("academics.assignments") };

  return (
    <>
      <PageHeader title={t("academics.title")} />
      <nav aria-label="Academics sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <Link key={k} href={`/academic-setup?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${tab === k ? "border-brand-700 text-link" : "border-transparent text-muted hover:text-ink"}`}>
            {labels[k]}
          </Link>
        ))}
      </nav>
      {tab === "years" && <YearsTab canManage={ctx.permissions.has("academic.manage")} ctx={ctx} />}
      {tab === "classes" && <ClassesTab canManage={ctx.permissions.has("academic.manage")} ctx={ctx} />}
      {tab === "subjects" && <SubjectsTab canManage={ctx.permissions.has("academic.manage")} ctx={ctx} />}
      {tab === "assignments" && <AssignmentsTab canAssign={ctx.permissions.has("academic.assign")} ctx={ctx} yearParam={sp.year} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireContext>>;

async function YearsTab({ canManage, ctx }: { canManage: boolean; ctx: Ctx }) {
  const t = await getT();
  const locale = await getLocale();
  const years = await ac.listAcademicYears(ctx);
  return (
    <div className="space-y-5">
      {canManage && (
        <Card title={t("academics.year.add")}>
          <ActionForm action={A.createYearAction} submitLabel={t("common.add")} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <Field name="name" label={t("academics.year.name")} required />
            <Field name="startsOn" label={t("academics.starts")} type="date" required />
            <Field name="endsOn" label={t("academics.ends")} type="date" required />
          </ActionForm>
        </Card>
      )}
      {!years.length && <EmptyState>{t("academics.noYears")}</EmptyState>}
      {years.map((y) => (
        <Card
          key={y.id}
          title={`${y.name}  ·  ${displayDate(y.startsOn, locale)} – ${displayDate(y.endsOn, locale)}`}
          actions={y.isCurrent ? <Badge tone="ok">{t("academics.current")}</Badge> : canManage ? <ActionForm action={A.setCurrentYearAction} submitLabel={t("academics.setCurrent")} inline className="inline"><input type="hidden" name="id" value={y.id} /></ActionForm> : null}
        >
          <ul className="divide-y divide-line">
            {y.terms.map((term) => (
              <li key={term.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <strong>{term.name}</strong> <span className="text-muted">· {displayDate(term.startsOn, locale)} – {displayDate(term.endsOn, locale)}</span>
                </span>
                {term.isCurrent ? <Badge tone="ok">{t("academics.current")}</Badge> : canManage && y.isCurrent ? <ActionForm action={A.setCurrentTermAction} submitLabel={t("academics.setCurrent")} inline className="inline"><input type="hidden" name="id" value={term.id} /></ActionForm> : null}
              </li>
            ))}
          </ul>
          {(y.registrationOpensOn || y.registrationClosesOn) && <p className="mt-2 text-sm text-muted">{t("lc.year.window", { from: y.registrationOpensOn ? displayDate(y.registrationOpensOn, locale) : "—", to: y.registrationClosesOn ? displayDate(y.registrationClosesOn, locale) : "—" })}</p>}
          {canManage && (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("lc.year.setWindow")}</summary>
              <ActionForm action={A.setRegistrationWindowAction} submitLabel={t("common.save")} className="mt-2 grid gap-3 sm:grid-cols-3 sm:items-end">
                <input type="hidden" name="id" value={y.id} />
                <Field name="registrationOpensOn" type="date" label={t("lc.year.opens")} defaultValue={y.registrationOpensOn ? y.registrationOpensOn.toISOString().slice(0, 10) : ""} optionalLabel={t("common.optional")} />
                <Field name="registrationClosesOn" type="date" label={t("lc.year.closes")} defaultValue={y.registrationClosesOn ? y.registrationClosesOn.toISOString().slice(0, 10) : ""} optionalLabel={t("common.optional")} />
              </ActionForm>
            </details>
          )}
          {canManage && (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("academics.term.add")}</summary>
              <ActionForm action={A.createTermAction} submitLabel={t("common.add")} className="mt-2 grid gap-3 sm:grid-cols-5 sm:items-end">
                <input type="hidden" name="academicYearId" value={y.id} />
                <Field name="name" label={t("academics.term")} placeholder="Term 1" required />
                <Field name="sequence" label={t("academics.term.number")} type="number" min={1} max={12} defaultValue={y.terms.length + 1} required />
                <Field name="startsOn" label={t("academics.starts")} type="date" required />
                <Field name="endsOn" label={t("academics.ends")} type="date" required />
              </ActionForm>
            </details>
          )}
        </Card>
      ))}
    </div>
  );
}

async function ClassesTab({ canManage, ctx }: { canManage: boolean; ctx: Ctx }) {
  const t = await getT();
  const [levels, classes, subjects] = await Promise.all([ac.listLevels(ctx), ac.listClasses(ctx), ac.listSubjects(ctx)]);
  const levelOptions = levels.map((l) => ({ value: l.id, label: l.name }));
  const classSubjects = await Promise.all(classes.map(async (c) => [c.id, await ac.getClassSubjectIds(ctx, c.id)] as const));
  const subjectsByClass = new Map(classSubjects);

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t("academics.level.add")}>
            <ActionForm action={A.createLevelAction} submitLabel={t("common.add")} className="space-y-3">
              <Field name="name" label={t("academics.level")} hint={t("academics.level.hint")} required />
              <Field name="sortOrder" label={t("academics.class.order")} type="number" min={0} defaultValue={levels.length + 1} />
            </ActionForm>
            {levels.length > 0 && (
              <ul className="mt-3 divide-y divide-line text-sm">
                {levels.map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2">
                    <span>{l.name} <span className="text-muted">({l._count.classes})</span></span>
                    {l._count.classes === 0 && <ActionForm action={A.deleteLevelAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("common.confirmAction")} className="inline"><input type="hidden" name="id" value={l.id} /></ActionForm>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("academics.class.add")}>
            {levels.length === 0 ? (
              <p className="text-sm text-muted">{t("academics.noClasses")}</p>
            ) : (
              <div className="space-y-4">
                <ActionForm action={A.createClassAction} submitLabel={t("common.add")} className="space-y-3">
                  <Field name="levelId" label={t("academics.level")} type="select" options={levelOptions} placeholder={t("common.select")} required />
                  <Field name="name" label={t("student.class")} placeholder="Standard I" required />
                  <Field name="nameSw" label={t("academics.class.nameSw")} optionalLabel={t("common.optional")} />
                </ActionForm>
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("academics.class.bulk")}</summary>
                  <ActionForm action={A.bulkClassesAction} submitLabel={t("common.add")} className="mt-2 space-y-3">
                    <Field name="levelId" label={t("academics.level")} type="select" options={levelOptions} placeholder={t("common.select")} required />
                    <Field name="names" label={t("student.class")} type="textarea" rows={5} placeholder={"Standard I\nStandard II\nStandard III"} required />
                  </ActionForm>
                </details>
              </div>
            )}
          </Card>
        </div>
      )}

      {!classes.length && <EmptyState>{t("academics.noClasses")}</EmptyState>}
      {levels.map((level) => {
        const inLevel = classes.filter((c) => c.levelId === level.id);
        if (!inLevel.length) return null;
        return (
          <section key={level.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{level.name}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {inLevel.map((c) => (
                <Card key={c.id} title={c.name} actions={<div className="flex items-center gap-2">{!c.isActive && <Badge>{t("common.inactive")}</Badge>}{canManage && <ActionForm action={A.toggleClassActiveAction} submitLabel={c.isActive ? t("common.inactive") : t("common.active")} inline className="inline"><input type="hidden" name="id" value={c.id} /></ActionForm>}</div>}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">{t("student.stream")}:</span>
                    {c.streams.length === 0 && <span className="text-sm text-muted">—</span>}
                    {c.streams.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-tint px-3 py-1 text-sm text-link">
                        {s.name}
                        {canManage && <ActionForm action={A.deleteStreamAction} submitLabel="×" inline className="inline" confirm={t("common.confirmAction")}><input type="hidden" name="id" value={s.id} /></ActionForm>}
                      </span>
                    ))}
                  </div>
                  {canManage && (
                    <ActionForm action={A.createStreamAction} submitLabel={t("academics.stream.add")} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="classId" value={c.id} />
                      <Field name="name" label={t("student.stream")} placeholder="A" className="w-28" required />
                    </ActionForm>
                  )}
                  {canManage ? (
                    <ActionForm action={A.setClassCapacityAction} submitLabel={t("common.save")} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <Field name="capacity" type="number" label={t("class.capacity")} defaultValue={c.capacity ?? ""} min={1} max={500} hint={t("class.capacity.hint")} className="w-48" />
                      <Field name="nextGrade" type="select" label={t("lc.class.next")} hint={t("lc.class.nextHint")} defaultValue={c.isFinalGrade ? "FINAL" : c.nextClassId ?? ""} className="w-64"
                        options={[{ value: "", label: t("lc.class.nextAuto") }, { value: "FINAL", label: t("lc.class.nextFinal") }, ...classes.filter((o) => o.id !== c.id && o.isActive).map((o) => ({ value: o.id, label: o.name }))]} />
                    </ActionForm>
                  ) : c.capacity ? <p className="mt-3 text-sm text-muted">{t("class.capacity")}: {c.capacity}</p> : null}
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("academics.class.subjects")} ({subjectsByClass.get(c.id)?.length ?? 0})</summary>
                    {subjects.length === 0 ? (
                      <p className="text-sm text-muted">{t("academics.noSubjects")}</p>
                    ) : canManage ? (
                      <ActionForm action={A.setClassSubjectsAction} submitLabel={t("common.save")} className="mt-2 space-y-3">
                        <input type="hidden" name="classId" value={c.id} />
                        <CheckGroup name="subjectIds" selected={subjectsByClass.get(c.id) ?? []} options={subjects.filter((s) => s.isActive || subjectsByClass.get(c.id)?.includes(s.id)).map((s) => ({ value: s.id, label: s.name, hint: s.code }))} />
                      </ActionForm>
                    ) : (
                      <p className="mt-2 text-sm">{subjects.filter((s) => subjectsByClass.get(c.id)?.includes(s.id)).map((s) => s.name).join(", ") || "—"}</p>
                    )}
                  </details>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

async function SubjectsTab({ canManage, ctx }: { canManage: boolean; ctx: Ctx }) {
  const t = await getT();
  const subjects = await ac.listSubjects(ctx);
  return (
    <div className="space-y-5">
      {canManage && (
        <Card title={t("academics.subject.add")}>
          <ActionForm action={A.createSubjectAction} submitLabel={t("common.add")} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <Field name="code" label={t("academics.subject.code")} placeholder="MAT" required />
            <Field name="name" label={t("academics.subject")} placeholder="Mathematics" required />
            <Field name="nameSw" label={t("academics.class.nameSw")} optionalLabel={t("common.optional")} placeholder="Hisabati" />
          </ActionForm>
        </Card>
      )}
      {!subjects.length ? (
        <EmptyState>{t("academics.noSubjects")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <ul className="divide-y divide-line">
            {subjects.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <strong>{s.name}</strong> <span className="text-muted">· {s.code}{s.nameSw ? ` · ${s.nameSw}` : ""} · {t("academics.subject.classes")} {s._count.classSubjects}</span>
                </span>
                <span className="flex items-center gap-2">
                  {!s.isActive && <Badge>{t("common.inactive")}</Badge>}
                  {canManage && <ActionForm action={A.toggleSubjectActiveAction} submitLabel={s.isActive ? t("common.inactive") : t("common.active")} inline className="inline"><input type="hidden" name="id" value={s.id} /></ActionForm>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

async function AssignmentsTab({ canAssign, ctx, yearParam }: { canAssign: boolean; ctx: Ctx; yearParam?: string }) {
  const t = await getT();
  const [years, classes, staff, subjects] = await Promise.all([ac.listAcademicYears(ctx), ac.listClasses(ctx), ac.listAssignableStaff(ctx), ac.listSubjects(ctx)]);
  if (!years.length) return <EmptyState>{t("academics.noYears")}</EmptyState>;
  const year = years.find((y) => y.id === yearParam) ?? years.find((y) => y.isCurrent) ?? years[0]!;
  const { classTeachers, subjectTeachers } = await ac.listAssignments(ctx, year.id);
  const staffOptions = staff.map((s) => ({ value: s.id, label: s.user.fullName }));
  const classOptions = classes.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }));
  const streamOptions = classes.flatMap((c) => c.streams.map((s) => ({ value: s.id, label: `${c.name} – ${s.name}` })));
  const where = (c: { class: { name: string }; stream: { name: string } | null }) => `${c.class.name}${c.stream ? ` – ${c.stream.name}` : ""}`;

  return (
    <div className="space-y-5">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="assignments" />
        <Field name="year" label={t("academics.selectYear")} type="select" options={years.map((y) => ({ value: y.id, label: y.name }))} defaultValue={year.id} />
        <button className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-canvas btn-secondary">{t("common.filter")}</button>
      </form>

      {canAssign && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t("academics.classTeacher")}>
            <ActionForm action={A.setClassTeacherAction} submitLabel={t("academics.assign")} className="space-y-3">
              <input type="hidden" name="academicYearId" value={year.id} />
              <Field name="classId" label={t("student.class")} type="select" options={classOptions} placeholder={t("common.select")} required />
              <Field name="streamId" label={t("student.stream")} type="select" options={streamOptions} placeholder={t("academics.wholeClass")} hint="Streams are listed as Class – Stream." />
              <Field name="staffId" label={t("academics.teacher")} type="select" options={staffOptions} placeholder={t("common.select")} required />
            </ActionForm>
          </Card>
          <Card title={t("academics.subjectTeacher")}>
            <ActionForm action={A.addSubjectTeacherAction} submitLabel={t("academics.assign")} className="space-y-3">
              <input type="hidden" name="academicYearId" value={year.id} />
              <Field name="classId" label={t("student.class")} type="select" options={classOptions} placeholder={t("common.select")} required />
              <Field name="streamId" label={t("student.stream")} type="select" options={streamOptions} placeholder={t("academics.wholeClass")} />
              <Field name="subjectId" label={t("academics.subject")} type="select" options={subjects.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} placeholder={t("common.select")} required />
              <Field name="staffId" label={t("academics.teacher")} type="select" options={staffOptions} placeholder={t("common.select")} required />
            </ActionForm>
          </Card>
        </div>
      )}

      <Card title={`${t("academics.classTeacher")} · ${year.name}`}>
        {!classTeachers.length ? <p className="text-sm text-muted">{t("academics.noAssignments")}</p> : (
          <ul className="divide-y divide-line text-sm">
            {classTeachers.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span><strong>{where(a)}</strong> — {a.staff.user.fullName}</span>
                {canAssign && <ActionForm action={A.removeClassTeacherAction} submitLabel={t("common.remove")} inline tone="danger" confirm={t("common.confirmAction")} className="inline"><input type="hidden" name="id" value={a.id} /></ActionForm>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`${t("academics.subjectTeacher")} · ${year.name}`}>
        {!subjectTeachers.length ? <p className="text-sm text-muted">{t("academics.noAssignments")}</p> : (
          <ul className="divide-y divide-line text-sm">
            {subjectTeachers.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span><strong>{where(a)}</strong> · {a.subject.name} — {a.staff.user.fullName}</span>
                {canAssign && <ActionForm action={A.removeSubjectTeacherAction} submitLabel={t("common.remove")} inline tone="danger" confirm={t("common.confirmAction")} className="inline"><input type="hidden" name="id" value={a.id} /></ActionForm>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

