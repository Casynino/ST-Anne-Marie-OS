import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { isOwnerOnly, STEP_IN_MINUTES } from "@/lib/rbac/oversight";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { stepInAction, stepOutAction } from "./actions";

export const metadata: Metadata = { title: "Step in" };

export default async function StepInPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!isOwnerOnly(ctx)) return <NoAccess t={t} />;
  return (
    <>
      <Link href="/dashboard" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("nav.dashboard")}</Link>
      <PageHeader title={t("step.title")} subtitle={t("step.sub", { n: STEP_IN_MINUTES })} />
      <div className="max-w-xl">
        <Card>
          {ctx.stepInUntil ? (
            <form action={stepOutAction} className="space-y-3">
              <p className="text-sm text-muted">{t("step.on")}</p>
              <button type="submit" className="btn-secondary">{t("step.stop")}</button>
            </form>
          ) : (
            <ActionForm action={stepInAction} submitLabel={t("step.cta", { n: STEP_IN_MINUTES })}>
              <Field name="reason" type="textarea" rows={3} label={t("step.reason")} hint={t("step.reason.hint")} required />
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
