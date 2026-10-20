import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { myChildren } from "@/server/portal";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { startMessageAction } from "../../actions";

export const metadata: Metadata = { title: "New message" };

export default async function FamilyNewMessagePage({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const sp = await searchParams;
  const children = ctx.userType === "GUARDIAN" ? await myChildren(ctx) : [];
  return (
    <>
      <PageHeader title={t("fam.messages.new")} subtitle={t("fam.messages.newHint")} />
      {children.length === 0 ? <EmptyState>{t("fam.messages.noChildren")}</EmptyState> : (
        <Card className="max-w-2xl">
          <ActionForm action={startMessageAction} submitLabel={t("msg.send")}>
            <Field name="studentId" type="select" label={t("fam.messages.about")} options={children.map((c) => ({ value: c.id, label: c.name }))} defaultValue={children.some((c) => c.id === sp.studentId) ? sp.studentId : children.length === 1 ? children[0]!.id : ""} required placeholder={t("common.select")} />
            <Field name="subject" label={t("msg.subject")} required />
            <Field name="body" type="textarea" rows={5} label={t("msg.message")} required hint={t("fam.messages.privacy")} />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
