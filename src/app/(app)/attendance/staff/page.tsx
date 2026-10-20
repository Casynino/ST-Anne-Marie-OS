import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { parseDateOnly, todayInTimezone } from "@/lib/dates";
import { listStaffAttendance } from "@/server/attendance";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field, inputClass } from "@/components/form";
import { FilterBar, NoAccess, PageHeader } from "@/components/ui";
import { AttendanceNav } from "@/components/attendance/subnav";
import { saveStaffAttendanceAction } from "../actions";

export const metadata: Metadata = { title: "Staff attendance" };
const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

export default async function StaffAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("attendance.staff.read")) return <NoAccess t={t} />;
  const school = await getSchoolBasics(ctx.schoolId);
  const sp = await searchParams;
  const today = todayInTimezone(school.timezone);
  const date = sp.date && parseDateOnly(sp.date) ? sp.date : today;
  const rows = await listStaffAttendance(ctx, date);
  const canRecord = ctx.permissions.has("attendance.staff.record") && date <= today;

  return (
    <>
      <PageHeader title={t("staffatt.title")} subtitle={t("staffatt.intro")} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance/staff" />
      <FilterBar t={t} resetHref="/attendance/staff">
        <Field name="date" type="date" label={t("att.date")} defaultValue={date} />
      </FilterBar>
      <ActionForm action={saveStaffAttendanceAction} submitLabel={t("staffatt.save")} hideSubmit={!canRecord}>
        <input type="hidden" name="date" value={date} />
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.staffId} className="rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.name}</span>
                {r.jobTitle && <span className="text-xs text-muted">{r.jobTitle}</span>}
              </div>
              <select name={`s_${r.staffId}`} defaultValue={r.status ?? ""} disabled={!canRecord} aria-label={r.name} className={`${inputClass} mt-2`}>
                <option value="">{t("staffatt.notRecorded")}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`att.status.${s}`)}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </ActionForm>
    </>
  );
}
