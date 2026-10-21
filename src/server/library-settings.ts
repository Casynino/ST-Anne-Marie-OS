import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { checkbox, parse } from "@/lib/validation";

/** The school's library rules (setting key `library`). Defaults are the careful ones: approval needed, no ID-only access. */
export type LibrarySettings = {
  /** A resource must be approved by someone other than its uploader before it can be published. */
  requireApproval: boolean;
  /** How long a verified browser session lasts, in hours. */
  sessionHours: number;
  /** Resources the school marks "open to the school ID alone" really are (otherwise the PIN or password is always needed). */
  allowIdOnly: boolean;
};

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = { requireApproval: true, sessionHours: 12, allowIdOnly: false };
const KEY = "library";

export async function getLibrarySettings(client: Db | Tx, schoolId: string): Promise<LibrarySettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  const s = (row?.value ?? {}) as Partial<LibrarySettings>;
  const d = DEFAULT_LIBRARY_SETTINGS;
  return {
    requireApproval: typeof s.requireApproval === "boolean" ? s.requireApproval : d.requireApproval,
    sessionHours: Number.isInteger(s.sessionHours) && (s.sessionHours as number) >= 1 && (s.sessionHours as number) <= 168 ? (s.sessionHours as number) : d.sessionHours,
    allowIdOnly: typeof s.allowIdOnly === "boolean" ? s.allowIdOnly : d.allowIdOnly,
  };
}

const schema = z.object({ requireApproval: checkbox(), sessionHours: z.coerce.number().int().min(1).max(168), allowIdOnly: checkbox() });

export async function updateLibrarySettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "library.manage");
  const d = parse(schema, input);
  const before = await getLibrarySettings(db, ctx.schoolId);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: KEY } }, create: { schoolId: ctx.schoolId, key: KEY, value: d, updatedById: ctx.userId }, update: { value: d, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "settings.library_update", entityType: "SchoolSetting", entityId: KEY, changes: diffFields(before, d, ["requireApproval", "sessionHours", "allowIdOnly"]) });
  });
}
