import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getStaffUser } from "@/server/users";
import { AppError } from "@/lib/errors";
import { displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { UserFields } from "@/components/user-form";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { SUPER_ADMIN_ROLE_KEY } from "@/lib/rbac/roles";
import { departmentOfRoleKeys } from "@/lib/rbac/departments";
import { resetPasswordAction, setUserStatusAction, updateUserAction } from "../actions";

export const metadata: Metadata = { title: "Staff member" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  if (!ctx.permissions.has("user.read")) return <NoAccess t={t} />;
  const user = await getStaffUser(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!user) notFound();
  const school = await getSchoolBasics(ctx.schoolId);
  const department = departmentOfRoleKeys(user.roles.map((r) => r.role.key));
  const targetIsAdmin = user.roles.some((r) => r.role.key === SUPER_ADMIN_ROLE_KEY);
  const mayManageTarget = !targetIsAdmin || ctx.roleKeys.includes(SUPER_ADMIN_ROLE_KEY);
  const self = user.id === ctx.userId;

  return (
    <>
      <PageHeader title={user.fullName} subtitle={`${t("users.lastLogin")}: ${user.lastLoginAt ? displayDateTime(user.lastLoginAt, school.timezone, locale) : t("users.never")}`} actions={<Badge tone={user.status === "ACTIVE" ? "ok" : "bad"}>{t(`users.status.${user.status}`)}</Badge>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {ctx.permissions.has("user.update") && mayManageTarget ? (
            <ActionForm action={updateUserAction} submitLabel={t("common.save")}>
              <input type="hidden" name="id" value={user.id} />
              <UserFields t={t} d={{ ...user, department: department?.key, jobTitle: user.staff?.jobTitle, staffNo: user.staff?.staffNo, employedOn: user.staff?.employedOn }} />
            </ActionForm>
          ) : (
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted">{t("common.email")}</dt><dd>{user.email ?? "—"}</dd></div>
              <div><dt className="text-muted">{t("common.phone")}</dt><dd>{user.phone ?? "—"}</dd></div>
              <div><dt className="text-muted">{t("users.roles")}</dt><dd className="flex flex-wrap gap-1">{user.roles.map((r) => <Badge key={r.roleId} tone="brand">{r.role.name}</Badge>)}</dd></div>
            </dl>
          )}
        </Card>
        <div className="space-y-5">
          {ctx.permissions.has("user.reset_password") && mayManageTarget && (
            <Card title={t("users.resetPassword")}>
              <ActionForm action={resetPasswordAction} submitLabel={t("users.resetPassword")} confirm={t("common.confirmAction")}>
                <input type="hidden" name="id" value={user.id} />
                <Field name="password" label={t("users.newPassword")} autoComplete="off" required hint={t("users.password.hint")} />
              </ActionForm>
            </Card>
          )}
          {ctx.permissions.has("user.suspend") && mayManageTarget && !self && (
            <Card title={user.status === "ACTIVE" ? t("users.suspend") : t("users.reactivate")}>
              <ActionForm action={setUserStatusAction} submitLabel={user.status === "ACTIVE" ? t("users.suspend") : t("users.reactivate")} tone={user.status === "ACTIVE" ? "danger" : "primary"} className="space-y-3" confirm={t("common.confirmAction")}>
                <input type="hidden" name="id" value={user.id} />
                <input type="hidden" name="status" value={user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                <Field name="reason" label={t("common.reason")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
