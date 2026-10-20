import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { DEFAULT_SESSION_CODE, getAttendanceSettings, listAttendanceSessions } from "@/server/attendance";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { AttendanceNav } from "@/components/attendance/subnav";
import { createSessionAction, toggleSessionAction, updateAttendanceSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Attendance settings" };

export default async function AttendanceSettingsPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("attendance.configure")) return <NoAccess t={t} />;
  const [settings, sessions] = await Promise.all([getAttendanceSettings(db, ctx.schoolId), listAttendanceSessions(ctx)]);

  return (
    <>
      <PageHeader title={t("attset.title")} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance/settings" />
      <div className="space-y-5">
        <Card>
          <ActionForm action={updateAttendanceSettingsAction} submitLabel={t("common.save")}>
            <Field name="mode" type="select" required label={t("attset.mode")} hint={t("attset.mode.hint")} defaultValue={settings.mode} options={[{ value: "DAILY", label: t("attset.mode.DAILY") }, { value: "PER_SESSION", label: t("attset.mode.PER_SESSION") }]} />
            <Field name="lowThresholdPct" type="number" min={1} max={100} required label={t("attset.threshold")} hint={t("attset.threshold.hint")} defaultValue={settings.lowThresholdPct} />
            <Field name="lateCountsAsPresent" type="checkbox" label={t("attset.late")} defaultValue={settings.lateCountsAsPresent} />
            <Field name="excusedCountsAsPresent" type="checkbox" label={t("attset.excused")} defaultValue={settings.excusedCountsAsPresent} />
          </ActionForm>
        </Card>
        <Card title={t("attset.sessions")}>
          <p className="mb-3 text-sm text-muted">{t("attset.sessions.hint")}</p>
          <ul className="mb-4 divide-y divide-line text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{s.code}</strong> · {ctx.locale === "SW" && s.nameSw ? s.nameSw : s.name} {!s.isActive && <Badge>{t("common.inactive")}</Badge>}
                </span>
                {s.code === DEFAULT_SESSION_CODE ? (
                  <span className="text-muted">{t("attset.session.dayLocked")}</span>
                ) : (
                  <ActionForm action={toggleSessionAction} inline submitLabel={s.isActive ? t("attset.session.deactivate") : t("attset.session.activate")} className="inline">
                    <input type="hidden" name="sessionId" value={s.id} />
                    <input type="hidden" name="active" value={s.isActive ? "false" : "true"} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          <ActionForm action={createSessionAction} submitLabel={t("attset.session.add")} className="grid gap-3 sm:grid-cols-3">
            <Field name="code" label={t("attset.session.code")} required placeholder="AM" />
            <Field name="name" label={t("attset.session.name")} required placeholder="Morning" />
            <Field name="nameSw" label={t("attset.session.nameSw")} optionalLabel={t("common.optional")} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
