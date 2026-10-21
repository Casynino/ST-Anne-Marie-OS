"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/action";
import { ActionForm, Field } from "@/components/form";
import { teachersFor, type TeacherRecord } from "@/lib/admissions/exams";

type Labels = Record<"subject" | "teacher" | "choose" | "hintClass" | "hintSubject" | "hintAny" | "noTeachers" | "max" | "due" | "instructions" | "optional" | "select", string>;

/**
 * Picks a teacher for a subject of an interview. When the subject is chosen, only the teachers recorded for it in the class the applicant applied
 * for are offered; when the school recorded none for that class, those who teach it in other classes; when it recorded nobody, every teacher who may
 * mark. In "change" mode the subject is fixed and the teacher replaces the one assigned (nothing is assigned twice). The server checks the same rule.
 */
export function AssignTeacher({ action, interviewId, subjects, teachers, initialSubjectId, fixedSubject = false, currentTeacherId, appliedClass, maxMark, extras = false, submitLabel, labels }: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  interviewId: string; subjects: { id: string; name: string }[]; teachers: (TeacherRecord & { name: string })[]; initialSubjectId: string;
  fixedSubject?: boolean; currentTeacherId?: string; appliedClass: string | null; maxMark?: number; extras?: boolean; submitLabel: string; labels: Labels;
}) {
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const subject = subjects.find((s) => s.id === subjectId);
  const pick = teachersFor(subjectId, teachers);
  const shown = teachers.filter((t) => pick.ids.includes(t.id) && t.id !== currentTeacherId);
  const fill = (s: string) => s.replace("{subject}", subject?.name ?? "").replace("{class}", appliedClass ?? "");
  const hint = shown.length === 0 ? labels.noTeachers : fill(pick.tier === "CLASS" ? labels.hintClass : pick.tier === "SUBJECT" ? labels.hintSubject : labels.hintAny);
  return (
    <ActionForm action={action} submitLabel={submitLabel} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="interviewId" value={interviewId} />
      {fixedSubject ? <input type="hidden" name="subjectId" value={subjectId} /> : (
        <div onChange={(e) => { const el = e.target as unknown as HTMLSelectElement; if (el.name === "subjectId") setSubjectId(el.value); }}>
          <Field name="subjectId" type="select" label={labels.subject} options={subjects.map((s) => ({ value: s.id, label: s.name }))} defaultValue={initialSubjectId} placeholder={labels.select} required />
        </div>
      )}
      <Field key={subjectId} name="teacherId" type="select" label={labels.teacher} options={shown.map((t) => ({ value: t.id, label: t.name }))} placeholder={labels.choose} required hint={hint} />
      {extras && (
        <>
          <Field name="maxMark" type="number" label={labels.max} defaultValue={String(maxMark ?? 100)} />
          <Field name="dueOn" type="date" label={labels.due} optionalLabel={labels.optional} />
          <div className="sm:col-span-2"><Field name="instructions" type="textarea" rows={2} label={labels.instructions} optionalLabel={labels.optional} /></div>
        </>
      )}
    </ActionForm>
  );
}
