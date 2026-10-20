import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, getT } from "@/lib/auth/next";
import { ActionForm, Field } from "@/components/form";
import { changePasswordAction } from "./actions";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{t("auth.changePassword.title")}</h1>
        <p className="mb-4 mt-1 text-sm text-muted">{ctx.mustChangePassword ? t("auth.changePassword.intro") : t("auth.passwordRules")}</p>
        <ActionForm action={changePasswordAction} submitLabel={t("auth.changePassword.button")}>
          <Field name="currentPassword" label={t("auth.currentPassword")} type="password" autoComplete="current-password" required />
          <Field name="newPassword" label={t("auth.newPassword")} type="password" autoComplete="new-password" hint={t("auth.passwordRules")} required />
          <Field name="confirmPassword" label={t("auth.confirmPassword")} type="password" autoComplete="new-password" required />
        </ActionForm>
      </div>
    </main>
  );
}
