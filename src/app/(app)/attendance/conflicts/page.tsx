import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { countPendingConflicts, listConflicts } from "@/server/attendance";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { AttendanceNav } from "@/components/attendance/subnav";
import { resolveConflictAction } from "../actions";

export const metadata: Metadata = { title: "Attendance conflicts" };

export default async function ConflictsPage({ searchParams }: { searchParams: Promise<{ resolved?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("attendance.correct")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const showResolved = sp.resolved === "1";
  const [items, school, pending] = await Promise.all([listConflicts(ctx, { includeResolved: showResolved }), getSchoolBasics(ctx.schoolId), countPendingConflicts(ctx)]);
  const codeLabel = (code: string) => (code === "ALREADY_FINALISED" ? t("conf.code.ALREADY_FINALISED") : code === "OTHER_USER_DRAFT" ? t("conf.code.OTHER_USER_DRAFT") : code === "STUDENT_MARKED_ELSEWHERE" ? t("conf.code.STUDENT_MARKED_ELSEWHERE") : code);
  const statusLabel = (s: string | null) => (s ? t(`att.status.${s as "PRESENT"}`) : t("att.unmarked"));

  return (
    <>
      <PageHeader title={t("conf.title")} subtitle={t("conf.intro")} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance/conflicts" conflicts={pending} />
      <p className="mb-3 text-sm">
        <Link href={showResolved ? "/attendance/conflicts" : "/attendance/conflicts?resolved=1"} className="text-link hover:underline">
          {showResolved ? t("common.clear") : t("conf.showResolved")}
        </Link>
      </p>
      {items.length === 0 ? (
        <EmptyState>{t("conf.none")}</EmptyState>
      ) : (
        <div className="space-y-4">
          {items.map((c) => (
            <Card key={c.id} title={`${c.className} · ${c.date}`} actions={<Badge tone={c.resolution === "PENDING" ? "warn" : "neutral"}>{c.resolution === "PENDING" ? codeLabel(c.code) : t(`conf.resolved.${c.resolution as "ACCEPTED"}`)}</Badge>}>
              <p className="text-sm text-muted">
                {t("conf.submittedBy", { name: c.submittedBy, when: displayDateTime(c.receivedAt, school.timezone, ctx.locale) })} · {t(`conf.kind.${c.kind}`)} · {codeLabel(c.code)}
              </p>
              {c.differences.length === 0 ? (
                <p className="mt-3 text-sm">{t("conf.sameContent")}</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">{t("common.name")}</th>
                        <th className="py-1 pr-3 font-medium">{t("conf.current")}</th>
                        <th className="py-1 font-medium">{t("conf.submitted")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {c.differences.map((d) => (
                        <tr key={d.student}>
                          <td className="py-2 pr-3">{d.student}</td>
                          <td className="py-2 pr-3">{statusLabel(d.current)}</td>
                          <td className="py-2 font-medium">{statusLabel(d.submitted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {c.resolution === "PENDING" ? (
                <ActionForm action={resolveConflictAction} hideSubmit className="mt-4 space-y-3">
                  <input type="hidden" name="operationId" value={c.id} />
                  <Field name="reason" label={t("conf.reason")} required />
                  <div className="flex flex-wrap gap-2">
                    <ResolveButtons accept={t("conf.accept")} dismiss={t("conf.dismiss")} />
                  </div>
                </ActionForm>
              ) : (
                c.resolutionReason && <p className="mt-3 text-sm text-muted">{c.resolutionReason}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ResolveButtons({ accept, dismiss }: { accept: string; dismiss: string }) {
  return (
    <>
      <button name="action" value="ACCEPT" className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{accept}</button>
      <button name="action" value="DISMISS" className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-canvas">{dismiss}</button>
    </>
  );
}
