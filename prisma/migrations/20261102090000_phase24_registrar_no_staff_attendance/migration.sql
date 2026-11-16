-- Admissions does not record teachers' attendance (Nino's responsibility brief, 2026-11-16): that is the Head Teacher's. Remove it from the
-- Registrar system role in every school. Anyone given it on purpose through a custom role keeps it.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id" AND r."key" = 'registrar' AND r."isSystem" = true AND p."key" = 'attendance.staff.record';
