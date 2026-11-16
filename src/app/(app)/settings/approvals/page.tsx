import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { getApprovalLimits } from "@/server/approval-limits";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { updateApprovalLimitsAction } from "../actions";

export const metadata: Metadata = { title: "Approval limits" };

/** What only the owner decides: expenses and refunds at or above these amounts. Changing it is an owner-level setting (`school.settings.update`). */
export default async function ApprovalLimitsPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["school.settings.update"])) return <NoAccess t={t} />;
  const limits = await getApprovalLimits(db, ctx.schoolId);
  return (
    <>
      <Link href="/settings" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("settings.title")}</Link>
      <PageHeader title={t("exec.limits.nav")} subtitle={t("exec.limits.page.sub")} />
      <div className="max-w-xl">
        <Card>
          <ActionForm action={updateApprovalLimitsAction} submitLabel={t("common.save")}>
            <Field name="expenseOwnerAbove" label={t("exec.limits.expense")} defaultValue={limits.expenseOwnerAboveCents / 100} hint={t("exec.limits.expense.hint")} />
            <Field name="refundOwnerAbove" label={t("exec.limits.refund")} defaultValue={limits.refundOwnerAboveCents / 100} hint={t("exec.limits.refund.hint")} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
