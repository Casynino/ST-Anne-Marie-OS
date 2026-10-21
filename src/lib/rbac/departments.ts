/*
 * The simple way to give a staff member access: pick a department. Each department is one of the school's standard roles, so the
 * permissions behind it are exactly the same as when the role is chosen on the Roles page. Anything more detailed (a custom role, two
 * roles on one person) is still done with roles; the account form does not ask for it.
 */
export const DEPARTMENTS = [
  { key: "admin", roleKey: "super_admin", label: "dept.admin" },
  { key: "head", roleKey: "head_teacher", label: "dept.head" },
  { key: "admissions", roleKey: "registrar", label: "dept.admissions" },
  { key: "academic", roleKey: "academic_office", label: "dept.academic" },
  { key: "finance", roleKey: "accountant", label: "dept.finance" },
  { key: "teaching", roleKey: "class_teacher", label: "dept.teaching" },
] as const;

export type DepartmentKey = (typeof DEPARTMENTS)[number]["key"];
export const DEPARTMENT_KEYS = DEPARTMENTS.map((d) => d.key) as [DepartmentKey, ...DepartmentKey[]];

export const departmentByKey = (key: string) => DEPARTMENTS.find((d) => d.key === key);
export const departmentOfRoleKeys = (roleKeys: readonly string[]) => DEPARTMENTS.find((d) => roleKeys.includes(d.roleKey));
