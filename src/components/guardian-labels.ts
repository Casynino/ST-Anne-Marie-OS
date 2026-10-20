import { getT } from "@/lib/auth/next";
import { RELATIONSHIPS } from "@/server/guardians";
import type { GuardianLabels } from "@/components/guardian-fields";

export async function guardianLabels(canSearch = true): Promise<GuardianLabels & { canSearch: boolean }> {
  const t = await getT();
  return {
    canSearch,
    search: t("student.guardian.search"), useExisting: t("student.guardian.useExisting"), clear: t("student.guardian.clear"), existing: t("student.guardian.existing"),
    sharedPhone: t("student.guardian.sharedPhone"), siblingHint: t("student.guardian.siblingHint"), fullName: t("users.fullName"), phone: t("common.phone"), altPhone: t("guardian.altPhone"),
    email: t("common.email"), occupation: t("guardian.occupation"), relationship: t("student.relationship"), financial: t("student.financial"), notify: t("student.notify"),
    optional: t("common.optional"), select: t("common.select"),
    relationships: RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") })),
  };
}
