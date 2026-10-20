import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { getMyPreferences } from "@/server/communication";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { setPreferenceAction } from "../actions";

export const metadata: Metadata = { title: "Notification settings" };

export default async function FamilySettingsPage() {
  const ctx = await requireContext();
  const t = await getT();
  const prefs = await getMyPreferences(ctx);
  return (
    <>
      <PageHeader title={t("fam.settings.title")} subtitle={t("fam.settings.subtitle")} />
      <div className="grid gap-4 md:grid-cols-2">
        {prefs.map((p) => (
          <Card key={p.category} title={t(`fam.cat.${p.category}` as never)}>
            <ActionForm action={setPreferenceAction} submitLabel={t("common.save")} className="space-y-1">
              <input type="hidden" name="category" value={p.category} />
              <Field name="inAppEnabled" type="checkbox" label={t("comm.f.inApp")} defaultValue={p.inAppEnabled} />
              <Field name="smsEnabled" type="checkbox" label={t("comm.f.sms")} defaultValue={p.smsEnabled} />
            </ActionForm>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{t("fam.settings.note")}</p>
    </>
  );
}
