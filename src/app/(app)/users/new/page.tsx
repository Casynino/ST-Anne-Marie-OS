import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { ActionForm } from "@/components/form";
import { UserFields } from "@/components/user-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { createUserAction } from "../actions";

export const metadata: Metadata = { title: "Add staff member" };

export default async function NewUserPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("user.create")) return <NoAccess t={t} />;
  return (
    <>
      <PageHeader title={t("users.new")} />
      <Card><ActionForm action={createUserAction} submitLabel={t("common.create")}><UserFields t={t} withPassword /></ActionForm></Card>
    </>
  );
}
