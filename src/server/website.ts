import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import type { Locale } from "@/lib/i18n";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { checkbox, dateOnly, optDateOnly, optText, parse, text } from "@/lib/validation";
import siteMedia from "@/lib/site-media.json";

/**
 * Public website content. Everything shown to the public comes from the database (admin-edited content,
 * the real class structure, published news and events). Nothing is invented: empty fields simply hide
 * their section, and imagery only appears when the school supplies a file.
 */

// ───────────────────────── Public school lookup ─────────────────────────

/** Single-school deployment: the public site serves PUBLIC_SCHOOL_CODE (default SAM), else the first school. */
export async function getPublicSchool() {
  const code = process.env.PUBLIC_SCHOOL_CODE ?? "SAM";
  const school = (await db.school.findUnique({ where: { code } })) ?? (await db.school.findFirst({ orderBy: { createdAt: "asc" } }));
  return school;
}

// ───────────────────────── Content settings ─────────────────────────

const SETTING_KEY = "website";

type LocalText = { heroTitle?: string; heroSubtitle?: string; about?: string; admissionsIntro?: string; requirements?: string; faqs?: string; feesNote?: string };
export type WebsiteSettings = {
  en: LocalText;
  sw: LocalText;
  applicationsOpen: boolean;
  phone?: string;
  phone2?: string;
  email?: string;
  address?: string;
  hours?: string;
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
  /** Path of a file the school placed under /public (e.g. /site/logo.png). */
  logoPath?: string;
  heroImagePath?: string;
  aboutImagePath?: string;
  /** Approved photos the school placed under /public (path + optional caption). */
  gallery?: { path: string; caption?: string }[];
};

const EMPTY: WebsiteSettings = { en: {}, sw: {}, applicationsOpen: false };

const safePath = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[A-Za-z0-9_\-./]+\.(png|jpe?g|webp|svg)$/i, "Use a file path such as /site/logo.png")
  .refine((v) => !v.includes(".."), "Invalid path");
const optPath = () => z.preprocess((v) => (v === "" || v === null ? undefined : v), safePath.optional());
const safeUrl = z.string().trim().max(200).refine((v) => /^https:\/\/[^\s]+$/.test(v), "Must start with https://");
const optUrl = () => z.preprocess((v) => (v === "" || v === null ? undefined : v), safeUrl.optional());

const settingsSchema = z.object({
  en_heroTitle: optText(120),
  en_heroSubtitle: optText(240),
  en_about: optText(3000),
  en_admissionsIntro: optText(1500),
  en_requirements: optText(2000),
  en_faqs: optText(5000),
  en_feesNote: optText(1500),
  sw_heroTitle: optText(120),
  sw_heroSubtitle: optText(240),
  sw_about: optText(3000),
  sw_admissionsIntro: optText(1500),
  sw_requirements: optText(2000),
  sw_faqs: optText(5000),
  sw_feesNote: optText(1500),
  applicationsOpen: checkbox(),
  phone: optText(40),
  phone2: optText(40),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().email("Enter a valid email address").max(200).optional()),
  address: optText(300),
  hours: optText(200),
  facebook: optUrl(),
  instagram: optUrl(),
  whatsapp: optText(40),
  logoPath: optPath(),
  heroImagePath: optPath(),
  aboutImagePath: optPath(),
  gallery: optText(3000),
});

/** One image per line: "/site/photo.jpg | optional caption". Max 8; every path is validated like the other image paths. */
export function parseGallery(raw?: string): { path: string; caption?: string }[] {
  const out: { path: string; caption?: string }[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const [pathPart, ...rest] = line.split("|");
    const path = safePath.safeParse((pathPart ?? "").trim());
    if (!path.success) continue;
    const caption = rest.join("|").trim().slice(0, 140);
    out.push({ path: path.data, ...(caption ? { caption } : {}) });
  }
  return out.slice(0, 8);
}

const LOCAL_FIELDS = ["heroTitle", "heroSubtitle", "about", "admissionsIntro", "requirements", "faqs", "feesNote"] as const;

export async function loadWebsiteSettings(schoolId: string): Promise<WebsiteSettings> {
  const row = await db.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: SETTING_KEY } } });
  return { ...EMPTY, ...((row?.value ?? {}) as Partial<WebsiteSettings>) };
}

export async function getWebsiteSettings(ctx: AuthContext) {
  requirePermission(ctx, "website.manage");
  return loadWebsiteSettings(ctx.schoolId);
}

