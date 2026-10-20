import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { listRoles } from "@/server/rbac";
import { PERMISSIONS, type PermissionKey } from "@/lib/rbac/permissions";
import { SUPER_ADMIN_ROLE_KEY } from "@/lib/rbac/roles";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { createRoleAction, deleteRoleAction, saveRolePermissionsAction } from "./actions";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("role.read")) return <NoAccess t={t} />;
  const roles = await listRoles(ctx);
  const canManage = ctx.permissions.has("role.manage");
  const modules = [...new Set(Object.values(PERMISSIONS).map((p) => p.module))];

  return (
    <>
      <PageHeader title={t("roles.title")} subtitle={t("roles.intro")} />
      {!canManage && <p className="mb-4 text-sm text-muted">{t("roles.readOnly")}</p>}
      {canManage && (
        <Card title={t("roles.new")} className="mb-5">
          <ActionForm action={createRoleAction} submitLabel={t("common.create")} className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <Field name="name" label={t("common.name")} required />
            <Field name="description" label={t("common.optional")} className="sm:col-span-1" />
          </ActionForm>
        </Card>
      )}
      <div className="space-y-4">
        {roles.map((role) => {
          const granted = new Set(role.permissions.map((p) => p.permission.key));
          const fixed = role.key === SUPER_ADMIN_ROLE_KEY;
          const editable = canManage && !fixed;
          return (
            <Card key={role.id} title={role.name} actions={<div className="flex flex-wrap items-center gap-2"><Badge>{role.isSystem ? t("roles.system") : t("roles.custom")}</Badge><Badge tone="brand">{t("roles.users", { count: role._count.users })}</Badge></div>}>
              {role.description && <p className="mb-3 text-sm text-muted">{role.description}</p>}
              {fixed && <p className="text-sm text-muted">{t("roles.fixed")}</p>}
              <details open={false}>
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-brand-700">{granted.size} / {Object.keys(PERMISSIONS).length}</summary>
                <ActionForm action={saveRolePermissionsAction} submitLabel={t("common.save")} hideSubmit={!editable} className="mt-2 space-y-4">
                  <input type="hidden" name="roleId" value={role.id} />
                  {modules.map((m) => (
                    <fieldset key={m}>
                      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{m}</legend>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {(Object.keys(PERMISSIONS) as PermissionKey[]).filter((k) => PERMISSIONS[k].module === m).map((k) => {
                          const mayGrant = ctx.permissions.has(k) || granted.has(k);
                          return (
                            <label key={k} className={`flex min-h-11 items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm ${editable && mayGrant ? "cursor-pointer hover:bg-canvas" : "opacity-70"}`}>
                              <input type="checkbox" name="permissions" value={k} defaultChecked={granted.has(k) || fixed} disabled={!editable || !ctx.permissions.has(k)} className="mt-1 size-5 accent-brand-700" />
                              <span><span className="font-medium">{PERMISSIONS[k].description}</span><span className="block text-xs text-muted">{k}</span></span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                  {editable && <p className="text-xs text-muted">{t("roles.cannotGrant")}</p>}
                </ActionForm>
                {canManage && !role.isSystem && (
                  <ActionForm action={deleteRoleAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("common.confirmAction")} className="mt-3"><input type="hidden" name="roleId" value={role.id} /></ActionForm>
                )}
              </details>
            </Card>
          );
        })}
      </div>
    </>
  );
}
