-- The Registrar / Secretary looks at attendance (registers, rates, reports) but does not take it: teachers do. Remove "take attendance for any
-- class" from the system role in every school. Anyone given it on purpose through a custom role keeps it.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id" AND r."key" = 'registrar' AND r."isSystem" = true AND p."key" = 'attendance.take_any';
