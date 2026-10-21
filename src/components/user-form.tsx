import type { Translate } from "@/lib/i18n";
import { Field } from "@/components/form";
import { DEPARTMENTS } from "@/lib/rbac/departments";
import { formatDateOnly } from "@/lib/dates";

type Defaults = { fullName?: string; email?: string | null; phone?: string | null; department?: string; jobTitle?: string | null; staffNo?: string | null; employedOn?: Date | null; locale?: string };

/**
 * One short form for a staff account: who they are, which department they work in, and (on a new account) the password to start with.
 * The department decides what they can open; finer control stays on the Roles page for the rare case that needs it.
 */
export function UserFields({ t, d = {}, withPassword }: { t: Translate; d?: Defaults; withPassword?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="fullName" label={t("users.fullName")} defaultValue={d.fullName} required className="sm:col-span-2" />
      <Field name="email" label={t("common.email")} type="email" defaultValue={d.email} optionalLabel={t("common.optional")} />
      <Field name="phone" label={t("common.phone")} type="tel" defaultValue={d.phone} optionalLabel={t("common.optional")} />
      <p className="text-sm text-muted sm:col-span-2">{t("users.contact.hint")}</p>
      <Field
        name="department"
        label={t("users.department")}
        type="select"
        required={withPassword}
        defaultValue={d.department ?? ""}
        options={[{ value: "", label: withPassword ? t("users.department.choose") : t("users.department.keep") }, ...DEPARTMENTS.map((x) => ({ value: x.key, label: t(x.label) }))]}
        hint={t("users.department.hint")}
        className="sm:col-span-2"
      />
      {!withPassword && (
        <>
          <Field name="jobTitle" label={t("users.jobTitle")} defaultValue={d.jobTitle} optionalLabel={t("common.optional")} />
          <Field name="staffNo" label={t("users.staffNo")} defaultValue={d.staffNo} optionalLabel={t("common.optional")} />
          <Field name="employedOn" label={t("users.employedOn")} type="date" defaultValue={d.employedOn ? formatDateOnly(d.employedOn) : undefined} optionalLabel={t("common.optional")} />
          <Field name="locale" label={t("users.language")} type="select" defaultValue={d.locale ?? "EN"} options={[{ value: "EN", label: "English" }, { value: "SW", label: "Kiswahili" }]} />
        </>
      )}
      {withPassword && <Field name="password" label={t("users.password")} autoComplete="off" required hint={t("users.password.hint")} className="sm:col-span-2" />}
    </div>
  );
}
