import type { Metadata } from "next";
import { GraduationCap, UserPlus } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getDashboardSummary } from "@/server/dashboard";
import { displayDate } from "@/lib/dates";
import { Card, LinkButton, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  const s = await getDashboardSummary(ctx);
  const needsSetup = !s.year && ctx.permissions.has("academic.manage");

  return (
    <>
      <PageHeader title={t("dash.welcome", { name: ctx.fullName.split(" ")[0] ?? ctx.fullName })} subtitle={s.year ? `${t("dash.year")}: ${s.year.name}${s.term ? ` · ${s.term.name} (${displayDate(s.term.startsOn, locale)} – ${displayDate(s.term.endsOn, locale)})` : ""}` : undefined} />

      {needsSetup && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-warn">{t("dash.setup.title")}</h2>
          <p className="mb-3 mt-1 text-sm">{t("dash.setup.body")}</p>
          <LinkButton href="/academics">{t("dash.setup.cta")}</LinkButton>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {s.students && <Stat label={t("dash.enrolled")} value={s.students.enrolled} />}
        {s.classes !== null && <Stat label={t("dash.classes")} value={s.classes} />}
        {s.staff !== null && <Stat label={t("dash.staff")} value={s.staff} />}
        {s.newThisYear !== null && <Stat label={t("dash.newThisYear")} value={s.newThisYear} />}
      </div>
      {!ctx.permissions.has("student.read") && ctx.permissions.has("student.read_assigned") && <p className="mt-3 text-sm text-muted">{t("dash.scope")}</p>}

      {(ctx.permissions.has("student.create") || ctx.permissions.has("student.read") || ctx.permissions.has("student.read_assigned")) && (
        <Card title={t("dash.quick")} className="mt-5">
          <div className="flex flex-wrap gap-2">
            {ctx.permissions.has("student.create") && (
              <LinkButton href="/students/new">
                <UserPlus className="size-4" aria-hidden /> {t("dash.registerStudent")}
              </LinkButton>
            )}
            {(ctx.permissions.has("student.read") || ctx.permissions.has("student.read_assigned")) && (
              <LinkButton href="/students" variant="secondary">
                <GraduationCap className="size-4" aria-hidden /> {t("nav.students")}
              </LinkButton>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
