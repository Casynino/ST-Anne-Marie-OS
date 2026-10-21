import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { getLibrarySettings } from "@/server/library-settings";
import { ActionForm, Field } from "@/components/form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";
import { updateLibrarySettingsAction } from "../actions";

export const metadata: Metadata = { title: "Library settings" };

export default async function LibrarySettingsPage() {
  const [ctx, t] = await Promise.all([requireContext(), getT()]);
  if (!ctx.permissions.has("library.manage")) return <NoAccess t={t} />;
  const s = await getLibrarySettings(db, ctx.schoolId);
  return (
    <>
      <PageHeader title={t("lib.nav.settings")} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin/settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("lib.set.rules")}>
          <ActionForm action={updateLibrarySettingsAction} submitLabel={t("common.save")} className="space-y-3">
            <Field name="requireApproval" type="checkbox" label={t("lib.set.approval")} defaultValue={s.requireApproval} />
            <p className="text-sm text-muted">{t("lib.set.approval.hint")}</p>
            <Field name="sessionHours" type="number" min={1} max={168} label={t("lib.set.session")} defaultValue={s.sessionHours} hint={t("lib.set.session.hint")} required />
            <Field name="allowIdOnly" type="checkbox" label={t("lib.set.idOnly")} defaultValue={s.allowIdOnly} />
            <p className="text-sm text-muted">{t("lib.set.idOnly.hint")}</p>
          </ActionForm>
        </Card>
        <Card title={t("lib.set.ids")}>
          <p className="text-sm text-muted">{t("lib.set.ids.body")}</p>
          <p className="mt-3"><Link href="/settings" className="font-semibold text-link underline underline-offset-4">{t("lib.set.ids.link")}</Link></p>
        </Card>
      </div>
    </>
  );
}
