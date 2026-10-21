import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict, invalid } from "@/lib/errors";
import type { RequestMeta } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/phone";
import { writeAudit } from "@/server/audit";
import { persistDocument } from "@/server/documents";
import { DOCUMENT_TYPES } from "@/lib/admissions/document-types";
import { admissionAccount } from "@/lib/admissions/rules";
import { centsOf } from "@/lib/finance/money";
import { getFeeSettings } from "@/server/fees";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { applicationFeeInfo, newFeeReference } from "@/server/application-fee";
import { checkIncomingFiles, saveIncomingFiles, type IncomingFile } from "@/server/application-draft";
import { assertNoOpenDuplicate, DUPLICATE_MESSAGE, STATUS_PUBLIC, insertOnlineApplication, isUniqueViolation, onlineSchema, prepareOnline, toStored, type StoredForm } from "@/server/online-application";
import { loadWebsiteSettings } from "@/server/website";
import { parse, phoneField } from "@/lib/validation";

/*
 * Online applications from the public website. These are UNAUTHENTICATED requests, so every rule is enforced here:
 * applications must be open, rate limits per connection, a honeypot, strict validation, the same duplicate rules as
 * staff entry (but with answers that never reveal other families' records), and the data lands in the normal
 * admissions queue as APPLIED with source ONLINE. Nothing is enrolled automatically.
 */

const WINDOW_HOUR = 60 * 60 * 1000;
const WINDOW_DAY = 24 * WINDOW_HOUR;

/** Classes an applicant can choose from (real, active classes only). */
export async function listApplyClasses(schoolId: string, locale: "EN" | "SW") {
  const classes = await db.schoolClass.findMany({
    where: { schoolId, isActive: true },
    orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameSw: true, level: { select: { name: true, nameSw: true } } },
  });
  return classes.map((c) => ({
    id: c.id,
    name: locale === "SW" && c.nameSw ? c.nameSw : c.name,
    level: locale === "SW" && c.level.nameSw ? c.level.nameSw : c.level.name,
  }));
}

export type SubmitResult = {
  /** Set when the application is already with the Admissions Office (no fee to pay). */
  applicationNo: string | null;
  /** Set when an account and a draft were saved: the family continues on this application's page (to pay, or to download). */
  draftId?: string;
  /** The family signed up as part of applying: the caller signs them in with the details they just typed. */
  accountCreated?: boolean;
};

const ACCOUNT_TAKEN = "We could not create an account with these details. If you already have an account, sign in first and then apply.";

/**
 * A family applies online. Without a fee the application goes straight to the Admissions Office; with a fee it is saved as a draft under the
 * family's new account and only reaches the office once the payment provider confirms the fee (`confirmApplicationFee`). A family that is
 * already signed in applies under its own account. Everything is enforced here because the request is unauthenticated.
 */
