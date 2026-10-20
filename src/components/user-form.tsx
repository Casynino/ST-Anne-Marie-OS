import type { Translate } from "@/lib/i18n";
import { CheckGroup, Field } from "@/components/form";
import { formatDateOnly } from "@/lib/dates";

type Defaults = { fullName?: string; email?: string | null; phone?: string | null; jobTitle?: string | null; staffNo?: string | null; employedOn?: Date | null; locale?: string };

export function UserFields({ t, d = {}, roles, selectedRoleIds = [] }: { t: Translate; d?: Defaults; roles: { id: string; name: string; description: string | null }[]; selectedRoleIds?: string[] }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="fullName" label={t("users.fullName")} defaultValue={d.fullName} required className="sm:col-span-2" />
        <Field name="email" label={t("common.email")} type="email" defaultValue={d.email} optionalLabel={t("common.optional")} />
        <Field name="phone" label={t("common.phone")} type="tel" defaultValue={d.phone} optionalLabel={t("common.optional")} />
        <p className="text-sm text-muted sm:col-span-2">{t("users.contact.hint")}</p>
        <Field name="jobTitle" label={t("users.jobTitle")} defaultValue={d.jobTitle} optionalLabel={t("common.optional")} />
        <Field name="staffNo" label={t("users.staffNo")} defaultValue={d.staffNo} optionalLabel={t("common.optional")} />
        <Field name="employedOn" label={t("users.employedOn")} type="date" defaultValue={d.employedOn ? formatDateOnly(d.employedOn) : undefined} optionalLabel={t("common.optional")} />
        <Field name="locale" label={t("users.language")} type="select" defaultValue={d.locale ?? "EN"} options={[{ value: "EN", label: "English" }, { value: "SW", label: "Kiswahili" }]} />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t("users.roles")}</legend>
        <p className="mb-2 text-sm text-muted">{t("users.roles.hint")}</p>
        <CheckGroup name="roleIds" selected={selectedRoleIds} options={roles.map((r) => ({ value: r.id, label: r.name, hint: r.description ?? undefined }))} />
      </fieldset>
    </div>
  );
}
