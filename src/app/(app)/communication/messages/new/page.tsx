import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { CommunicationNav } from "@/components/communication-nav";
import { startStaffThreadAction } from "../../actions";
import { searchStudentsForMessaging, studentForMessaging } from "@/server/messaging";

export const metadata: Metadata = { title: "New conversation" };

export default async function NewStaffThreadPage({ searchParams }: { searchParams: Promise<{ q?: string; studentId?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (ctx.userType !== "STAFF" || !hasAny(ctx, ["messages.send"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const student = sp.studentId && /^[0-9a-f-]{36}$/i.test(sp.studentId) ? await studentForMessaging(ctx, sp.studentId) : null;
  // Teachers only find students of classes they teach.
  const matches = !student ? await searchStudentsForMessaging(ctx, sp.q ?? "") : [];
  return (
    <>
      <PageHeader title={t("msg.new")} subtitle={t("msg.staff.newHint")} actions={<Link href="/communication/messages" className="text-sm font-medium text-link hover:underline">{t("msg.title")}</Link>} />
      <CommunicationNav ctx={ctx} t={t} current="/communication/messages" />
      {!student ? (
        <div className="max-w-xl space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
            <Field name="q" label={t("fin.payments.findStudent")} defaultValue={sp.q} placeholder={t("fin.payments.findHint")} className="min-w-56 flex-1" required />
            <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("common.search")}</button>
          </form>
          {sp.q && matches.length === 0 && <EmptyState>{t("common.noResults")}</EmptyState>}
          <ul className="space-y-2">{matches.map((s) => <li key={s.id}><Link href={`/communication/messages/new?studentId=${s.id}`} className="flex min-h-14 items-center justify-between rounded-xl border border-line bg-surface px-4 hover:border-brand-400"><span className="font-medium">{[s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ")}</span><span className="text-sm text-muted">{s.admissionNo}</span></Link></li>)}</ul>
        </div>
      ) : (
        <Card title={[student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")} className="max-w-2xl">
          <ActionForm action={startStaffThreadAction} submitLabel={t("msg.send")}>
            <input type="hidden" name="studentId" value={student.id} />
            <Field name="guardianId" type="select" label={t("msg.toParent")} options={student.guardians.filter((g) => g.guardian.userId && g.guardian.user?.status === "ACTIVE").map((g) => ({ value: g.guardian.id, label: g.guardian.fullName }))} required placeholder={t("common.select")} hint={t("msg.portalOnly")} />
            <Field name="subject" label={t("msg.subject")} required />
            <Field name="body" type="textarea" rows={4} label={t("msg.message")} required />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
