import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Clock, CheckCircle2, MessagesSquare } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { listEnquiries } from "@/server/enquiries";
import { db } from "@/lib/db";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { RowAction } from "@/components/lifecycle/row-action";
import { CountTabs } from "@/components/lifecycle/parts";
import { GradientTile, Panel, Pill } from "@/components/dash/parts";
import { EmptyState, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { updateEnquiryAction } from "./actions";

export const metadata: Metadata = { title: "Enquiries" };
const TONE = { NEW: "warn", IN_PROGRESS: "brand", RESOLVED: "ok" } as const;
const STATUSES = ["NEW", "IN_PROGRESS", "RESOLVED"] as const;
const DAY = 86_400_000;

/**
 * Messages from the website contact form, as a work list: who wrote, what they asked, how to reach them (call, WhatsApp or email, one press each),
 * and one "Reply" step that records what was done: choose In progress while an answer is still owed, Resolved when finished, and write the note.
 */
export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  if (!ctx.permissions.has("enquiry.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : undefined;
  const [{ items, total, pageSize, counts }, school, oldest] = await Promise.all([
    listEnquiries(ctx, { status, page }), getSchoolBasics(ctx.schoolId),
    db.enquiry.findFirst({ where: { schoolId: ctx.schoolId, status: "NEW" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const handlers = await db.user.findMany({ where: { id: { in: items.map((e) => e.handledById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const who = new Map(handlers.map((u) => [u.id, u.fullName]));
  const canManage = ctx.permissions.has("enquiry.manage");
  const all = (counts.NEW ?? 0) + (counts.IN_PROGRESS ?? 0) + (counts.RESOLVED ?? 0);
  const waitDays = oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / DAY) : null;
  const ago = (d: Date) => { const n = Math.floor((Date.now() - d.getTime()) / DAY); return n <= 0 ? t("enq.ago.today") : n === 1 ? t("enq.ago.one") : t("enq.ago.n", { n }); };
  const tab = (key: string | undefined, label: string, count: number) => ({ href: key ? `/enquiries?status=${key}` : "/enquiries", label, count, active: status === key });
  const th = "px-3 py-2 text-left text-xs font-medium text-muted";
  const td = "px-3 py-3 align-top text-[13px]";
  const digits = (p: string) => p.replace(/\D/g, "");
  const intro = encodeURIComponent(`Re: your message to ${school.name}`);

  return (
    <>
      <PageHeader title={t("enq.title")} subtitle={t("enq.intro")} />

      <ul className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,13.5rem))]">
        <li><GradientTile icon={Inbox} tone={(counts.NEW ?? 0) > 0 ? "rose" : "green"} label={t("enq.status.NEW")} value={counts.NEW ?? 0} caption={t("enq.tile.newHint")} href="/enquiries?status=NEW" /></li>
        <li><GradientTile icon={MessagesSquare} tone="violet" label={t("enq.status.IN_PROGRESS")} value={counts.IN_PROGRESS ?? 0} caption={t("enq.tile.progressHint")} href="/enquiries?status=IN_PROGRESS" /></li>
        <li><GradientTile icon={CheckCircle2} tone="green" label={t("enq.status.RESOLVED")} value={counts.RESOLVED ?? 0} caption={t("enq.tile.resolvedHint")} href="/enquiries?status=RESOLVED" /></li>
        <li><GradientTile icon={Clock} tone={waitDays !== null && waitDays >= 2 ? "orange" : "teal"} label={t("enq.tile.oldest")} value={waitDays === null ? "—" : waitDays <= 0 ? t("enq.ago.today") : t("enq.tile.days", { n: waitDays })} caption={waitDays === null ? t("enq.tile.noneWaiting") : t("enq.tile.oldestHint")} /></li>
      </ul>

      {canManage && (
        <ol className="mb-5 grid gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-sm sm:grid-cols-3" aria-label={t("enq.how.title")}>
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex gap-3">
              <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-brand-600/15 text-xs font-bold text-link">{n}</span>
              <span className="text-ink">{t(`enq.how.${n}` as "enq.how.1")}</span>
            </li>
          ))}
        </ol>
      )}

      <Panel title={t("enq.title")} subtitle={status ? t(`enq.status.${status}`) : undefined}>
        <CountTabs items={[tab(undefined, t("enq.tab.all"), all), tab("NEW", t("enq.status.NEW"), counts.NEW ?? 0), tab("IN_PROGRESS", t("enq.status.IN_PROGRESS"), counts.IN_PROGRESS ?? 0), tab("RESOLVED", t("enq.status.RESOLVED"), counts.RESOLVED ?? 0)]} />
        {items.length === 0 ? <EmptyState>{t("enq.empty")}</EmptyState> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead><tr className="border-y border-line"><th className={th}>{t("enq.col.person")}</th><th className={th}>{t("enq.col.message")}</th><th className={th}>{t("enq.col.contact")}</th><th className={th}>{t("enq.col.status")}</th><th className={`${th} text-right`}><span className="sr-only">{t("lc.col.action")}</span></th></tr></thead>
              <tbody className="divide-y divide-line">
                {items.map((e) => {
                  const contact = (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {e.phone && <a className="font-medium text-link hover:underline" href={`tel:${e.phone}`}>{t("enq.call")}</a>}
                      {e.phone && <a className="font-medium text-link hover:underline" href={`https://wa.me/${digits(e.phone)}`} target="_blank" rel="noopener noreferrer">{t("enq.whatsapp")}</a>}
                      {e.email && <a className="font-medium text-link hover:underline" href={`mailto:${e.email}?subject=${intro}`}>{t("enq.email")}</a>}
                      {!e.phone && !e.email && <span className="text-muted">{t("enq.noContact")}</span>}
                    </span>
                  );
                  return (
                    <tr key={e.id} className="hover:bg-canvas/50">
                      <td className={`${td} whitespace-nowrap`}><span className="font-semibold text-ink">{e.name}</span>{e.topic && <span className="block text-xs text-muted">{e.topic}</span>}<span className="mt-1 block text-xs tabular-nums text-muted">{[e.phone, e.email].filter(Boolean).join(" · ")}</span></td>
                      <td className={`${td} max-w-md`}><p className="line-clamp-3 whitespace-pre-line text-ink">{e.message}</p><span className="mt-1 block text-xs text-muted" title={displayDateTime(e.createdAt, school.timezone, locale)}>{ago(e.createdAt)} · {displayDate(e.createdAt, locale)}</span></td>
                      <td className={td}>{contact}</td>
                      <td className={`${td} whitespace-nowrap`}><Pill tone={e.status === "NEW" ? "warn" : e.status === "RESOLVED" ? "ok" : "brand"}>{t(`enq.status.${e.status}`)}</Pill>{e.handledAt && <span className="mt-1 block text-xs text-muted">{t("enq.handled", { name: e.handledById ? who.get(e.handledById) ?? "—" : "—", date: displayDate(e.handledAt, locale) })}</span>}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        {canManage ? (
                          <RowAction wide primary={e.status === "NEW"} label={e.status === "RESOLVED" ? t("enq.view") : t("enq.reply")} title={t("enq.replyTitle", { name: e.name })} closeLabel={t("common.cancel")}>
                            <div className="space-y-4">
                              <div className="rounded-lg border border-line bg-canvas/50 p-3">
                                <p className="whitespace-pre-line text-sm text-ink">{e.message}</p>
                                <p className="mt-2 text-xs text-muted">{e.name} · {displayDateTime(e.createdAt, school.timezone, locale)}</p>
                              </div>
                              <div><p className="mb-1 text-xs font-medium uppercase tracking-[.08em] text-muted">{t("enq.step1")}</p>{contact}</div>
                              <ActionForm action={updateEnquiryAction} submitLabel={t("common.save")} buttonClassName="btn-sm" className="space-y-3 border-t border-line pt-4">
                                <input type="hidden" name="id" value={e.id} />
                                <p className="text-xs font-medium uppercase tracking-[.08em] text-muted">{t("enq.step2")}</p>
                                <Field name="internalNote" type="textarea" rows={3} label={t("enq.note")} defaultValue={e.internalNote} optionalLabel={t("common.optional")} hint={t("enq.noteHint")} />
                                <Field name="status" label={t("enq.step3")} type="select" defaultValue={e.status === "NEW" ? "IN_PROGRESS" : e.status} options={STATUSES.map((s) => ({ value: s, label: t(`enq.status.${s}`) }))} required hint={t("enq.statusHint")} />
                              </ActionForm>
                            </div>
                          </RowAction>
                        ) : <Link href="/enquiries" className="sr-only">{t("enq.title")}</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/enquiries" params={{ status }} t={t} />
      </Panel>
    </>
  );
}