export async function updateWebsiteSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "website.manage");
  const d = parse(settingsSchema, input);
  const next: WebsiteSettings = { en: {}, sw: {}, applicationsOpen: d.applicationsOpen };
  for (const lang of ["en", "sw"] as const) for (const f of LOCAL_FIELDS) {
    const v = d[`${lang}_${f}` as keyof typeof d] as string | undefined;
    if (v) next[lang][f] = v;
  }
  const gallery = parseGallery(d.gallery);
  if (gallery.length) next.gallery = gallery;
  for (const f of ["phone", "phone2", "email", "address", "hours", "facebook", "instagram", "whatsapp", "logoPath", "heroImagePath", "aboutImagePath"] as const) {
    const v = d[f];
    if (v) next[f] = v;
  }
  const before = await loadWebsiteSettings(ctx.schoolId);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({
      where: { schoolId_key: { schoolId: ctx.schoolId, key: SETTING_KEY } },
      create: { schoolId: ctx.schoolId, key: SETTING_KEY, value: next as object, updatedById: ctx.userId },
      update: { value: next as object, updatedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: "website.settings_update",
      entityType: "SchoolSetting",
      entityId: SETTING_KEY,
      changes: { applicationsOpen: [before.applicationsOpen, next.applicationsOpen] },
    });
  });
}

// ───────────────────────── Public content (render-ready) ─────────────────────────

export type Faq = { q: string; a: string };

/** Splits "Question\nAnswer…" blocks separated by a blank line. */
export function parseFaqs(raw?: string): Faq[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim().split(/\r?\n/))
    .filter((lines) => lines.length >= 2 && lines[0]!.trim())
    .map((lines) => ({ q: lines[0]!.trim(), a: lines.slice(1).join("\n").trim() }));
}

export const parseLines = (raw?: string): string[] => (raw ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

export async function getPublicSite(locale: Locale) {
  const school = await getPublicSchool();
  if (!school) return null;
  const s = await loadWebsiteSettings(school.id);
  const pick = (f: (typeof LOCAL_FIELDS)[number]) => (locale === "SW" ? s.sw[f] || s.en[f] : s.en[f] || s.sw[f]) || undefined;
  const levels = await db.academicLevel.findMany({
    where: { schoolId: school.id, classes: { some: { isActive: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameSw: true, classes: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, nameSw: true } } },
  });
  // Images dropped into public/site are picked up automatically; paths typed in Website settings take priority.
  const media = siteMedia as { logo?: string; hero?: string; about?: string; gallery?: { path: string; caption?: string }[] };
  const settings: WebsiteSettings = { ...s, logoPath: s.logoPath ?? media.logo, heroImagePath: s.heroImagePath ?? media.hero, aboutImagePath: s.aboutImagePath ?? media.about };
  return {
    school: { id: school.id, name: school.name, motto: school.motto, timezone: school.timezone, email: school.email, phone: school.phone, address: school.address },
    settings,
    text: {
      heroTitle: pick("heroTitle") ?? school.name,
      heroSubtitle: pick("heroSubtitle") ?? school.motto ?? undefined,
      about: pick("about"),
      admissionsIntro: pick("admissionsIntro"),
      requirements: parseLines(pick("requirements")),
      faqs: parseFaqs(pick("faqs")),
      feesNote: pick("feesNote"),
    },
    contact: {
      phone: s.phone ?? school.phone ?? undefined,
      phone2: s.phone2,
      email: s.email ?? school.email ?? undefined,
      address: s.address ?? school.address ?? undefined,
      hours: s.hours,
      whatsapp: s.whatsapp,
    },
    gallery: s.gallery?.length ? s.gallery : (media.gallery ?? []),
    levels: levels.map((l) => ({ id: l.id, name: locale === "SW" && l.nameSw ? l.nameSw : l.name, classes: l.classes.map((c) => (locale === "SW" && c.nameSw ? c.nameSw : c.name)) })),
  };
}

// ───────────────────────── News ─────────────────────────

const newsSchema = z.object({ title: text(160), titleSw: optText(160), body: text(8000), bodySw: optText(8000), isPublic: checkbox() });

export async function listNews(ctx: AuthContext) {
  requirePermission(ctx, "website.manage");
  return db.announcement.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function getNews(ctx: AuthContext, id: string) {
  requirePermission(ctx, "website.manage");
  const row = await db.announcement.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!row) throw notFound("News post");
  return row;
}

export async function createNews(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "website.manage");
  const d = parse(newsSchema, input);
  return db.$transaction(async (tx) => {
    const row = await tx.announcement.create({ data: { ...d, schoolId: ctx.schoolId, createdById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "news.create", entityType: "Announcement", entityId: row.id, summary: row.title });
    return row;
  });
}

export async function updateNews(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "website.manage");
  const d = parse(newsSchema, input);
  await getNews(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.announcement.update({ where: { id }, data: { title: d.title, titleSw: d.titleSw ?? null, body: d.body, bodySw: d.bodySw ?? null, isPublic: d.isPublic } });
    await writeAudit(tx, actorOf(ctx), { action: "news.update", entityType: "Announcement", entityId: id, summary: d.title });
  });
}

