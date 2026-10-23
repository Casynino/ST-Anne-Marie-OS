-- Nino (2026-10-23): the Registrar / Secretary can see the class and teacher timetables (read-only; the Academic Office prepares them).
-- Grant "timetable.read" to the system role in every school. No other permission changes.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'timetable.read'
WHERE r."key" = 'registrar' AND r."isSystem" = true
ON CONFLICT DO NOTHING;
