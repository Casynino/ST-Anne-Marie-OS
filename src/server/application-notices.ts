import type { Tx } from "@/lib/db";

/*
 * What the family is told about its application. Online applicants have an account on the school's system, so a notice arrives in that
 * account (the bell) and that is recorded as SENT_IN_APP. A family without an account (an application typed in at the office) cannot be
 * reached this way: the notice is recorded as NO_ACCOUNT so staff see that someone must phone them. SMS needs a provider the school has not
 * chosen, so nothing here claims an SMS was sent. Each message has a key; the same key is never sent twice, so opening, reviewing or
 * saving an unchanged interview does not repeat a message.
 */

export type NoticeKind = "INFO_NEEDED" | "INTERVIEW" | "INTERVIEW_CHANGED" | "ACCEPTED" | "NOT_ACCEPTED" | "ENROLLED";
export type NoticeVars = { when?: string; where?: string; note?: string; className?: string };

const at = (s: string | undefined, en: boolean) => (s ? (en ? ` at ${s}` : ` mahali: ${s}`) : "");

function text(kind: NoticeKind, name: string, v: NoticeVars, locale: "EN" | "SW"): [string, string] {
  const en = locale === "EN";
  switch (kind) {
    case "INFO_NEEDED": return en
      ? [`More information needed for ${name}`, `The Admissions Office needs more information: ${v.note ?? ""} Open the application to add it.`.replace("  ", " ")]
      : [`Taarifa zaidi zinahitajika kwa ${name}`, `Ofisi ya Udahili inahitaji taarifa zaidi: ${v.note ?? ""} Fungua ombi ili kuziongeza.`.replace("  ", " ")];
    case "INTERVIEW": return en
      ? [`Interview for ${name}`, `The interview is on ${v.when}${at(v.where, true)}.`]
      : [`Usaili wa ${name}`, `Usaili utafanyika ${v.when}${at(v.where, false)}.`];
    case "INTERVIEW_CHANGED": return en
      ? [`Interview date changed for ${name}`, `The interview is now on ${v.when}${at(v.where, true)}.`]
      : [`Tarehe ya usaili ya ${name} imebadilika`, `Usaili sasa ni ${v.when}${at(v.where, false)}.`];
    case "ACCEPTED": return en
      ? [`A place has been offered to ${name}`, `A place${v.className ? ` in ${v.className}` : ""} has been offered. Open the application to see what to do next.`]
      : [`${name} amepewa nafasi`, `Nafasi${v.className ? ` ya ${v.className}` : ""} imetolewa. Fungua ombi kuona hatua zinazofuata.`];
    case "NOT_ACCEPTED": return en
      ? [`Decision on the application of ${name}`, "The Admissions Office has made a decision on this application. Please contact the school office for details."]
      : [`Uamuzi kuhusu ombi la ${name}`, "Ofisi ya Udahili imefanya uamuzi kuhusu ombi hili. Tafadhali wasiliana na ofisi ya shule kwa maelezo."];
    case "ENROLLED": return en
      ? [`${name} is now enrolled`, "Enrolment is complete."]
      : [`${name} amesajiliwa`, "Usajili umekamilika."];
  }
}

/** Tells the family once. Returns what happened so the caller can show it. Safe to call again with the same key (nothing is repeated). */
export async function noticeFamily(
  tx: Tx,
  ctx: { schoolId: string; userId: string },
  app: { id: string; firstName: string; lastName: string },
  n: { kind: NoticeKind; key: string; vars?: NoticeVars },
): Promise<"SENT_IN_APP" | "NO_ACCOUNT" | "ALREADY"> {
  const draft = await tx.applicationDraft.findFirst({ where: { schoolId: ctx.schoolId, applicationId: app.id }, select: { id: true, userId: true } });
  const status = draft?.userId ? "SENT_IN_APP" : "NO_ACCOUNT";
  const name = `${app.firstName} ${app.lastName}`;
  const made = await tx.applicationNotice.createMany({
    data: [{ schoolId: ctx.schoolId, applicationId: app.id, kind: n.kind, dedupeKey: n.key, status, detail: status === "NO_ACCOUNT" ? "The family has no account; tell them by phone." : null, createdById: ctx.userId }],
    skipDuplicates: true,
  });
  if (made.count === 0) return "ALREADY";
  if (draft?.userId) {
    const user = await tx.user.findFirst({ where: { id: draft.userId, schoolId: ctx.schoolId }, select: { locale: true } });
    const [title, body] = text(n.kind, name, n.vars ?? {}, user?.locale === "SW" ? "SW" : "EN");
    await tx.inAppNotification.create({ data: { schoolId: ctx.schoolId, userId: draft.userId, title, body, link: `/family/applications/${draft.id}` } });
  }
  return status;
}

/** What the office sees on an application: each message and whether the family could be reached. */
export async function noticesOf(client: Pick<Tx, "applicationNotice">, schoolId: string, applicationId: string) {
  return client.applicationNotice.findMany({ where: { schoolId, applicationId }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, status: true, detail: true, createdAt: true } });
}
