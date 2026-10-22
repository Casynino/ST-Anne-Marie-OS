-- Nino (2026-10-22): the Registrar / Secretary may read a student's marks and report cards (read-only), so the Marks tab on the student's page
-- is available to Admissions. Grant "reportcard.read" to the system role in every school. Nothing else changes: no generating, publishing or fees.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'reportcard.read'
WHERE r."key" = 'registrar' AND r."isSystem" = true
ON CONFLICT DO NOTHING;