export async function submitOnlineApplication(schoolId: string, input: Record<string, unknown>, meta: RequestMeta, opts: { userId?: string | null; /** The photo and papers sent with the form. Left out = not asked for (old-style callers); given (even empty) = the school's requirements are enforced. */ files?: IncomingFile[] } = {}): Promise<SubmitResult> {
  // Honeypot: real people never see or fill this field. Pretend success so bots learn nothing.
  if (typeof input.website === "string" && input.website.trim() !== "") return { applicationNo: null };

  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, timezone: true } });
  if (!school) throw new AppError("NOT_FOUND", "School not found.");
  const settings = await loadWebsiteSettings(school.id);
  if (!settings.applicationsOpen) throw conflict("Online applications are not open at the moment. Please contact the school office.");

  const ip = meta.ip ?? "unknown";
  const allowed = (await consumeRateLimit(`apply:ip:${ip}`, 5, WINDOW_HOUR)) && (await consumeRateLimit(`apply:school:${school.id}`, 300, WINDOW_DAY));
  if (!allowed) throw new AppError("RATE_LIMITED", "Too many applications from this connection. Please try again later or contact the school office.");

  const d = parse(onlineSchema, input);
  const prepared = await prepareOnline(school, d);
  const feeInfo = await applicationFeeInfo(school.id);
  if (feeInfo.feeCents > 0 && !feeInfo.ready) throw conflict("Online payment is not available at the moment. Please contact the school office.");

  // A new account is made when the family is not signed in and either pays a fee (so they can come back and pay) or chose a password.
  const typedPassword = d.password ?? "";
  const wantsAccount = !opts.userId && (feeInfo.feeCents > 0 || typedPassword !== "");
  let passwordHash: string | null = null;
  if (wantsAccount) {
    if (!(await consumeRateLimit(`apply:email:${school.id}:${d.g1_email ?? d.g1_phone}`, 5, WINDOW_DAY))) throw new AppError("RATE_LIMITED", "Too many attempts. Please try again later or contact the school office.");
    const errors: Record<string, string> = {};
    if (!d.g1_email) errors.g1_email = "Enter your email address: you will use it to sign in";
    const weak = typedPassword ? validatePasswordStrength(typedPassword) : "Choose a password";
    if (weak) errors.password = weak;
    else if (typedPassword !== (d.password2 ?? "")) errors.password2 = "The two passwords do not match";
    if (Object.keys(errors).length) throw invalid("Please correct the highlighted fields.", errors);
    passwordHash = await hashPassword(typedPassword);
  }
  const stored = toStored(d);
  const files = opts.files ?? [];
  if (opts.files && (feeInfo.feeCents > 0 || wantsAccount || opts.userId)) await checkIncomingFiles(school.id, opts.files, d.entryType);

  try {
    const result = await db.$transaction(async (tx) => {
      let userId = opts.userId ?? null;
      if (wantsAccount) {
        const role = await tx.role.findFirst({ where: { schoolId: school.id, key: "parent" }, select: { id: true } });
        if (!role) throw new AppError("NOT_FOUND", "The family portal is not set up yet. Please contact the school office.");
        const user = await tx.user.create({
          data: { schoolId: school.id, type: "GUARDIAN", fullName: d.g1_fullName, email: d.g1_email, phone: d.g1_phone, passwordHash: passwordHash!, mustChangePassword: false, roles: { create: [{ roleId: role.id }] } },
        });
        userId = user.id;
        await writeAudit(tx, { schoolId: school.id, actorId: null, actorName: "Online applicant", meta }, { action: "portal.applicant_account_created", entityType: "User", entityId: user.id, summary: d.g1_fullName });
      }

      if (feeInfo.feeCents === 0) {
        const app = await insertOnlineApplication(tx, school.id, d, prepared, meta);
        if (userId) await tx.applicationDraft.create({ data: { schoolId: school.id, userId, reference: newFeeReference(), payload: stored as object, feeAmount: "0.00", status: "SUBMITTED", applicationId: app.id } });
        return { applicationNo: app.applicationNo, ...(userId ? { draftId: (await tx.applicationDraft.findUniqueOrThrow({ where: { applicationId: app.id }, select: { id: true } })).id } : {}), accountCreated: wantsAccount };
      }

      // With a fee: check the child is not already applied for (or being applied for under this account), then save the draft.
      await assertNoOpenDuplicate(tx, school.id, d);
      for (const other of await tx.applicationDraft.findMany({ where: { schoolId: school.id, userId: userId!, status: "AWAITING_PAYMENT" }, select: { payload: true } })) {
        const o = other.payload as unknown as StoredForm;
        if (o.firstName.toLowerCase() === d.firstName.toLowerCase() && o.lastName.toLowerCase() === d.lastName.toLowerCase() && o.dateOfBirth === stored.dateOfBirth) throw conflict("You have already started an application for this child. Sign in to finish it.");
      }
      const draft = await tx.applicationDraft.create({ data: { schoolId: school.id, userId: userId!, reference: newFeeReference(), payload: stored as object, feeAmount: (feeInfo.feeCents / 100).toFixed(2) } });
      await writeAudit(tx, { schoolId: school.id, actorId: null, actorName: "Online applicant", meta }, { action: "admission.application_draft", entityType: "ApplicationDraft", entityId: draft.id, summary: `${d.firstName} ${d.lastName} (${draft.reference})`, changes: { feeCents: feeInfo.feeCents } });
      return { applicationNo: null, draftId: draft.id, accountCreated: wantsAccount };
    });
    // The photo and papers that came with the form belong to the family's draft (and to the application when it was sent at once).
    if (result.draftId && files.length > 0) {
      const row = await db.applicationDraft.findUniqueOrThrow({ where: { id: result.draftId }, select: { userId: true, applicationId: true } });
      await saveIncomingFiles({ schoolId: school.id, userId: row.userId, draftId: result.draftId, applicationId: row.applicationId, files, actor: { schoolId: school.id, actorId: null, actorName: "Online applicant", meta } });
    }
    return result;
  } catch (e) {
    if (isUniqueViolation(e)) {
      const target = JSON.stringify((e as { meta?: { target?: unknown } }).meta?.target ?? (e as Error).message ?? "");
      throw conflict(/email|phone|users/i.test(target) ? ACCOUNT_TAKEN : DUPLICATE_MESSAGE);
    }
    throw e;
  }
}


const trackSchema = z.object({ applicationNo: z.string().trim().min(5).max(30).transform((v) => v.toUpperCase()), phone: phoneField() });

/**
 * Lets a family check where their application stands. Requires the application number AND a guardian phone number
 * on it. Returns only a status (a rejection reason or any personal data is never shown) and fails with one generic
 * message so numbers cannot be probed.
 */
