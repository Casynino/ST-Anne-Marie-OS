/**
 * One-time (and re-runnable) setup: permission catalog, the initial school, default roles
 * and — only when the school has no users yet — the first Super Admin from BOOTSTRAP_ADMIN_* env vars.
 * Creates NO demo students, fees or other operational data.
 */
// Run with: npm run db:bootstrap (loads .env via the runner flag).
import { db } from "../src/lib/db";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { normalizeEmail } from "../src/lib/phone";
import { ensureSchoolRoles, syncPermissionCatalog } from "../src/server/rbac";
import { ensureDefaultSettings } from "../src/server/settings";
import { allocateStaffNo } from "../src/server/school-ids";
import { SUPER_ADMIN_ROLE_KEY } from "../src/lib/rbac/roles";

async function main() {
  const newKeys = await syncPermissionCatalog(db);

  let school = await db.school.findUnique({ where: { code: "SAM" } });
  school ??= await db.school.create({
    data: { code: "SAM", name: "St Anne Marie Schools", branches: { create: { name: "Main Campus", code: "MAIN", isMain: true } } },
  });
  await ensureSchoolRoles(db, school.id, newKeys);
  await ensureDefaultSettings(db, school);

  const userCount = await db.user.count({ where: { schoolId: school.id } });
  if (userCount === 0) {
    const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "System Administrator";
    const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL ?? "");
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
    if (!email) throw new Error("BOOTSTRAP_ADMIN_EMAIL is missing or invalid.");
    const weak = validatePasswordStrength(password);
    if (weak) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${weak}`);
    const role = await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: school.id, key: SUPER_ADMIN_ROLE_KEY } } });
    const branch = await db.branch.findFirst({ where: { schoolId: school.id, isMain: true } });
    await db.user.create({
      data: {
        schoolId: school.id,
        branchId: branch?.id,
        fullName: name,
        email,
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        roles: { create: { roleId: role.id } },
        staff: { create: { schoolId: school.id, jobTitle: "System Administrator", staffNo: await allocateStaffNo(db, school.id, new Date().getUTCFullYear()) } },
      },
    });
    console.log(`Created first Super Admin: ${email} (must change password at first sign-in).`);
  } else {
    console.log("School already has users; no admin created.");
  }
  console.log(`Bootstrap complete. New permissions registered: ${newKeys.size}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
