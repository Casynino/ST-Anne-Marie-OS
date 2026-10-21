import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { getStorage } from "@/lib/storage";
import { canAccess, canDiscover, type Audience, type Decision, type ResourceRule, type Viewer } from "@/lib/library/access";
import { kindOfMime, MAX_COVER_BYTES, MAX_LIBRARY_BYTES, safeName, sniffCover, sniffLibraryFile, type LibraryKind } from "@/lib/library/files";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { getLibrarySettings } from "@/server/library-settings";
import { checkbox, optDateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * The digital library: categories, resources with versioned files in private storage, the publication workflow, and search that only ever
 * lists what the viewer may see. Who may open a file is decided by `canAccess` (pure, in src/lib/library/access.ts) on the server for every
 * request; hiding a button protects nothing, and no file has a public address.
 */

export type LibraryFileInput = { fileName: string; bytes: Buffer };
const AUDIENCES = ["PUBLIC", "STUDENTS", "STAFF", "CLASSES", "SUBJECTS", "RESTRICTED"] as const;
const STATUSES = ["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"] as const;
export const PAGE_SIZE = 12;

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "category";
const asArray = (v: unknown) => (Array.isArray(v) ? v : v === undefined || v === "" ? [] : [v]);

// ───────────────────────── Categories ─────────────────────────

const DEFAULT_CATEGORIES: [string, string][] = [
  ["Textbooks", "Vitabu vya kiada"], ["Class Notes", "Maelezo ya darasa"], ["Past Papers", "Mitihani iliyopita"], ["Revision Guides", "Miongozo ya marudio"],
  ["Exercises", "Mazoezi"], ["Assignments", "Kazi za nyumbani"], ["Reference Materials", "Vitabu vya marejeo"], ["General Learning Resources", "Rasilimali za jumla za kujifunzia"],
];

/** Gives a school the standard categories the first time it uses the library. Idempotent; the school can rename, hide or add its own. */
export async function ensureLibraryCategories(client: Db | Tx, schoolId: string) {
  if ((await client.libraryCategory.count({ where: { schoolId } })) > 0) return;
  await client.libraryCategory.createMany({ data: DEFAULT_CATEGORIES.map(([name, nameSw], i) => ({ schoolId, name, nameSw, slug: slugify(name), sortOrder: i })), skipDuplicates: true });
}

export async function listCategories(schoolId: string, opts: { activeOnly?: boolean } = {}) {
  await ensureLibraryCategories(db, schoolId);
  return db.libraryCategory.findMany({ where: { schoolId, ...(opts.activeOnly ? { isActive: true } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

const categorySchema = z.object({ name: text(60), nameSw: optText(60), sortOrder: z.coerce.number().int().min(0).max(999).default(0), isActive: checkbox() });

export async function createCategory(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "library.manage");
  const d = parse(categorySchema, input);
  await ensureLibraryCategories(db, ctx.schoolId);
  const slug = slugify(d.name);
  if (await db.libraryCategory.findUnique({ where: { schoolId_slug: { schoolId: ctx.schoolId, slug } } })) throw invalid("Please correct the highlighted fields.", { name: "A category with this name already exists" });
  const c = await db.libraryCategory.create({ data: { schoolId: ctx.schoolId, name: d.name, nameSw: d.nameSw, slug, sortOrder: d.sortOrder, isActive: true } });
  await writeAudit(db, actorOf(ctx), { action: "library.category_create", entityType: "LibraryCategory", entityId: c.id, summary: c.name });
  return c;
}

export async function updateCategory(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "library.manage");
  const d = parse(categorySchema, input);
  const before = await db.libraryCategory.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!before) throw notFound("Category");
  const slug = slugify(d.name);
  if (slug !== before.slug && (await db.libraryCategory.findUnique({ where: { schoolId_slug: { schoolId: ctx.schoolId, slug } } }))) throw invalid("Please correct the highlighted fields.", { name: "A category with this name already exists" });
  await db.libraryCategory.update({ where: { id }, data: { name: d.name, nameSw: d.nameSw ?? null, slug, sortOrder: d.sortOrder, isActive: d.isActive } });
  await writeAudit(db, actorOf(ctx), { action: "library.category_update", entityType: "LibraryCategory", entityId: id, summary: d.name, changes: diffFields(before, { name: d.name, nameSw: d.nameSw ?? null, isActive: d.isActive }, ["name", "nameSw", "isActive"]) });
}

// ───────────────────────── Files ─────────────────────────

async function storeFile(schoolId: string, file: LibraryFileInput) {
  if (file.bytes.length === 0) throw invalid("The file is empty.", { file: "The file is empty" });
  if (file.bytes.length > MAX_LIBRARY_BYTES) throw invalid(`The file is too large. The limit is ${Math.floor(MAX_LIBRARY_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
  const type = sniffLibraryFile(file.bytes, file.fileName);
  if (!type) throw invalid("Only PDF, Word, PowerPoint, Excel or picture files are accepted.", { file: "Unsupported file type" });
  const storage = getStorage();
  if (!storage) throw invalid("File storage is not set up yet. Ask the administrator to set it up before uploading.");
  const storageKey = `${schoolId}/library/${new Date().getUTCFullYear()}/${randomUUID()}.${type.ext}`;
  await storage.put(storageKey, file.bytes, { contentType: type.mime });
  return { storageKey, type, sha256: createHash("sha256").update(file.bytes).digest("hex"), sizeBytes: file.bytes.length, fileName: safeName(file.fileName) };
}

async function storeCover(schoolId: string, cover: LibraryFileInput) {
  if (cover.bytes.length > MAX_COVER_BYTES) throw invalid("The cover picture is too large (2 MB at most).", { cover: "Picture too large" });
  const type = sniffCover(cover.bytes);
  if (!type) throw invalid("The cover must be a JPEG, PNG or WebP picture.", { cover: "Not a picture" });
  const storage = getStorage();
  if (!storage) throw invalid("File storage is not set up yet.");
  const storageKey = `${schoolId}/library/covers/${randomUUID()}.${type.ext}`;
  await storage.put(storageKey, cover.bytes, { contentType: type.mime });
  return { storageKey, mime: type.mime };
}

const unstore = (keys: (string | undefined)[]) => Promise.all(keys.filter((k): k is string => !!k).map((k) => getStorage()?.delete(k).catch(() => undefined)));

// ───────────────────────── Create and edit ─────────────────────────

const metaSchema = z
  .object({
    title: text(160),
    description: optText(2000),
    categoryId: uuid(),
    language: z.preprocess((v) => (v === "" || v === undefined ? "EN" : v), z.enum(["EN", "SW", "OTHER"])),
    author: optText(120),
    academicYearId: optUuid(),
    audience: z.enum(AUDIENCES),
    idOnly: checkbox(),
    featured: checkbox(),
    availableFrom: optDateOnly(),
    copyright: optText(300),
    classIds: z.preprocess(asArray, z.array(uuid()).max(60)),
    subjectIds: z.preprocess(asArray, z.array(uuid()).max(60)),
    staffIds: z.preprocess(asArray, z.array(uuid()).max(60)),
  })
  .superRefine((v, c) => {
    if (v.audience === "CLASSES" && v.classIds.length === 0) c.addIssue({ code: "custom", path: ["classIds"], message: "Choose at least one class" });
    if (v.audience === "SUBJECTS" && v.subjectIds.length === 0) c.addIssue({ code: "custom", path: ["subjectIds"], message: "Choose at least one subject" });
    if (v.idOnly && !["STUDENTS", "CLASSES", "SUBJECTS"].includes(v.audience)) c.addIssue({ code: "custom", path: ["idOnly"], message: "Only material for students can be open to the school ID alone" });
  });
type Meta = z.output<typeof metaSchema>;

async function assertRefs(schoolId: string, d: Meta) {
  const [cat, classes, subjects, staff, year] = await Promise.all([
    db.libraryCategory.findFirst({ where: { id: d.categoryId, schoolId, isActive: true }, select: { id: true } }),
    d.classIds.length ? db.schoolClass.count({ where: { schoolId, id: { in: d.classIds } } }) : 0,
    d.subjectIds.length ? db.subject.count({ where: { schoolId, id: { in: d.subjectIds } } }) : 0,
    d.staffIds.length ? db.staff.count({ where: { schoolId, id: { in: d.staffIds } } }) : 0,
    d.academicYearId ? db.academicYear.findFirst({ where: { id: d.academicYearId, schoolId }, select: { id: true } }) : true,
  ]);
  const errors: Record<string, string> = {};
  if (!cat) errors.categoryId = "Choose a category";
  if (classes !== new Set(d.classIds).size) errors.classIds = "Choose classes from the list";
  if (subjects !== new Set(d.subjectIds).size) errors.subjectIds = "Choose subjects from the list";
  if (staff !== new Set(d.staffIds).size) errors.staffIds = "Choose staff from the list";
  if (!year) errors.academicYearId = "Choose an academic year from the list";
  if (Object.keys(errors).length) throw invalid("Please correct the highlighted fields.", errors);
}

const lists = (schoolId: string, resourceId: string, d: Meta) => ({
  classes: d.classIds.map((classId) => ({ resourceId, classId, schoolId })),
  subjects: d.subjectIds.map((subjectId) => ({ resourceId, subjectId, schoolId })),
  staff: d.audience === "RESTRICTED" ? d.staffIds.map((staffId) => ({ resourceId, staffId, schoolId })) : [],
});

export async function createResource(ctx: AuthContext, input: unknown, file: LibraryFileInput, cover?: LibraryFileInput | null) {
  requirePermission(ctx, "library.upload");
  const d = parse(metaSchema, input);
  await assertRefs(ctx.schoolId, d);
  await ensureLibraryCategories(db, ctx.schoolId);
  const stored = await storeFile(ctx.schoolId, file);
  const storedCover = cover && cover.bytes.length > 0 ? await storeCover(ctx.schoolId, cover).catch(async (e) => { await unstore([stored.storageKey]); throw e; }) : null;
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.libraryResource.create({
        data: {
          schoolId: ctx.schoolId, title: d.title, description: d.description, categoryId: d.categoryId, language: d.language, author: d.author, academicYearId: d.academicYearId,
          audience: d.audience, idOnly: d.idOnly, featured: d.featured, availableFrom: d.availableFrom, copyright: d.copyright, createdById: ctx.userId,
          coverKey: storedCover?.storageKey, coverMime: storedCover?.mime,
        },
      });
      const l = lists(ctx.schoolId, r.id, d);
      await Promise.all([tx.libraryResourceClass.createMany({ data: l.classes }), tx.libraryResourceSubject.createMany({ data: l.subjects }), tx.libraryResourceStaff.createMany({ data: l.staff })]);
      await tx.libraryFile.create({ data: { schoolId: ctx.schoolId, resourceId: r.id, version: 1, isCurrent: true, storageKey: stored.storageKey, fileName: stored.fileName, mimeType: stored.type.mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedById: ctx.userId } });
      await writeAudit(tx, actorOf(ctx), { action: "library.resource_create", entityType: "LibraryResource", entityId: r.id, summary: r.title, changes: { audience: d.audience, categoryId: d.categoryId, file: stored.fileName } });
      return r;
    });
  } catch (e) {
    await unstore([stored.storageKey, storedCover?.storageKey]);
    throw e;
  }
}

/** Everyone who may open the management screens sees their own resources; reviewers, publishers, managers and analysts see all. */
const seesAll = (ctx: AuthContext) => ["library.review", "library.publish", "library.manage", "library.analytics"].some((p) => ctx.permissions.has(p as never));

async function loadForStaff(ctx: AuthContext, id: string) {
  const r = await db.libraryResource.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { classes: true, subjects: true, staff: true, category: true, files: { orderBy: { version: "desc" } } } });
  if (!r) throw notFound("Resource");
  if (r.createdById !== ctx.userId && !seesAll(ctx)) throw notFound("Resource"); // someone else's draft is not theirs to know about
  return r;
}

const canEditAnyone = (ctx: AuthContext) => ctx.permissions.has("library.manage") || ctx.permissions.has("library.publish");

/** The uploader may change a resource until it is sent for review; managers and publishers may change any resource that is not archived. */
function assertEditable(ctx: AuthContext, r: { createdById: string; status: string }) {
  requireAnyPermission(ctx, ["library.upload", "library.manage", "library.publish"]);
  if (r.status === "ARCHIVED") throw conflict("An archived resource cannot be changed. Restore it first.");
  const own = r.createdById === ctx.userId && ctx.permissions.has("library.upload") && r.status === "DRAFT";
  if (!own && !canEditAnyone(ctx)) throw forbidden("You can change your own resource until you send it for review.");
}

export async function updateResource(ctx: AuthContext, id: string, input: unknown, cover?: LibraryFileInput | null) {
  const r = await loadForStaff(ctx, id);
  assertEditable(ctx, r);
  const d = parse(metaSchema, input);
  await assertRefs(ctx.schoolId, d);
  const storedCover = cover && cover.bytes.length > 0 ? await storeCover(ctx.schoolId, cover) : null;
  try {
    await db.$transaction(async (tx) => {
      await tx.libraryResource.update({
        where: { id },
        data: {
          title: d.title, description: d.description ?? null, categoryId: d.categoryId, language: d.language, author: d.author ?? null, academicYearId: d.academicYearId ?? null, audience: d.audience,
          idOnly: d.idOnly, featured: d.featured, availableFrom: d.availableFrom ?? null, copyright: d.copyright ?? null, ...(storedCover ? { coverKey: storedCover.storageKey, coverMime: storedCover.mime } : {}),
        },
      });
      const l = lists(ctx.schoolId, id, d);
      await Promise.all([tx.libraryResourceClass.deleteMany({ where: { resourceId: id } }), tx.libraryResourceSubject.deleteMany({ where: { resourceId: id } }), tx.libraryResourceStaff.deleteMany({ where: { resourceId: id } })]);
      await Promise.all([tx.libraryResourceClass.createMany({ data: l.classes }), tx.libraryResourceSubject.createMany({ data: l.subjects }), tx.libraryResourceStaff.createMany({ data: l.staff })]);
      await writeAudit(tx, actorOf(ctx), {
        action: "library.resource_update", entityType: "LibraryResource", entityId: id, summary: d.title,
        changes: diffFields({ title: r.title, audience: r.audience, categoryId: r.categoryId, featured: r.featured, idOnly: r.idOnly }, { title: d.title, audience: d.audience, categoryId: d.categoryId, featured: d.featured, idOnly: d.idOnly }, ["title", "audience", "categoryId", "featured", "idOnly"]),
      });
    });
  } catch (e) {
    await unstore([storedCover?.storageKey]);
    throw e;
  }
}

/** Adds a new version of the file. The old versions stay on record (and in storage); readers get the new one at once. */
export async function replaceFile(ctx: AuthContext, id: string, file: LibraryFileInput, note?: string) {
  const r = await loadForStaff(ctx, id);
  assertEditable(ctx, r);
  const stored = await storeFile(ctx.schoolId, file);
  try {
    await db.$transaction(async (tx) => {
      const last = await tx.libraryFile.findFirst({ where: { resourceId: id }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.libraryFile.updateMany({ where: { resourceId: id, isCurrent: true }, data: { isCurrent: false } });
      await tx.libraryFile.create({ data: { schoolId: ctx.schoolId, resourceId: id, version: (last?.version ?? 0) + 1, isCurrent: true, storageKey: stored.storageKey, fileName: stored.fileName, mimeType: stored.type.mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, note: note?.slice(0, 300) || null, uploadedById: ctx.userId } });
      await writeAudit(tx, actorOf(ctx), { action: "library.file_replace", entityType: "LibraryResource", entityId: id, summary: `${r.title}: ${stored.fileName}`, changes: { version: (last?.version ?? 0) + 1 } });
    });
  } catch (e) {
    await unstore([stored.storageKey]);
    throw e;
  }
}

// ───────────────────────── Workflow ─────────────────────────

async function move(ctx: AuthContext, id: string, from: readonly (typeof STATUSES)[number][], to: (typeof STATUSES)[number], data: Prisma.LibraryResourceUpdateManyMutationInput, action: string, extra?: { reason?: string }) {
  const r = await db.libraryResource.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { title: true } });
  if (!r) throw notFound("Resource");
  await db.$transaction(async (tx) => {
    const n = await tx.libraryResource.updateMany({ where: { id, schoolId: ctx.schoolId, status: { in: [...from] } }, data: { status: to, ...data } });
    if (n.count === 0) throw conflict("This resource is no longer in the stage this step needs. Reload the page.");
    await writeAudit(tx, actorOf(ctx), { action, entityType: "LibraryResource", entityId: id, summary: r.title, reason: extra?.reason, changes: { to } });
  });
}

/** Sends a draft on: for review when the school requires approval, otherwise straight to approved (ready to publish). */
export async function submitResource(ctx: AuthContext, id: string) {
  const r = await loadForStaff(ctx, id);
  if (r.createdById !== ctx.userId && !ctx.permissions.has("library.manage")) throw forbidden("Only the person who uploaded a resource can send it for review.");
  if (!r.files.some((f) => f.isCurrent)) throw conflict("Add a file first.");
  const { requireApproval } = await getLibrarySettings(db, ctx.schoolId);
  await move(ctx, id, ["DRAFT"], requireApproval ? "PENDING_REVIEW" : "APPROVED", { submittedAt: new Date(), reviewNote: null }, "library.resource_submit");
}

export async function approveResource(ctx: AuthContext, id: string, note?: string) {
  requirePermission(ctx, "library.review");
  const r = await loadForStaff(ctx, id);
  if (r.createdById === ctx.userId) throw forbidden("Someone else must approve what you uploaded.");
  await move(ctx, id, ["PENDING_REVIEW"], "APPROVED", { reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note?.slice(0, 300) || null }, "library.resource_approve");
}

export async function returnResource(ctx: AuthContext, id: string, note: unknown) {
  requirePermission(ctx, "library.review");
  const why = parse(text(300), note);
  const r = await loadForStaff(ctx, id);
  if (r.createdById === ctx.userId) throw forbidden("Someone else must review what you uploaded.");
  await move(ctx, id, ["PENDING_REVIEW"], "DRAFT", { reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: why }, "library.resource_return", { reason: why });
}

/** Makes an approved resource visible to its audience. Where the school does not require approval, a draft may be published directly. */
export async function publishResource(ctx: AuthContext, id: string) {
  requirePermission(ctx, "library.publish");
  const r = await loadForStaff(ctx, id);
  if (!r.files.some((f) => f.isCurrent)) throw conflict("Add a file first.");
  const { requireApproval } = await getLibrarySettings(db, ctx.schoolId);
  await move(ctx, id, requireApproval ? ["APPROVED"] : ["DRAFT", "APPROVED"], "PUBLISHED", { publishedAt: new Date(), publishedById: ctx.userId, archivedAt: null }, "library.resource_publish");
}

export async function archiveResource(ctx: AuthContext, id: string, reason?: string) {
  requirePermission(ctx, "library.publish");
  await loadForStaff(ctx, id);
  await move(ctx, id, ["PUBLISHED", "APPROVED", "PENDING_REVIEW", "DRAFT"], "ARCHIVED", { archivedAt: new Date() }, "library.resource_archive", { reason });
}

/** Brings an archived resource back as a draft; it goes through review again before it is shown. */
export async function restoreResource(ctx: AuthContext, id: string) {
  requirePermission(ctx, "library.publish");
  await loadForStaff(ctx, id);
  await move(ctx, id, ["ARCHIVED"], "DRAFT", { archivedAt: null, publishedAt: null }, "library.resource_restore");
}

// ───────────────────────── Management lists ─────────────────────────

export type ManageFilters = { q?: string; status?: string; categoryId?: string; classId?: string; subjectId?: string; page?: number };

export async function listManageResources(ctx: AuthContext, f: ManageFilters = {}) {
  requireAnyPermission(ctx, ["library.read", "library.manage", "library.review", "library.publish", "library.upload"]);
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim();
  const where: Prisma.LibraryResourceWhereInput = {
    schoolId: ctx.schoolId,
    ...(seesAll(ctx) ? {} : { createdById: ctx.userId }),
    ...(f.status && (STATUSES as readonly string[]).includes(f.status) ? { status: f.status as (typeof STATUSES)[number] } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.classId ? { classes: { some: { classId: f.classId } } } : {}),
    ...(f.subjectId ? { subjects: { some: { subjectId: f.subjectId } } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { author: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.libraryResource.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 25, take: 25, include: { category: { select: { name: true } }, files: { where: { isCurrent: true }, select: { mimeType: true, sizeBytes: true, fileName: true } } } }),
    db.libraryResource.count({ where }),
  ]);
  return { items, total, page, pageSize: 25 };
}

export async function getManageResource(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["library.read", "library.manage", "library.review", "library.publish", "library.upload"]);
  const r = await loadForStaff(ctx, id);
  const names = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set([r.createdById, r.reviewedById, r.publishedById, ...r.files.map((f) => f.uploadedById)].filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
  const nameOf = (uid: string | null) => names.find((n) => n.id === uid)?.fullName ?? null;
  const [use, classes, subjects, staff] = await Promise.all([
    db.libraryEvent.groupBy({ by: ["kind"], where: { schoolId: ctx.schoolId, resourceId: id, outcome: "GRANTED" }, _count: true }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: r.classes.map((c) => c.classId) } }, select: { id: true, name: true } }),
    db.subject.findMany({ where: { schoolId: ctx.schoolId, id: { in: r.subjects.map((c) => c.subjectId) } }, select: { id: true, name: true } }),
    db.staff.findMany({ where: { schoolId: ctx.schoolId, id: { in: r.staff.map((c) => c.staffId) } }, select: { id: true, user: { select: { fullName: true } } } }),
  ]);
  return {
    ...r, createdBy: nameOf(r.createdById), reviewedBy: nameOf(r.reviewedById), publishedBy: nameOf(r.publishedById),
    versions: r.files.map((f) => ({ ...f, uploadedBy: nameOf(f.uploadedById) })),
    classNames: classes, subjectNames: subjects, staffNames: staff.map((s) => ({ id: s.id, name: s.user.fullName })),
    use: { views: use.find((u) => u.kind === "VIEW")?._count ?? 0, downloads: use.find((u) => u.kind === "DOWNLOAD")?._count ?? 0 },
  };
}

// ───────────────────────── What a viewer may see ─────────────────────────

/** The database form of `canDiscover`: only published, released resources whose audience includes the viewer (an integration test checks the two agree). */
export function visibilityWhere(viewer: Viewer, now: Date): Prisma.LibraryResourceWhereInput {
  const live: Prisma.LibraryResourceWhereInput = { status: "PUBLISHED", OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] };
  const audiences: Prisma.LibraryResourceWhereInput[] = [{ audience: "PUBLIC" }];
  if (viewer.kind === "VISITOR" || viewer.kind === "GUARDIAN") audiences.push({ audience: { in: ["STUDENTS", "CLASSES", "SUBJECTS"] } });
  else if (viewer.kind === "STUDENT") {
    audiences.push({ audience: "STUDENTS" });
    if (viewer.classId) audiences.push({ audience: "CLASSES", classes: { some: { classId: viewer.classId } } });
    if (viewer.subjectIds.length) audiences.push({ audience: "SUBJECTS", subjects: { some: { subjectId: { in: viewer.subjectIds } } } });
  } else if (viewer.manager) {
    audiences.push({ audience: { in: [...AUDIENCES] } });
  } else {
    audiences.push({ audience: "RESTRICTED", staff: { some: { staffId: viewer.staffId } } });
    if (viewer.canReadStaffMaterial) {
      audiences.push({ audience: { in: ["STUDENTS", "STAFF"] } });
      if (viewer.classIds.length) audiences.push({ audience: "CLASSES", classes: { some: { classId: { in: viewer.classIds } } } });
      if (viewer.subjectIds.length) audiences.push({ audience: "SUBJECTS", subjects: { some: { subjectId: { in: viewer.subjectIds } } } });
    }
  }
  return { AND: [live, { OR: audiences }] };
}

const ruleOf = (r: { status: string; audience: string; availableFrom: Date | null; idOnly: boolean; classes: { classId: string }[]; subjects: { subjectId: string }[]; staff: { staffId: string }[] }): ResourceRule => ({
  status: r.status, audience: r.audience as Audience, availableFrom: r.availableFrom, idOnly: r.idOnly, classIds: r.classes.map((c) => c.classId), subjectIds: r.subjects.map((s) => s.subjectId), staffIds: r.staff.map((s) => s.staffId),
});

const cardInclude = {
  category: { select: { id: true, name: true, nameSw: true } },
  files: { where: { isCurrent: true }, select: { id: true, mimeType: true, sizeBytes: true } },
  classes: { select: { classId: true, class: { select: { name: true, nameSw: true } } } },
  subjects: { select: { subjectId: true, subject: { select: { name: true, nameSw: true } } } },
  staff: { select: { staffId: true } },
} satisfies Prisma.LibraryResourceInclude;
type CardRow = Prisma.LibraryResourceGetPayload<{ include: typeof cardInclude }>;

export type ResourceCard = {
  id: string; title: string; description: string | null; category: { id: string; name: string }; kind: LibraryKind; sizeBytes: number; language: string; author: string | null;
  classes: string[]; subjects: string[]; audience: string; coverUrl: string | null; publishedAt: Date | null; featured: boolean; access: Decision; hasFile: boolean;
};

function card(r: CardRow, viewer: Viewer, locale: "EN" | "SW", allowIdOnly: boolean, now: Date): ResourceCard {
  const f = r.files[0];
  return {
    id: r.id, title: r.title, description: r.description, category: { id: r.category.id, name: locale === "SW" && r.category.nameSw ? r.category.nameSw : r.category.name },
    kind: f ? kindOfMime(f.mimeType) : "PDF", sizeBytes: f?.sizeBytes ?? 0, language: r.language, author: r.author,
    classes: r.classes.map((c) => (locale === "SW" && c.class.nameSw ? c.class.nameSw : c.class.name)), subjects: r.subjects.map((s) => (locale === "SW" && s.subject.nameSw ? s.subject.nameSw : s.subject.name)),
    audience: r.audience, coverUrl: r.coverKey ? `/api/library/covers/${r.id}` : null, publishedAt: r.publishedAt, featured: r.featured, hasFile: !!f,
    access: canAccess(viewer, ruleOf(r), { now, allowIdOnly }),
  };
}

export type SearchFilters = { q?: string; categoryId?: string; classId?: string; subjectId?: string; language?: string; type?: string; sort?: string; page?: number };

/** Search and browse. Only resources the viewer may discover are ever returned, in pages. */
export async function searchLibrary(schoolId: string, viewer: Viewer, f: SearchFilters, locale: "EN" | "SW") {
  const now = new Date();
  const q = f.q?.trim().slice(0, 100);
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const mimes: Record<string, string[]> = { PDF: ["application/pdf"], DOCUMENT: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], SLIDES: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], SHEET: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], IMAGE: ["image/jpeg", "image/png", "image/webp"] };
  const filters: Prisma.LibraryResourceWhereInput[] = [];
  if (q) filters.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { author: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }, { subjects: { some: { subject: { name: { contains: q, mode: "insensitive" } } } } }, { classes: { some: { class: { name: { contains: q, mode: "insensitive" } } } } }] });
  if (f.categoryId) filters.push({ categoryId: f.categoryId });
  if (f.classId) filters.push({ classes: { some: { classId: f.classId } } });
  if (f.subjectId) filters.push({ subjects: { some: { subjectId: f.subjectId } } });
  if (f.language && ["EN", "SW", "OTHER"].includes(f.language)) filters.push({ language: f.language });
  if (f.type && mimes[f.type]) filters.push({ files: { some: { isCurrent: true, mimeType: { in: mimes[f.type]! } } } });
  const where: Prisma.LibraryResourceWhereInput = { schoolId, AND: [visibilityWhere(viewer, now), ...filters] };
  const settings = await getLibrarySettings(db, schoolId);
  const order: Prisma.LibraryResourceOrderByWithRelationInput[] = f.sort === "title" ? [{ title: "asc" }] : [{ publishedAt: "desc" }, { createdAt: "desc" }];
  const [rows, total] = await Promise.all([
    db.libraryResource.findMany({ where, orderBy: order, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: cardInclude }),
    db.libraryResource.count({ where }),
  ]);
  return { items: rows.map((r) => card(r, viewer, locale, settings.allowIdOnly, now)), total, page, pageSize: PAGE_SIZE };
}

/** The library landing page: what is new, featured and popular (from real use), and the ways to browse. */
export async function libraryHome(schoolId: string, viewer: Viewer, locale: "EN" | "SW") {
  const now = new Date();
  const visible = visibilityWhere(viewer, now);
  const base: Prisma.LibraryResourceWhereInput = { schoolId, AND: [visible] };
  const settings = await getLibrarySettings(db, schoolId);
  await ensureLibraryCategories(db, schoolId);
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [featured, recent, categories, catCounts, classes, classCounts, subjects, subjectCounts, usage, total] = await Promise.all([
    db.libraryResource.findMany({ where: { ...base, featured: true }, orderBy: { publishedAt: "desc" }, take: 4, include: cardInclude }),
    db.libraryResource.findMany({ where: base, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 8, include: cardInclude }),
    db.libraryCategory.findMany({ where: { schoolId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.libraryResource.groupBy({ by: ["categoryId"], where: base, _count: true }),
    db.schoolClass.findMany({ where: { schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }], select: { id: true, name: true, nameSw: true } }),
    db.libraryResourceClass.groupBy({ by: ["classId"], where: { resource: base }, _count: true }),
    db.subject.findMany({ where: { schoolId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, nameSw: true } }),
    db.libraryResourceSubject.groupBy({ by: ["subjectId"], where: { resource: base }, _count: true }),
    db.libraryEvent.groupBy({ by: ["resourceId"], where: { schoolId, outcome: "GRANTED", createdAt: { gte: since } }, _count: true, orderBy: { _count: { resourceId: "desc" } }, take: 30 }),
    db.libraryResource.count({ where: base }),
  ]);
  // Popular: the most used resources of the last 90 days that this viewer may see. Nothing is shown when there is no real use yet.
  const popularRows = usage.length ? await db.libraryResource.findMany({ where: { ...base, id: { in: usage.map((u) => u.resourceId) } }, include: cardInclude }) : [];
  const popular = usage.map((u) => popularRows.find((r) => r.id === u.resourceId)).filter((r): r is CardRow => !!r).slice(0, 4);
  const nm = (x: { name: string; nameSw: string | null }) => (locale === "SW" && x.nameSw ? x.nameSw : x.name);
  const count = (list: { _count: number }[], key: string, id: string) => (list as unknown as Record<string, unknown>[]).find((c) => c[key] === id) as { _count: number } | undefined;
  return {
    total,
    featured: featured.map((r) => card(r, viewer, locale, settings.allowIdOnly, now)),
    recent: recent.map((r) => card(r, viewer, locale, settings.allowIdOnly, now)),
    popular: popular.map((r) => card(r, viewer, locale, settings.allowIdOnly, now)),
    categories: categories.map((c) => ({ id: c.id, name: nm(c), count: count(catCounts, "categoryId", c.id)?._count ?? 0 })),
    classes: classes.map((c) => ({ id: c.id, name: nm(c), count: count(classCounts, "classId", c.id)?._count ?? 0 })),
    subjects: subjects.map((s) => ({ id: s.id, name: nm(s), count: count(subjectCounts, "subjectId", s.id)?._count ?? 0 })).filter((s) => s.count > 0),
  };
}

/** One resource as the viewer may see it: its details and whether they can open it. Anything they may not discover does not exist for them. */
export async function getLibraryResource(schoolId: string, viewer: Viewer, id: string, locale: "EN" | "SW") {
  const now = new Date();
  const r = await db.libraryResource.findFirst({ where: { id, schoolId, AND: [visibilityWhere(viewer, now)] }, include: cardInclude });
  if (!r) throw notFound("Resource");
  const settings = await getLibrarySettings(db, schoolId);
  return { ...card(r, viewer, locale, settings.allowIdOnly, now), copyright: r.copyright, idOnly: r.idOnly && settings.allowIdOnly };
}

// ───────────────────────── Opening a file ─────────────────────────

export type OpenResult =
  | { ok: true; file: { id: string; storageKey: string; fileName: string; mimeType: string; sizeBytes: number }; resourceId: string; preview: boolean }
  | { ok: false; reason: "NOT_FOUND" | "UNAVAILABLE" | "VERIFY" | "PIN_NEEDED" | "NOT_FOR_YOU" };

/**
 * Decides, for this request, whether the viewer may open the resource's file, and records the outcome. A school account that manages or owns
 * the resource may preview it in any stage (not counted as use). Everyone else goes through `canAccess`. Only granted openings of published
 * resources count towards the statistics; refusals are logged apart and never counted.
 */
export async function openLibraryFile(a: { viewer: Viewer; viewerSchoolId: string | null; account: AuthContext | null; resourceId: string; kind: "VIEW" | "DOWNLOAD"; version?: number }): Promise<OpenResult> {
  const r = await db.libraryResource.findUnique({ where: { id: a.resourceId }, include: { classes: true, subjects: true, staff: true, files: { orderBy: { version: "desc" } } } });
  if (!r) return { ok: false, reason: "NOT_FOUND" };
  const acc = a.account && a.account.schoolId === r.schoolId ? a.account : null;
  const preview = !!acc && (acc.permissions.has("library.manage") || acc.permissions.has("library.review") || acc.permissions.has("library.publish") || (acc.permissions.has("library.upload") && r.createdById === acc.userId));
  const viewer: Viewer = a.viewerSchoolId && a.viewerSchoolId !== r.schoolId ? { kind: "VISITOR" } : a.viewer;
  const file = a.version && preview ? r.files.find((f) => f.version === a.version) : r.files.find((f) => f.isCurrent);
  if (!file) return { ok: false, reason: "UNAVAILABLE" };
  const settings = await getLibrarySettings(db, r.schoolId);
  const decision: Decision = preview ? { ok: true } : canAccess(viewer, ruleOf(r), { now: new Date(), allowIdOnly: settings.allowIdOnly });
  const person = viewer.kind === "STUDENT" ? "STUDENT" : viewer.kind === "STAFF" || acc ? "STAFF" : viewer.kind === "GUARDIAN" ? "GUARDIAN" : "VISITOR";
  const identified = viewer.kind === "STUDENT" || viewer.kind === "STAFF";
  const who = { studentId: viewer.kind === "STUDENT" ? viewer.studentId : undefined, staffId: viewer.kind === "STAFF" ? viewer.staffId : undefined };
  const record = (outcome: "GRANTED" | "DENIED", reason?: string) =>
    db.libraryEvent.create({ data: { schoolId: r.schoolId, resourceId: r.id, fileId: file.id, kind: a.kind, outcome, person, ...who, reason } });
  if (!decision.ok) {
    if (identified) await record("DENIED", decision.reason).catch(() => undefined); // bounded: only identified people are logged
    return { ok: false, reason: decision.reason };
  }
  if (r.status === "PUBLISHED" && !preview) await record("GRANTED"); // a staff preview is never counted as use
  return { ok: true, file: { id: file.id, storageKey: file.storageKey, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes }, resourceId: r.id, preview };
}

/** The cover picture of a resource, only for someone who may discover the resource. */
export async function openCover(a: { viewer: Viewer; viewerSchoolId: string | null; account: AuthContext | null; resourceId: string }) {
  const r = await db.libraryResource.findUnique({ where: { id: a.resourceId }, include: { classes: true, subjects: true, staff: true } });
  if (!r?.coverKey || !r.coverMime) return null;
  const acc = a.account && a.account.schoolId === r.schoolId && (a.account.permissions.has("library.manage") || a.account.permissions.has("library.review") || a.account.permissions.has("library.publish") || a.account.userId === r.createdById);
  const viewer: Viewer = a.viewerSchoolId && a.viewerSchoolId !== r.schoolId ? { kind: "VISITOR" } : a.viewer;
  if (!acc && !canDiscover(viewer, ruleOf(r), new Date())) return null;
  return { storageKey: r.coverKey, mime: r.coverMime };
}

// ───────────────────────── Statistics and activity ─────────────────────────

/** Library numbers for authorised staff. Only granted openings count; nothing here names a student. */
export async function libraryAnalytics(ctx: AuthContext, days = 30) {
  requireAnyPermission(ctx, ["library.analytics", "library.manage"]);
  const since = new Date(Date.now() - days * 86_400_000);
  const sid = ctx.schoolId;
  const published = { schoolId: sid, status: "PUBLISHED" as const };
  const [totalPublished, byStatus, byCategory, byClass, bySubject, recent, awaiting, noFile, downloads, views, top, categories, classes, subjects] = await Promise.all([
    db.libraryResource.count({ where: published }),
    db.libraryResource.groupBy({ by: ["status"], where: { schoolId: sid }, _count: true }),
    db.libraryResource.groupBy({ by: ["categoryId"], where: published, _count: true }),
    db.libraryResourceClass.groupBy({ by: ["classId"], where: { resource: published }, _count: true }),
    db.libraryResourceSubject.groupBy({ by: ["subjectId"], where: { resource: published }, _count: true }),
    db.libraryResource.findMany({ where: { schoolId: sid }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, title: true, status: true, createdAt: true } }),
    db.libraryResource.findMany({ where: { schoolId: sid, status: "PENDING_REVIEW" }, orderBy: { submittedAt: "asc" }, select: { id: true, title: true, submittedAt: true } }),
    db.libraryResource.count({ where: { schoolId: sid, status: { not: "ARCHIVED" }, files: { none: { isCurrent: true } } } }),
    db.libraryEvent.count({ where: { schoolId: sid, outcome: "GRANTED", kind: "DOWNLOAD", createdAt: { gte: since } } }),
    db.libraryEvent.count({ where: { schoolId: sid, outcome: "GRANTED", kind: "VIEW", createdAt: { gte: since } } }),
    db.libraryEvent.groupBy({ by: ["resourceId"], where: { schoolId: sid, outcome: "GRANTED", createdAt: { gte: since } }, _count: true, orderBy: { _count: { resourceId: "desc" } }, take: 10 }),
    db.libraryCategory.findMany({ where: { schoolId: sid }, select: { id: true, name: true } }),
    db.schoolClass.findMany({ where: { schoolId: sid }, select: { id: true, name: true } }),
    db.subject.findMany({ where: { schoolId: sid }, select: { id: true, name: true } }),
  ]);
  const topTitles = top.length ? await db.libraryResource.findMany({ where: { schoolId: sid, id: { in: top.map((t) => t.resourceId) } }, select: { id: true, title: true } }) : [];
  const named = <K extends string>(rows: Record<string, unknown>[], key: K, names: { id: string; name: string }[]) => rows.map((r) => ({ name: names.find((n) => n.id === r[key])?.name ?? "—", count: (r as { _count: number })._count })).sort((a, b) => b.count - a.count);
  return {
    days, totalPublished, awaiting, noFile, downloads, views, recent,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    byCategory: named(byCategory as never, "categoryId", categories), byClass: named(byClass as never, "classId", classes), bySubject: named(bySubject as never, "subjectId", subjects),
    top: top.map((t) => ({ id: t.resourceId, title: topTitles.find((x) => x.id === t.resourceId)?.title ?? "—", count: t._count })),
  };
}

/** The detailed activity log (who opened what). Only for people the school trusts with it. */
export async function libraryActivity(ctx: AuthContext, page = 1) {
  requirePermission(ctx, "library.audit");
  const pageSize = 50;
  const where = { schoolId: ctx.schoolId };
  const [events, total] = await Promise.all([db.libraryEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (Math.max(1, page) - 1) * pageSize, take: pageSize, include: { resource: { select: { title: true } } } }), db.libraryEvent.count({ where })]);
  const [students, staff] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(events.flatMap((e) => (e.studentId ? [e.studentId] : [])))] } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
    db.staff.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(events.flatMap((e) => (e.staffId ? [e.staffId] : [])))] } }, select: { id: true, staffNo: true, user: { select: { fullName: true } } } }),
  ]);
  return {
    total, page, pageSize,
    items: events.map((e) => {
      const s = students.find((x) => x.id === e.studentId);
      const t = staff.find((x) => x.id === e.staffId);
      return { id: e.id, at: e.createdAt, kind: e.kind, outcome: e.outcome, reason: e.reason, person: e.person, title: e.resource.title, who: s ? `${s.firstName} ${s.lastName} (${s.admissionNo})` : t ? `${t.user.fullName}${t.staffNo ? ` (${t.staffNo})` : ""}` : null };
    }),
  };
}

/** The choices for the search filters (names only; nothing here depends on who is looking). */
export async function libraryFacets(schoolId: string, locale: "EN" | "SW") {
  await ensureLibraryCategories(db, schoolId);
  const [categories, classes, subjects] = await Promise.all([
    db.libraryCategory.findMany({ where: { schoolId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, nameSw: true } }),
    db.schoolClass.findMany({ where: { schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }], select: { id: true, name: true, nameSw: true } }),
    db.subject.findMany({ where: { schoolId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, nameSw: true } }),
  ]);
  const nm = (x: { name: string; nameSw: string | null }) => (locale === "SW" && x.nameSw ? x.nameSw : x.name);
  return { categories: categories.map((c) => ({ id: c.id, name: nm(c) })), classes: classes.map((c) => ({ id: c.id, name: nm(c) })), subjects: subjects.map((c) => ({ id: c.id, name: nm(c) })) };
}

/** The choices on the resource form: categories, classes, subjects, years and staff (for restricted resources). */
export async function libraryFormOptions(ctx: AuthContext) {
  requireAnyPermission(ctx, ["library.upload", "library.manage", "library.publish"]);
  await ensureLibraryCategories(db, ctx.schoolId);
  const [categories, classes, subjects, years, staff] = await Promise.all([
    db.libraryCategory.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }], select: { id: true, name: true } }),
    db.subject.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.academicYear.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { startsOn: "desc" }, select: { id: true, name: true } }),
    db.staff.findMany({ where: { schoolId: ctx.schoolId, user: { status: "ACTIVE" } }, orderBy: { user: { fullName: "asc" } }, select: { id: true, staffNo: true, user: { select: { fullName: true } } } }),
  ]);
  return { categories, classes, subjects, years, staff: staff.map((s) => ({ id: s.id, name: s.user.fullName, staffNo: s.staffNo })) };
}
