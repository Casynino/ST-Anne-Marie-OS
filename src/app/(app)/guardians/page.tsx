import Link from "next/link";
import type { Metadata } from "next";
import { Link2Off, LogIn, Search, UserCheck, UserX, Users } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { guardianOverview, listGuardians } from "@/server/guardians";
import { guardianAccountStates } from "@/server/portal";
import { ActionForm } from "@/components/form";
import { Cell, GradientTile, PersonCell, Panel, Pill } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";
import { EmptyState, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { createGuardianAccountAction, resetPortalPasswordAction, setPortalActiveAction } from "./actions";

export const metadata: Metadata = { title: "Guardians" };
const SHOWN = 3;

/**
 * Parents and guardians: one table (who they are, how to reach them, their children, and, for people who manage portal accounts, the account
 * with its few actions) beside the numbers: how many have an account, how many are suspended, how many have never signed in.
 */
export default async function GuardiansPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("guardian.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total, pageSize }, ov] = await Promise.all([listGuardians(ctx, { q: sp.q, page }), guardianOverview(ctx)]);
  const canOpenStudents = ctx.permissions.has("student.read");
  const canPortal = ctx.permissions.has("portal.manage");
  const accounts = canPortal ? await guardianAccountStates(ctx, items.map((g) => g.id)) : new Map();
  const th = "px-4 py-2.5 text-left text-[13px] font-medium text-muted";

  return (
    <>
      <PageHeader
        title={t("guardian.title")}
        subtitle={t("guardian.ov.total") + ": " + ov.total}
        actions={
          <form method="get" className="flex items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input name="q" defaultValue={sp.q ?? ""} placeholder={t("guardian.search")} aria-label={t("common.search")} className="min-h-10 w-72 max-w-full pl-9 pr-3 text-sm" />
            </label>
            <button className="btn-secondary min-h-10 px-4 text-sm">{t("common.search")}</button>
            {sp.q && <Link href="/guardians" className="text-sm text-muted hover:text-ink hover:underline">{t("common.clear")}</Link>}
          </form>
        }
      />
      <ul className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,13.5rem))]">
        <li><GradientTile icon={Users} tone="orange" label={t("guardian.ov.total")} value={ov.total} caption={t("guardian.ov.linked", { n: ov.total - ov.noChild })} /></li>
        {canPortal && <li><GradientTile icon={UserCheck} tone="green" label={t("guardian.ov.withAccount")} value={ov.active} caption={ov.suspended > 0 ? t("guardian.ov.suspendedN", { n: ov.suspended }) : t("guardian.ov.noneSuspended")} /></li>}
        {canPortal && <li><GradientTile icon={UserX} tone={ov.noAccount > 0 ? "rose" : "teal"} label={t("guardian.ov.noAccount")} value={ov.noAccount} caption={t("guardian.ov.noAccountHint")} /></li>}
        {canPortal && <li><GradientTile icon={LogIn} tone="violet" label={t("guardian.ov.never")} value={ov.neverSignedIn} caption={t("guardian.ov.neverHint")} /></li>}
        <li><GradientTile icon={Link2Off} tone={ov.noChild > 0 ? "indigo" : "teal"} label={t("guardian.ov.noChild")} value={ov.noChild} caption={t("guardian.ov.noChildHint")} /></li>
      </ul>
      <Row>
        <Panel className="flex-[1_1_100%]" title={t("guardian.title")} subtitle={sp.q ? `${total}` : undefined}>
          {items.length === 0 ? <EmptyState>{t("common.noResults")}</EmptyState> : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[50rem] text-sm">
                <thead><tr className="border-y border-line">
                  <th className={th}>{t("common.name")}</th><th className={th}>{t("common.phone")}</th><th className={th}>{t("guardian.children")}</th>{canPortal && <th className={th}>{t("portal.admin.account")}</th>}
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {items.map((g) => {
                    const acc = accounts.get(g.id);
                    return (
                      <tr key={g.id} className="align-top hover:bg-canvas/50">
                        <Cell className="py-3"><PersonCell name={g.fullName} sub={g.email ?? undefined} /></Cell>
                        <Cell className="whitespace-nowrap py-3 tabular-nums">{g.phone}{g.altPhone && <span className="block text-xs text-muted">{g.altPhone}</span>}</Cell>
                        <Cell className="py-3">
                          {g.students.length === 0 ? <span className="text-muted">—</span> : (
                            <ul className="space-y-0.5">
                              {g.students.slice(0, SHOWN).map((l) => (
                                <li key={l.studentId} className="whitespace-nowrap">{canOpenStudents ? <Link className="text-ink hover:text-link hover:underline" href={`/students/${l.studentId}`}>{l.student.firstName} {l.student.lastName}</Link> : `${l.student.firstName} ${l.student.lastName}`} <span className="text-xs tabular-nums text-muted">· {l.student.admissionNo}</span></li>
                              ))}
                              {g.students.length > SHOWN && <li className="text-xs text-muted">{t("guardian.more", { n: g.students.length - SHOWN })}</li>}
                            </ul>
                          )}
                        </Cell>
                        {canPortal && (
                          <Cell className="py-3">
                            {!acc ? (
                              g.students.length === 0 ? <span className="text-xs text-muted">{t("portal.admin.needsChild")}</span> : (
                                <ActionForm action={createGuardianAccountAction} submitLabel={t("portal.admin.create")} inline buttonClassName="btn-sm">
                                  <input type="hidden" name="guardianId" value={g.id} />
                                </ActionForm>
                              )
                            ) : (
                              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                                <Pill tone={acc.status === "ACTIVE" ? "ok" : "bad"}>{acc.status === "ACTIVE" ? t("common.active") : t("portal.admin.suspended")}</Pill>
                                <ActionForm action={resetPortalPasswordAction} submitLabel={t("portal.admin.resetPassword")} inline confirm={t("portal.admin.resetConfirm")} buttonClassName="btn-sm"><input type="hidden" name="userId" value={acc.id} /></ActionForm>
                                <ActionForm action={setPortalActiveAction} submitLabel={acc.status === "ACTIVE" ? t("portal.admin.suspend") : t("portal.admin.reactivate")} inline tone={acc.status === "ACTIVE" ? "danger" : "neutral"} buttonClassName="btn-sm"><input type="hidden" name="userId" value={acc.id} /><input type="hidden" name="active" value={acc.status === "ACTIVE" ? "false" : "true"} /></ActionForm>
                              </div>
                            )}
                          </Cell>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/guardians" params={{ q: sp.q }} t={t} />
        </Panel>

      </Row>
    </>
  );
}
