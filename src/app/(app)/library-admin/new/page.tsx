import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { getLibrarySettings } from "@/server/library-settings";
import { libraryFormOptions } from "@/server/library";
import { ActionForm } from "@/components/form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";
import { ResourceFields } from "@/components/library/resource-form";
import { createResourceAction } from "../actions";

export const metadata: Metadata = { title: "New library resource" };

export default async function NewResourcePage() {
  const [ctx, t] = await Promise.all([requireContext(), getT()]);
  if (!ctx.permissions.has("library.upload")) return <NoAccess t={t} />;
  const [o, settings] = await Promise.all([libraryFormOptions(ctx), getLibrarySettings(db, ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("lib.admin.new")} subtitle={t("lib.admin.new.sub")} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin" />
      <Card><ActionForm action={createResourceAction} submitLabel={t("lib.admin.create")}>
        <ResourceFields t={t} o={o} canFeature={ctx.permissions.has("library.publish") || ctx.permissions.has("library.manage")} allowIdOnly={settings.allowIdOnly} withFile />
      </ActionForm></Card>
    </>
  );
}