/** Publishing is explicit and audited; unpublishing returns the post to draft. */
export async function setNewsPublished(ctx: AuthContext, id: string, published: boolean) {
  requirePermission(ctx, "website.manage");
  const row = await getNews(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.announcement.update({ where: { id }, data: { publishedAt: published ? (row.publishedAt ?? new Date()) : null } });
    await writeAudit(tx, actorOf(ctx), { action: published ? "news.publish" : "news.unpublish", entityType: "Announcement", entityId: id, summary: row.title });
  });
}

export async function deleteNews(ctx: AuthContext, id: string) {
  requirePermission(ctx, "website.manage");
  const row = await getNews(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.announcement.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "news.delete", entityType: "Announcement", entityId: id, summary: row.title });
  });
}

const publicNewsWhere = (schoolId: string) => ({ schoolId, isPublic: true, publishedAt: { not: null, lte: new Date() } });

export async function listPublicNews(schoolId: string, opts: { limit?: number; page?: number } = {}) {
  const limit = opts.limit ?? 9;
  const page = Math.max(1, opts.page ?? 1);
  const [items, total] = await Promise.all([
    db.announcement.findMany({ where: publicNewsWhere(schoolId), orderBy: { publishedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    db.announcement.count({ where: publicNewsWhere(schoolId) }),
  ]);
  return { items, total, page, pageSize: limit };
}

export async function getPublicNews(schoolId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return db.announcement.findFirst({ where: { id, ...publicNewsWhere(schoolId) } });
}

// ───────────────────────── Events ─────────────────────────

const eventSchema = z
  .object({ title: text(160), titleSw: optText(160), description: optText(2000), descriptionSw: optText(2000), location: optText(160), startsOn: dateOnly(), endsOn: optDateOnly(), isPublic: checkbox() })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { path: ["endsOn"], message: "End date cannot be before the start date" });

export async function listEvents(ctx: AuthContext) {
  requirePermission(ctx, "website.manage");
  return db.schoolEvent.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { startsOn: "desc" }, take: 200 });
}

export async function getEvent(ctx: AuthContext, id: string) {
  requirePermission(ctx, "website.manage");
  const row = await db.schoolEvent.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!row) throw notFound("Event");
  return row;
}

export async function createEvent(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "website.manage");
  const d = parse(eventSchema, input);
  return db.$transaction(async (tx) => {
    const row = await tx.schoolEvent.create({ data: { ...d, schoolId: ctx.schoolId, createdById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "event.create", entityType: "SchoolEvent", entityId: row.id, summary: `${row.title} (${formatDateOnly(row.startsOn)})` });
    return row;
  });
}

export async function updateEvent(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "website.manage");
  const d = parse(eventSchema, input);
  await getEvent(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.schoolEvent.update({
      where: { id },
      data: { title: d.title, titleSw: d.titleSw ?? null, description: d.description ?? null, descriptionSw: d.descriptionSw ?? null, location: d.location ?? null, startsOn: d.startsOn, endsOn: d.endsOn ?? null, isPublic: d.isPublic },
    });
    await writeAudit(tx, actorOf(ctx), { action: "event.update", entityType: "SchoolEvent", entityId: id, summary: d.title });
  });
}

export async function deleteEvent(ctx: AuthContext, id: string) {
  requirePermission(ctx, "website.manage");
  const row = await getEvent(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.schoolEvent.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "event.delete", entityType: "SchoolEvent", entityId: id, summary: row.title });
  });
}

/** Public events from today (school timezone) onwards. */
export async function listPublicEvents(schoolId: string, timezone: string, opts: { limit?: number } = {}) {
  const today = parseDateOnly(todayInTimezone(timezone)) as Date;
  return db.schoolEvent.findMany({
    where: { schoolId, isPublic: true, OR: [{ startsOn: { gte: today } }, { endsOn: { gte: today } }] },
    orderBy: { startsOn: "asc" },
    take: opts.limit ?? 50,
  });
}
