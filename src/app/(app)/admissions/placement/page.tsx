import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { listClasses } from "@/server/academics";
import { awaitingPlacement, classOccupancy } from "@/server/admission-queues";
import { ActionForm, Field } from "@/components/form";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { placeStudentAction } from "../actions";

export const metadata: Metadata = { title: "Class placement" };

export default async function PlacementPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("student.enroll") && !ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const canPlace = ctx.permissions.has("student.enroll");
  const [list, classes, occupancy] = await Promise.all([awaitingPlacement(ctx), ctx.permissions.has("academic.read") ? listClasses(ctx) : [], classOccupancy(ctx.schoolId)]);
  const options = classes.filter((c) => c.isActive).flatMap((c) => {
    const o = occupancy.get(c.id);
    const note = o?.capacity ? ` (${o.count}/${o.capacity}${o.count >= o.capacity ? ` ${t("adm.place.full")}` : ""})` : "";
    return c.streams.length ? c.streams.map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} – ${s.name}${note}` })) : [{ value: c.id, label: `${c.name}${note}` }];
  });
  return (
    <>
      <PageHeader title={t("adm.place.title")} subtitle={t("adm.place.sub")} actions={<Link href="/students" className="text-sm font-medium text-link hover:underline">{t("nav.students")}</Link>} />
      {list.length === 0 ? <EmptyState>{t("adm.place.none")}</EmptyState> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((s) => (
            <Card key={s.id} title={s.name} actions={<span className="text-sm tabular-nums text-muted">{s.admissionNo}</span>}>
              <p className="mb-3 text-sm text-muted">{displayDate(s.admissionDate, ctx.locale)}{s.preferredClass ? ` · ${t("adm.place.preferred")}: ${s.preferredClass}` : ""} · <Link href={`/students/${s.id}`} className="text-link hover:underline">{t("nav.students")}</Link></p>
              {canPlace && (
                <ActionForm action={placeStudentAction} submitLabel={t("adm.place.action")} className="space-y-3">
                  <input type="hidden" name="studentId" value={s.id} />
                  <Field name="placement" type="select" label={t("adm.place.class")} options={options} defaultValue={s.preferredClassId && options.some((o) => o.value === s.preferredClassId) ? s.preferredClassId : ""} placeholder={t("common.select")} required />
                  {ctx.permissions.has("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
                </ActionForm>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
