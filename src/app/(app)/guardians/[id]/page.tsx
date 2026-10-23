import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, KeyRound, LogIn, ShieldAlert, Users } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { guardianProfile } from "@/server/guardians";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/form";
import { Avatar, GradientTile, Panel, Pill } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";
import { DefList, NoAccess } from "@/components/ui";
import { createGuardianAccountAction, resetPortalPasswordAction, setPortalActiveAction } from "../actions";

export const metadata: Metadata = { title: "Parent" };

/**
 * One parent: who they are, their children and what each owes, and (for people who manage portal accounts) how they sign in, what they did,
 * and what the school sent them, with the buttons for the call "I forgot my password": reset it (a temporary one is shown once), suspend or
 * create the account. Every figure comes from the same records as the other screens.
 */
export default async function GuardianPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("guardian.read")) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let p: Awaited<ReturnType<typeof guardianProfile>>;
  try { p = await guardianProfile(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true, currency: true } });
  const g = p.guardian, a = p.account;
  const canPortal = ctx.permissions.has("portal.manage");
  const canStudents = ctx.permissions.has("student.read");
  const when = (d: Date | null | undefined) => (d ? displayDateTime(d, school.timezone, ctx.locale) : t("gp.never"));
  const th = "px-3 py-2 text-left text-xs font-medium text-muted";
  const td = "px-3 py-2 align-middle text-[13px]";
  const statusTone = !p.hasAccount ? "neutral" : a?.status === "ACTIVE" ? "ok" : a ? "bad" : "neutral";

  return (
    <>
      <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={g.fullName} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{g.fullName}</h1>
              <p className="mt-0.5 text-sm tabular-nums text-muted">{[g.phone, g.altPhone, g.email].filter(Boolean).join(" · ")}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {canPortal || !p.hasAccount ? <Pill tone={statusTone}>{!p.hasAccount ? t("gp.status.none") : a?.status === "ACTIVE" ? t("gp.status.active") : a ? t("gp.status.suspended") : t("gp.status.account")}</Pill> : null}
                {a && a.loginIds.length > 0 && <span className="text-muted">{t("gp.signsInWith")}: <span className="font-medium text-ink">{a.loginIds.join(" · ")}</span></span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canPortal && a && (
              <>
                <ActionForm action={resetPortalPasswordAction} submitLabel={t("portal.admin.resetPassword")} inline confirm={t("portal.admin.resetConfirm")} buttonClassName="btn-primary btn-sm"><input type="hidden" name="userId" value={a.id} /></ActionForm>
                <ActionForm action={setPortalActiveAction} submitLabel={a.status === "ACTIVE" ? t("portal.admin.suspend") : t("portal.admin.reactivate")} inline tone={a.status === "ACTIVE" ? "danger" : "neutral"} buttonClassName="btn-sm"><input type="hidden" name="userId" value={a.id} /><input type="hidden" name="active" value={a.status === "ACTIVE" ? "false" : "true"} /></ActionForm>
              </>
            )}
            {canPortal && !p.hasAccount && p.children.length > 0 && (
              <ActionForm action={createGuardianAccountAction} submitLabel={t("portal.admin.create")} inline buttonClassName="btn-primary btn-sm"><input type="hidden" name="guardianId" value={g.id} /></ActionForm>
            )}
            <Link href="/guardians" className="px-1.5 text-sm font-medium text-link hover:underline">{t("gp.back")}</Link>
          </div>
        </div>
      </section>

      <ul className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,13.5rem))]">
        <li><GradientTile icon={Users} tone="orange" label={t("gp.tile.children")} value={p.children.length} caption={p.children.map((c) => c.name.split(" ")[0]).join(", ") || "—"} /></li>
        {a && <li><GradientTile icon={LogIn} tone="green" label={t("gp.tile.lastSignIn")} value={a.lastLoginAt ? displayDate(a.lastLoginAt, ctx.locale) : t("gp.never")} caption={a.lastLoginAt ? displayDateTime(a.lastLoginAt, school.timezone, ctx.locale).split(",").slice(-1)[0]?.trim() : t("gp.neverHint")} /></li>}
        {a && <li><GradientTile icon={KeyRound} tone="violet" label={t("gp.tile.signIns")} value={a.signIns30} caption={a.passwordChangedAt ? t("gp.passwordChangedOn", { date: displayDate(a.passwordChangedAt, ctx.locale) }) : t("gp.passwordNever")} /></li>}
        {a && <li><GradientTile icon={ShieldAlert} tone={a.failed30 > 0 ? "rose" : "teal"} label={t("gp.tile.failed")} value={a.failed30} caption={a.lastFailedAt ? t("gp.lastFailed", { when: displayDate(a.lastFailedAt, ctx.locale) }) : t("gp.noFailed")} /></li>}
        {a && <li><GradientTile icon={Bell} tone="indigo" label={t("gp.tile.notices")} value={a.notices.total90} caption={t("gp.noticesSent", { n: a.notices.byStatus.PROCESSED ?? 0 })} /></li>}
      </ul>

      <Row>
        <div className="flex flex-[2_1_34rem] flex-col gap-4">
          <Panel title={t("gp.children")}>
            {p.children.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead><tr className="border-y border-line"><th className={th}>{t("gp.col.child")}</th><th className={th}>{t("gp.col.class")}</th><th className={th}>{t("gp.col.relation")}</th>{p.canFees && <th className={`${th} text-right`}>{t("gp.col.owes")}</th>}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {p.children.map((c) => (
                      <tr key={c.studentId} className="hover:bg-canvas/50">
                        <td className={td}>{canStudents ? <Link href={`/students/${c.studentId}`} className="font-medium text-ink hover:text-link hover:underline">{c.name}</Link> : <span className="font-medium text-ink">{c.name}</span>}<span className="block text-xs tabular-nums text-muted">{c.admissionNo}</span></td>
                        <td className={`${td} whitespace-nowrap`}>{c.className ?? <span className="text-muted">—</span>}{c.status !== "ENROLLED" && <span className="block text-xs text-muted">{t(`student.status.${c.status}` as "student.status.ENROLLED")}</span>}</td>
                        <td className={td}>{t(`student.rel.${c.relationship}` as "student.rel.MOTHER")}<span className="block text-xs text-muted">{[c.primary ? t("lc.d.mainContact") : null, c.notifies ? t("gp.getsMessages") : t("gp.noMessages"), c.verified ? t("gp.verified") : null].filter(Boolean).join(" · ")}</span></td>
                        {p.canFees && <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{c.owedCents === null ? <span className="text-muted">—</span> : c.owedCents > 0 ? <span className="text-warn">{formatMoney(c.owedCents, school.currency)}</span> : <span className="text-muted">{t("gp.owesNothing")}</span>}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {a && (
            <Panel title={t("gp.activity")} subtitle={t("gp.activitySub")}>
              {a.activity.length === 0 ? <p className="text-sm text-muted">{t("gp.activityEmpty")}</p> : (
                <ol className="space-y-2.5 text-sm">
                  {a.activity.map((x) => (
                    <li key={x.id} className="border-l-2 border-line pl-3">
                      <p className="text-ink"><span className="font-medium capitalize">{x.action.replace(/[._]/g, " ")}</span>{x.summary ? <span className="text-muted"> · {x.summary}</span> : null}</p>
                      <p className="text-xs text-muted">{when(x.at)} · {x.byAccount ? t("gp.byParent") : t("gp.byStaff", { name: x.actor ?? "—" })}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </div>

        <div className="flex flex-[1_1_20rem] flex-col gap-4">
          {canPortal && (
            <Panel title={t("gp.help.title")}>
              <p className="text-sm text-ink">{!p.hasAccount ? t("gp.help.noAccount") : a?.status !== "ACTIVE" ? t("gp.help.suspended") : t("gp.help.body")}</p>
              {a && a.failed30 >= 3 && <p className="mt-2 text-sm text-warn">{t("gp.help.failed", { n: a.failed30 })}</p>}
            </Panel>
          )}
          <Panel title={t("gp.contacts")}>
            <DefList items={[
              { label: t("common.phone"), value: g.phone },
              ...(g.altPhone ? [{ label: t("gp.altPhone"), value: g.altPhone }] : []),
              ...(g.email ? [{ label: t("gp.email"), value: g.email }] : []),
              ...(g.occupation ? [{ label: t("gp.occupation"), value: g.occupation }] : []),
              ...(g.address ? [{ label: t("gp.address"), value: g.address }] : []),
            ]} />
          </Panel>
          {a && (
            <Panel title={t("gp.signins")} subtitle={t("gp.signinsSub")}>
              {a.recentAttempts.length === 0 ? <p className="text-sm text-muted">{t("gp.signinsEmpty")}</p> : (
                <ul className="divide-y divide-line text-sm">
                  {a.recentAttempts.map((x, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                      <span className={x.ok ? "text-ok" : "text-warn"}>{x.ok ? t("gp.ok") : t("gp.failedOne")}</span>
                      <span className="text-xs tabular-nums text-muted">{when(x.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
                <div><dt className="text-muted">{t("gp.created")}</dt><dd className="text-ink">{displayDate(a.createdAt, ctx.locale)}</dd></div>
                <div><dt className="text-muted">{t("gp.passwordChanged")}</dt><dd className="text-ink">{a.passwordChangedAt ? displayDate(a.passwordChangedAt, ctx.locale) : t("gp.never")}</dd></div>
              </dl>
            </Panel>
          )}
          {a && (
            <Panel title={t("gp.notices")} subtitle={t("gp.noticesSub")}>
              {a.notices.recent.length === 0 ? <p className="text-sm text-muted">{t("gp.noNotices")}</p> : (
                <ul className="divide-y divide-line text-sm">
                  {a.notices.recent.map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-ink">{t(`gp.nt.${n.type}` as "gp.nt.ABSENCE")}</span>
                      <span className="text-xs text-muted">{t(`gp.ns.${n.status}` as "gp.ns.PENDING")} · {displayDate(n.at, ctx.locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </Row>
    </>
  );
}
