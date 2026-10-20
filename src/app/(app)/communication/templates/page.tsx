import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { listTemplates } from "@/server/communication";
import { countStaffAttention } from "@/server/messaging";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { CommunicationNav } from "@/components/communication-nav";
import { saveTemplateAction } from "../actions";

export const metadata: Metadata = { title: "Message wording" };

export default async function TemplatesPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["comms.manage"])) return <NoAccess t={t} />;
  const [templates, attention] = await Promise.all([listTemplates(ctx), countStaffAttention(ctx)]);
  const keys = ["absence", "fees", "results"] as const;
  return (
    <>
      <PageHeader title={t("comm.templates.title")} subtitle={t("comm.templates.subtitle")} />
      <CommunicationNav ctx={ctx} t={t} current="/communication/templates" attention={attention} />
      <div className="grid gap-6 xl:grid-cols-3">
        {keys.map((k) => (
          <Card key={k} title={t(`comm.tpl.${k}` as never)}>
            <p className="mb-3 text-sm text-muted">{t(`comm.tpl.${k}.help` as never)}</p>
            <div className="space-y-5">
              {templates.filter((x) => x.key === k).map((x) => (
                <ActionForm key={x.locale} action={saveTemplateAction} submitLabel={t("common.save")} className="space-y-2">
                  <input type="hidden" name="key" value={x.key} />
                  <input type="hidden" name="locale" value={x.locale} />
                  <Field name="body" type="textarea" rows={4} label={`${x.locale === "EN" ? "English" : "Kiswahili"}${x.custom ? "" : ""}`} defaultValue={x.body} hint={`${t("comm.tpl.vars")}: ${x.vars.map((v) => `{${v}}`).join(" ")}`} />
                  <p className="text-xs text-muted">{x.custom ? <Badge tone="brand">{t("comm.tpl.custom")}</Badge> : t("comm.tpl.builtin")} · {t("comm.tpl.resetHint")}</p>
                </ActionForm>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