export async function trackApplication(schoolId: string, input: unknown, meta: RequestMeta) {
  const ip = meta.ip ?? "unknown";
  if (!(await consumeRateLimit(`track:ip:${ip}`, 10, WINDOW_HOUR))) throw new AppError("RATE_LIMITED", "Too many attempts. Please try again later.");
  const d = parse(trackSchema, input);
  const notFound = invalid("We could not find an application matching those details. Check the number and the phone number given on the application.");
  if (!(await consumeRateLimit(`track:app:${schoolId}:${d.applicationNo}`, 10, WINDOW_DAY))) throw new AppError("RATE_LIMITED", "Too many attempts for this application. Please contact the school office.");
  const app = await db.application.findUnique({
    where: { schoolId_applicationNo: { schoolId, applicationNo: d.applicationNo } },
    select: {
      id: true, status: true, createdAt: true, guardians: true, classAppliedId: true, reviewStatus: true, reviewNote: true,
      interviews: { where: { status: "SCHEDULED" }, select: { scheduledAt: true, location: true, method: true } },
      offer: { select: { status: true, letterNo: true, feeAmount: true, expiresOn: true, paymentWaivedAt: true } },
      payments: { select: { status: true, amount: true } },
    },
  });
  if (!app) throw notFound;
  const phones = (app.guardians as unknown[]).map((g) => normalizePhone(String((g as { phone?: string }).phone ?? "")));
  if (!phones.includes(d.phone)) throw notFound;
  const [cls, school, settings] = await Promise.all([
    app.classAppliedId ? db.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId }, select: { name: true } }) : null,
    db.school.findUnique({ where: { id: schoolId }, select: { currency: true, timezone: true } }),
    getFeeSettings(db, schoolId),
  ]);
  // Only what the family needs: the stage, the interview appointment, what to correct, the offer and how the admission payment stands.
  // Never interview notes or results, a rejection reason, or anything about other applicants.
  const offer = app.offer?.status === "ISSUED" && app.status === "ACCEPTED" ? app.offer : null;
  const account = offer ? admissionAccount(centsOf(offer.feeAmount), app.payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!offer.paymentWaivedAt) : null;
  return {
    status: STATUS_PUBLIC[app.status] ?? "APPLIED", submittedOn: app.createdAt, className: cls?.name ?? null, currency: school?.currency ?? "TZS", timezone: school?.timezone ?? "Africa/Dar_es_Salaam",
    interview: app.interviews[0] ? { at: app.interviews[0].scheduledAt, location: app.interviews[0].location, method: app.interviews[0].method } : null,
    correction: app.reviewStatus === "RETURNED" ? (app.reviewNote ?? "") : null,
    offer: offer ? { feeCents: centsOf(offer.feeAmount), expiresOn: offer.expiresOn, howToPay: settings.paymentInstructions.trim() || null } : null,
    payment: account ? { status: account.status, verifiedCents: account.verifiedCents, pendingCents: account.pendingCents, requiredCents: account.requiredCents } : null,
  };
}

const uploadSchema = z.object({ applicationNo: z.string().trim().min(5).max(30).transform((v) => v.toUpperCase()), phone: phoneField(), docType: z.enum(DOCUMENT_TYPES) });
const UPLOAD_OPEN = ["APPLIED", "INTERVIEW", "ACCEPTED"] as const;

/**
 * A family adds a supporting document to their open application. Unauthenticated, so everything is enforced here: the application number AND a
 * guardian phone on it must match (one generic failure otherwise), limits per connection and per application, only PDF / JPEG / PNG / WebP
 * decided from the file's own bytes, size cap, random storage key. The file waits for the Admissions Office to verify it; nothing is trusted
 * until then. It never reveals anything about the application.
 */
export async function uploadApplicantDocument(schoolId: string, input: { applicationNo: unknown; phone: unknown; docType: unknown; fileName: string; bytes: Buffer }, meta: RequestMeta) {
  const ip = meta.ip ?? "unknown";
  if (!(await consumeRateLimit(`upload:ip:${ip}`, 10, WINDOW_HOUR))) throw new AppError("RATE_LIMITED", "Too many uploads from this connection. Please try again later or bring the papers to the school office.");
  const d = parse(uploadSchema, { applicationNo: input.applicationNo, phone: input.phone, docType: input.docType });
  const notFound = invalid("We could not find an application matching those details. Check the number and the phone number given on the application.");
  if (!(await consumeRateLimit(`upload:app:${schoolId}:${d.applicationNo}`, 20, WINDOW_DAY))) throw new AppError("RATE_LIMITED", "Too many uploads for this application. Please contact the school office.");
  const app = await db.application.findUnique({ where: { schoolId_applicationNo: { schoolId, applicationNo: d.applicationNo } }, select: { id: true, status: true, guardians: true, firstName: true, lastName: true } });
  if (!app) throw notFound;
  const phones = (app.guardians as unknown[]).map((g) => normalizePhone(String((g as { phone?: string }).phone ?? "")));
  if (!phones.includes(d.phone)) throw notFound;
  if (!(UPLOAD_OPEN as readonly string[]).includes(app.status)) throw conflict("This application is closed. Please contact the school office.");
  await persistDocument({ schoolId, actor: { schoolId, actorId: null, actorName: "Online applicant", meta }, owner: { applicationId: app.id }, docType: d.docType, fileName: input.fileName, bytes: input.bytes, uploadedById: null });
}
