-- Nino (2026-10-23): the Registrar / Secretary can also generate report cards (not publish them). Grant "reportcard.generate" to the system role
-- in every school. Generating still needs every subject result of the class to be locked; publishing to families stays with the Academic Office and the Head Teacher.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'reportcard.generate'
WHERE r."key" = 'registrar' AND r."isSystem" = true
ON CONFLICT DO NOTHING;
