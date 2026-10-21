import type { Tx } from "@/lib/db";
import { writeAudit } from "@/server/audit";

/**
 * When an applicant is enrolled, the account the family applied with becomes the portal account of the child's guardian. It is linked only
 * when it clearly matches (the guardian with the account's phone number, or the primary guardian when none matches), never by guessing, and
 * never over a guardian that already has an account.
 */
export async function linkApplicantAccount(tx: Tx, schoolId: string, applicationId: string, studentId: string) {
  const draft = await tx.applicationDraft.findUnique({ where: { applicationId }, select: { userId: true } });
  if (!draft?.userId) return; // an application filled in at the office has no family account to link
  const user = await tx.user.findFirst({ where: { id: draft.userId, schoolId, type: "GUARDIAN" }, select: { id: true, phone: true, guardian: { select: { id: true } } } });
  if (!user || user.guardian) return;
  const links = await tx.studentGuardian.findMany({ where: { studentId, schoolId }, select: { isPrimary: true, guardian: { select: { id: true, phone: true, userId: true } } } });
  const mine = links.find((l) => !l.guardian.userId && l.guardian.phone === user.phone) ?? links.find((l) => l.isPrimary && !l.guardian.userId);
  if (!mine) return;
  await tx.guardian.update({ where: { id: mine.guardian.id }, data: { userId: user.id } });
  await writeAudit(tx, { schoolId, actorId: null, actorName: "System", meta: { ip: null, userAgent: null } }, { action: "portal.link_applicant_account", entityType: "Guardian", entityId: mine.guardian.id, summary: "Applicant account linked to the guardian", changes: { userId: user.id, studentId } });
}
