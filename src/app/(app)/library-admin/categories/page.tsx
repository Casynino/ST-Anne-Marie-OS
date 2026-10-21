import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { listCategories } from "@/server/library";
import { ActionForm, Field } from "@/components/form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";
import { createCategoryAction, updateCategoryAction } from "../actions";

export const metadata: Metadata = { title: "Library categories" };

export default async function CategoriesPage() {
  const [ctx, t] = await Promise.all([requireContext(), getT()]);
  if (!ctx.permissions.has("library.manage")) return <NoAccess t={t} />;
  const cats = await listCategories(ctx.schoolId);
  return (
    <>
      <PageHeader title={t("lib.nav.categories")} subtitle={t("lib.cat.sub")} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin/categories" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("lib.cat.add")}>
          <ActionForm action={createCategoryAction} submitLabel={t("common.create")} className="space-y-3">
            <Field name="name" label={t("lib.cat.name")} required />
            <Field name="nameSw" label={t("lib.cat.nameSw")} optionalLabel={t("common.optional")} />
            <Field name="sortOrder" label={t("lib.cat.order")} type="number" min={0} max={999} defaultValue={cats.length} />
          </ActionForm>
        </Card>
        {cats.map((c) => (
          <Card key={c.id} title={c.name}>
            <ActionForm action={updateCategoryAction} submitLabel={t("common.save")} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <Field name="name" label={t("lib.cat.name")} defaultValue={c.name} required />
              <Field name="nameSw" label={t("lib.cat.nameSw")} defaultValue={c.nameSw} optionalLabel={t("common.optional")} />
              <Field name="sortOrder" label={t("lib.cat.order")} type="number" min={0} max={999} defaultValue={c.sortOrder} />
              <Field name="isActive" type="checkbox" label={t("lib.cat.active")} defaultValue={c.isActive} />
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
