import type { Translate } from "@/lib/i18n";
import { CheckGroup, Field } from "@/components/form";

type Options = { categories: { id: string; name: string }[]; classes: { id: string; name: string }[]; subjects: { id: string; name: string }[]; years: { id: string; name: string }[]; staff: { id: string; name: string; staffNo: string | null }[] };
export type ResourceDefaults = {
  title?: string; description?: string | null; categoryId?: string; language?: string; author?: string | null; academicYearId?: string | null; audience?: string; idOnly?: boolean; featured?: boolean;
  availableFrom?: Date | null; copyright?: string | null; classIds?: string[]; subjectIds?: string[]; staffIds?: string[];
};

/** All the questions about a resource, for creating and for editing. Class, subject, category and year come from the school's own records. */
export function ResourceFields({ t, o, d = {}, canFeature, allowIdOnly, withFile }: { t: Translate; o: Options; d?: ResourceDefaults; canFeature: boolean; allowIdOnly: boolean; withFile?: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="title" label={t("lib.m.title")} defaultValue={d.title} required className="sm:col-span-2" />
        <Field name="description" label={t("lib.m.description")} type="textarea" rows={4} defaultValue={d.description} optionalLabel={t("common.optional")} className="sm:col-span-2" />
        <Field name="categoryId" label={t("lib.f.category")} type="select" defaultValue={d.categoryId} options={o.categories.map((c) => ({ value: c.id, label: c.name }))} placeholder={t("common.select")} required />
        <Field name="language" label={t("lib.f.language")} type="select" defaultValue={d.language ?? "EN"} options={[{ value: "EN", label: "English" }, { value: "SW", label: "Kiswahili" }, { value: "OTHER", label: t("lib.f.other") }]} />
        <Field name="author" label={t("lib.m.author")} defaultValue={d.author} optionalLabel={t("common.optional")} />
        <Field name="academicYearId" label={t("lib.m.year")} type="select" defaultValue={d.academicYearId ?? ""} options={o.years.map((y) => ({ value: y.id, label: y.name }))} placeholder={t("lib.m.noYear")} optionalLabel={t("common.optional")} />
        <Field name="copyright" label={t("lib.m.copyright")} defaultValue={d.copyright} optionalLabel={t("common.optional")} className="sm:col-span-2" />
      </div>

      <fieldset className="space-y-3 border border-line p-4">
        <legend className="px-1 text-sm font-semibold">{t("lib.m.who")}</legend>
        <Field name="audience" label={t("lib.m.audience")} type="select" defaultValue={d.audience ?? "STUDENTS"} required
          options={(["PUBLIC", "STUDENTS", "CLASSES", "SUBJECTS", "STAFF", "RESTRICTED"] as const).map((a) => ({ value: a, label: t(`lib.aud.${a}` as "lib.aud.PUBLIC") }))} hint={t("lib.m.audience.hint")} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div><p className="mb-1 text-sm font-medium">{t("lib.m.classes")}</p><p className="mb-2 text-sm text-muted">{t("lib.m.classes.hint")}</p>
            <div className="max-h-56 overflow-y-auto border border-line p-2"><CheckGroup name="classIds" selected={d.classIds ?? []} options={o.classes.map((c) => ({ value: c.id, label: c.name }))} /></div></div>
          <div><p className="mb-1 text-sm font-medium">{t("lib.m.subjects")}</p><p className="mb-2 text-sm text-muted">{t("lib.m.subjects.hint")}</p>
            <div className="max-h-56 overflow-y-auto border border-line p-2"><CheckGroup name="subjectIds" selected={d.subjectIds ?? []} options={o.subjects.map((c) => ({ value: c.id, label: c.name }))} /></div></div>
        </div>
        <div><p className="mb-1 text-sm font-medium">{t("lib.m.staff")}</p><p className="mb-2 text-sm text-muted">{t("lib.m.staff.hint")}</p>
          <div className="max-h-48 overflow-y-auto border border-line p-2"><CheckGroup name="staffIds" selected={d.staffIds ?? []} options={o.staff.map((s) => ({ value: s.id, label: s.name, hint: s.staffNo ?? undefined }))} /></div></div>
        <Field name="availableFrom" label={t("lib.m.from")} type="date" defaultValue={d.availableFrom ? d.availableFrom.toISOString().slice(0, 10) : undefined} optionalLabel={t("common.optional")} hint={t("lib.m.from.hint")} />
        {allowIdOnly && <Field name="idOnly" type="checkbox" label={t("lib.m.idOnly")} defaultValue={d.idOnly} />}
        {canFeature && <Field name="featured" type="checkbox" label={t("lib.m.featured")} defaultValue={d.featured} />}
      </fieldset>

      {withFile && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="lib-file" className="mb-1 block text-sm font-medium">{t("lib.m.file")} <span aria-hidden className="text-bad">*</span></label>
            <input id="lib-file" name="file" type="file" required accept=".pdf,.docx,.pptx,.xlsx,image/jpeg,image/png,image/webp" className="block min-h-11 w-full border border-line bg-surface px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link" />
            <p className="mt-1 text-sm text-muted">{t("lib.m.file.hint")}</p>
          </div>
          <div>
            <label htmlFor="lib-cover" className="mb-1 block text-sm font-medium">{t("lib.m.cover")} <span className="font-normal text-muted">({t("common.optional")})</span></label>
            <input id="lib-cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp" className="block min-h-11 w-full border border-line bg-surface px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link" />
            <p className="mt-1 text-sm text-muted">{t("lib.m.cover.hint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
