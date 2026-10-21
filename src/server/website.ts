import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import type { Locale } from "@/lib/i18n";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { daysBetween, termWeek } from "@/lib/calendar-grid";
import { isImageRef, mediaIdOf, slugify } from "@/lib/images";
import { actorOf, writeAudit } from "@/server/audit";
import { mediaDimensions } from "@/server/media";
import { checkbox, dateOnly, optDateOnly, optText, parse, text } from "@/lib/validation";
import siteMedia from "@/lib/site-media.json";

/**
 * Public website content. Everything shown to the public comes from the database (admin-edited content, the real
 * class structure, published news and events) or from image files the school supplied. Nothing is invented:
 * empty fields simply hide their section.
 */

// ───────────────────────── Public school lookup ─────────────────────────

/** Single-school deployment: the public site serves PUBLIC_SCHOOL_CODE (default SAM), else the first school. */
export async function getPublicSchool() {
  const code = process.env.PUBLIC_SCHOOL_CODE ?? "SAM";
  return (await db.school.findUnique({ where: { code } })) ?? (await db.school.findFirst({ orderBy: { createdAt: "asc" } }));
}

// ───────────────────────── Settings model ─────────────────────────

const SETTING_KEY = "website";

/** Per-language text fields and their maximum lengths. One table drives the type, the validation and the admin form. */
export const LOCAL_TEXT = {
  heroTitle: 120, heroSubtitle: 240, about: 3000, vision: 600, mission: 900, philosophy: 1500, learningApproach: 1500,
  values: 2000, strengths: 3000, programs: 4000, schoolLife: 3000, academicSupport: 1500, curriculum: 1500, examinations: 1500,
  history: 3000, leadership: 2000, admissionsIntro: 1500, requirements: 2000, faqs: 5000, feesNote: 1500, parentCommunity: 1500,
  facilities: 2000, safeguarding: 2000, uniform: 1500, transport: 1500, meals: 1500, health: 1500, clubs: 3000,
} as const;
export type LocalKey = keyof typeof LOCAL_TEXT;
export const LOCAL_KEYS = Object.keys(LOCAL_TEXT) as LocalKey[];
type LocalText = Partial<Record<LocalKey, string>>;

const SHARED_TEXT = ["phone", "phone2", "email", "address", "hours", "whatsapp"] as const;
const SHARED_URLS = ["facebook", "instagram", "youtube", "mapUrl"] as const;
const SHARED_IMAGES = ["logoPath", "heroImagePath", "heroImage2Path", "heroImage3Path", "aboutImagePath", "ogImagePath"] as const;

export type WebsiteSettings = {
  en: LocalText;
  sw: LocalText;
  applicationsOpen: boolean;
  gallery?: { path: string; caption?: string }[];
} & Partial<Record<(typeof SHARED_TEXT)[number] | (typeof SHARED_URLS)[number] | (typeof SHARED_IMAGES)[number], string>>;

const EMPTY: WebsiteSettings = { en: {}, sw: {}, applicationsOpen: false };

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const imageRef = () => z.preprocess(emptyToUndefined, z.string().trim().max(200).refine(isImageRef, "Choose an image from the list, or use a path such as /site/logo.png").optional());
const httpsUrl = () => z.preprocess(emptyToUndefined, z.string().trim().max(300).refine((v) => /^https:\/\/[^\s]+$/.test(v), "Must start with https://").optional());

const localShape = Object.fromEntries(
  (["en", "sw"] as const).flatMap((lang) => LOCAL_KEYS.map((k) => [`${lang}_${k}`, optText(LOCAL_TEXT[k])])),
);
const settingsSchema = z.object({
  ...localShape,
  applicationsOpen: checkbox(),
  phone: optText(40), phone2: optText(40), whatsapp: optText(40), address: optText(300), hours: optText(200),
  email: z.preprocess(emptyToUndefined, z.string().trim().email("Enter a valid email address").max(200).optional()),
  facebook: httpsUrl(), instagram: httpsUrl(), youtube: httpsUrl(), mapUrl: httpsUrl(),
  logoPath: imageRef(), heroImagePath: imageRef(), heroImage2Path: imageRef(), heroImage3Path: imageRef(), aboutImagePath: imageRef(), ogImagePath: imageRef(),
  gallery: optText(3000),
});

/** One image per line: "<image reference> | optional caption". Max 12; every reference is validated. */
export function parseGallery(raw?: string): { path: string; caption?: string }[] {
  const out: { path: string; caption?: string }[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const [refPart, ...rest] = line.split("|");
    const ref = (refPart ?? "").trim();
    if (!isImageRef(ref)) continue;
    const caption = rest.join("|").trim().slice(0, 140);
    out.push({ path: ref, ...(caption ? { caption } : {}) });
  }
  return out.slice(0, 12);
}

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
  const d = parse(settingsSchema, input) as Record<string, unknown>;
  const next: WebsiteSettings = { en: {}, sw: {}, applicationsOpen: d.applicationsOpen === true };
  for (const lang of ["en", "sw"] as const) for (const k of LOCAL_KEYS) {
    const v = d[`${lang}_${k}`];
    if (typeof v === "string" && v) next[lang][k] = v;
  }
  for (const k of [...SHARED_TEXT, ...SHARED_URLS, ...SHARED_IMAGES]) {
    const v = d[k];
    if (typeof v === "string" && v) next[k] = v;
  }
  const gallery = parseGallery(d.gallery as string | undefined);
  if (gallery.length) next.gallery = gallery;
  const before = await loadWebsiteSettings(ctx.schoolId);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({
      where: { schoolId_key: { schoolId: ctx.schoolId, key: SETTING_KEY } },
      create: { schoolId: ctx.schoolId, key: SETTING_KEY, value: next as object, updatedById: ctx.userId },
      update: { value: next as object, updatedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), { action: "website.settings_update", entityType: "SchoolSetting", entityId: SETTING_KEY, changes: { applicationsOpen: [before.applicationsOpen, next.applicationsOpen] } });
  });
}

// ───────────────────────── Parsing helpers for editor-friendly text ─────────────────────────

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

/** "Title | description" per line (values, school life). */
export function parsePairs(raw?: string): { title: string; text: string }[] {
  return parseLines(raw).map((l) => { const [title, ...rest] = l.split("|"); return { title: (title ?? "").trim(), text: rest.join("|").trim() }; }).filter((p) => p.title);
}

/** "Level | summary | learning focus" per line. */
export function parsePrograms(raw?: string): { name: string; summary: string; focus: string }[] {
  return parseLines(raw).map((l) => { const [name, summary, ...rest] = l.split("|"); return { name: (name ?? "").trim(), summary: (summary ?? "").trim(), focus: rest.join("|").trim() }; }).filter((p) => p.name);
}

// ───────────────────────── Images ─────────────────────────

export type SiteImage = { src: string; width: number; height: number; alt: string; caption?: string };
type BundledEntry = { path: string; width: number; height: number; alt?: string; caption?: string };
type BundledMedia = { logo?: BundledEntry; og?: BundledEntry; hero: BundledEntry[]; about?: BundledEntry; gallery: BundledEntry[]; notices?: BundledEntry[] };
const bundled = siteMedia as unknown as BundledMedia;
const bundledByPath = new Map<string, BundledEntry>([bundled.logo, bundled.og, bundled.about, ...bundled.hero, ...bundled.gallery, ...(bundled.notices ?? [])].filter((e): e is BundledEntry => !!e).map((e) => [e.path, e]));

/** Resolves image references (bundled /site/... or uploaded /media/<id>) to sizes and alt text so pages reserve space. */
async function resolveImages(refs: { ref: string; caption?: string; alt?: string }[]): Promise<Map<string, SiteImage>> {
  const ids = refs.map((r) => mediaIdOf(r.ref)).filter((x): x is string => !!x);
  const media = await mediaDimensions(ids);
  const out = new Map<string, SiteImage>();
  for (const r of refs) {
    const id = mediaIdOf(r.ref);
    const m = id ? media.get(id) : undefined;
    const b = bundledByPath.get(r.ref);
    if (id && !m) continue; // deleted asset: skip instead of rendering a broken image
    out.set(r.ref, { src: r.ref, width: m?.width ?? b?.width ?? 1200, height: m?.height ?? b?.height ?? 900, alt: r.alt ?? b?.alt ?? m?.alt ?? "", ...(r.caption ?? b?.caption ? { caption: r.caption ?? b?.caption } : {}) });
  }
  return out;
}

/** Resolves a list of image references (e.g. news covers) in one query. Missing or deleted images are omitted. */
export async function resolveSiteImages(refs: (string | null | undefined)[]): Promise<Map<string, SiteImage>> {
  return resolveImages([...new Set(refs.filter((r): r is string => !!r && isImageRef(r)))].map((ref) => ({ ref })));
}

/** The school logo (website settings or bundled file) for the staff area; undefined when none is set. */
export async function getBrandLogo(schoolId: string): Promise<SiteImage | undefined> {
  const s = await loadWebsiteSettings(schoolId);
  const ref = s.logoPath ?? bundled.logo?.path;
  return ref ? (await resolveImages([{ ref }])).get(ref) : undefined;
}

// ───────────────────────── Public site data ─────────────────────────

export async function getPublicSite(locale: Locale) {
  const school = await getPublicSchool();
  if (!school) return null;
  const s = await loadWebsiteSettings(school.id);
  const pick = (f: LocalKey) => (locale === "SW" ? s.sw[f] || s.en[f] : s.en[f] || s.sw[f]) || undefined;

  const levelRows = await db.academicLevel.findMany({
    where: { schoolId: school.id, classes: { some: { isActive: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, nameSw: true,
      classes: {
        where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { name: true, nameSw: true, subjects: { select: { subject: { select: { name: true, nameSw: true, isActive: true } } } } },
      },
    },
  });
  const programs = parsePrograms(pick("programs"));
  const levels = levelRows.map((l) => {
    const display = locale === "SW" && l.nameSw ? l.nameSw : l.name;
    const p = programs.find((x) => [l.name, l.nameSw ?? ""].some((n) => n && n.toLowerCase() === x.name.toLowerCase()));
    // Subjects actually assigned to this level's classes (real data, de-duplicated).
    const subjects = [...new Set(l.classes.flatMap((c) => c.subjects.filter((x) => x.subject.isActive).map((x) => (locale === "SW" && x.subject.nameSw ? x.subject.nameSw : x.subject.name))))].sort((a, b) => a.localeCompare(b));
    return { id: l.id, name: display, slug: slugify(l.name), classes: l.classes.map((c) => (locale === "SW" && c.nameSw ? c.nameSw : c.name)), subjects, summary: p?.summary || undefined, focus: p?.focus || undefined };
  });

  // Admin-chosen images win; otherwise the school's bundled files (public/site) are used.
  const galleryRefs = (s.gallery?.length ? s.gallery : bundled.gallery.map((g) => ({ path: g.path, caption: g.caption }))).map((g) => ({ ref: g.path, caption: g.caption }));
  const heroRefs = [s.heroImagePath, s.heroImage2Path, s.heroImage3Path].filter((x): x is string => !!x);
  const heroList = heroRefs.length ? heroRefs : bundled.hero.map((h) => h.path);
  const wanted = [
    ...(s.logoPath ?? bundled.logo?.path ? [{ ref: (s.logoPath ?? bundled.logo?.path) as string }] : []),
    ...(s.ogImagePath ?? bundled.og?.path ? [{ ref: (s.ogImagePath ?? bundled.og?.path) as string }] : []),
    ...(s.aboutImagePath ?? bundled.about?.path ? [{ ref: (s.aboutImagePath ?? bundled.about?.path) as string }] : []),
    ...heroList.map((ref) => ({ ref })),
    ...galleryRefs,
  ];
  const images = await resolveImages(wanted);
  const get = (ref?: string) => (ref ? images.get(ref) : undefined);
  const galleryImages = galleryRefs.map((g) => get(g.ref)).filter((x): x is SiteImage => !!x);

  return {
    school: { id: school.id, name: school.name, motto: school.motto, timezone: school.timezone, email: school.email, phone: school.phone, address: school.address },
    settings: s,
    text: {
      heroTitle: pick("heroTitle") ?? school.name,
      heroSubtitle: pick("heroSubtitle") ?? school.motto ?? undefined,
      about: pick("about"), vision: pick("vision"), mission: pick("mission"), philosophy: pick("philosophy"), learningApproach: pick("learningApproach"),
      academicSupport: pick("academicSupport"), curriculum: pick("curriculum"), examinations: pick("examinations"),
      admissionsIntro: pick("admissionsIntro"), feesNote: pick("feesNote"), parentCommunity: pick("parentCommunity"),
      requirements: parseLines(pick("requirements")),
      faqs: parseFaqs(pick("faqs")),
      values: parsePairs(pick("values")),
      strengths: parsePairs(pick("strengths")),
      history: pick("history"),
      leadership: parsePairs(pick("leadership")),
      schoolLife: parsePairs(pick("schoolLife")),
      facilities: pick("facilities"), safeguarding: pick("safeguarding"), uniform: pick("uniform"), transport: pick("transport"), meals: pick("meals"), health: pick("health"),
      clubs: parsePairs(pick("clubs")),
    },
    contact: {
      phone: s.phone ?? school.phone ?? undefined, phone2: s.phone2, email: s.email ?? school.email ?? undefined,
      address: s.address ?? school.address ?? undefined, hours: s.hours, whatsapp: s.whatsapp, mapUrl: s.mapUrl,
    },
    social: { facebook: s.facebook, instagram: s.instagram, youtube: s.youtube },
    levels,
    images: {
      logo: get(s.logoPath ?? bundled.logo?.path),
      og: get(s.ogImagePath ?? bundled.og?.path),
      // About picture: the chosen one, else a later gallery photo (so it differs from the hero's first photos).
      about: get(s.aboutImagePath ?? bundled.about?.path) ?? galleryImages[4] ?? galleryImages[3],
      hero: heroList.map(get).filter((x): x is SiteImage => !!x),
      gallery: galleryImages,
    },
  };
}

export type PublicSite = NonNullable<Awaited<ReturnType<typeof getPublicSite>>>;

// ───────────────────────── Announcements / news ─────────────────────────

const refOrPath = z.preprocess(emptyToUndefined, z.string().trim().max(300).refine((v) => /^https:\/\/[^\s]+$/.test(v) || /^\/[A-Za-z0-9_\-./#?=&]*$/.test(v), "Use https://… or a path starting with /").optional());

const newsSchema = z.object({
  title: text(160), titleSw: optText(160), body: text(8000), bodySw: optText(8000),
  category: optText(40), excerpt: optText(240), coverImage: imageRef(),
  isPublic: checkbox(), showInBar: checkbox(), barLink: refOrPath,
});

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
  const id = randomUUID();
  const slug = `${slugify(d.title) || "post"}-${id.slice(0, 6)}`; // stable for the life of the post
  return db.$transaction(async (tx) => {
    const row = await tx.announcement.create({ data: { ...d, id, slug, schoolId: ctx.schoolId, createdById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "news.create", entityType: "Announcement", entityId: row.id, summary: row.title });
    return row;
  });
}

export async function updateNews(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "website.manage");
  const d = parse(newsSchema, input);
  await getNews(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.announcement.update({
      where: { id },
      data: { title: d.title, titleSw: d.titleSw ?? null, body: d.body, bodySw: d.bodySw ?? null, category: d.category ?? null, excerpt: d.excerpt ?? null, coverImage: d.coverImage ?? null, isPublic: d.isPublic, showInBar: d.showInBar, barLink: d.barLink ?? null },
    });
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

export async function listPublicNews(schoolId: string, opts: { limit?: number; page?: number; category?: string } = {}) {
  const limit = opts.limit ?? 9;
  const page = Math.max(1, opts.page ?? 1);
  const where = { ...publicNewsWhere(schoolId), ...(opts.category ? { category: opts.category } : {}) };
  const [items, total] = await Promise.all([
    db.announcement.findMany({ where, orderBy: { publishedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    db.announcement.count({ where }),
  ]);
  return { items, total, page, pageSize: limit };
}

export async function listNewsCategories(schoolId: string): Promise<string[]> {
  const rows = await db.announcement.findMany({ where: { ...publicNewsWhere(schoolId), category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((r) => r.category as string);
}

/** Public lookup by stable slug, falling back to the id so older links keep working. */
export async function getPublicNews(schoolId: string, slugOrId: string) {
  const isId = /^[0-9a-f-]{36}$/i.test(slugOrId);
  if (!isId && !/^[a-z0-9-]{1,80}$/.test(slugOrId)) return null;
  return db.announcement.findFirst({ where: { ...publicNewsWhere(schoolId), ...(isId ? { id: slugOrId } : { slug: slugOrId }) } });
}

/** The single notice shown in the announcement bar: newest published public post flagged "show in bar". */
export async function getBarAnnouncement(schoolId: string) {
  return db.announcement.findFirst({ where: { ...publicNewsWhere(schoolId), showInBar: true }, orderBy: { publishedAt: "desc" }, select: { id: true, slug: true, title: true, titleSw: true, barLink: true } });
}

/** Plain-text excerpt: the editor's excerpt, else the start of the article. */
export function excerptOf(post: { excerpt: string | null; body: string; bodySw?: string | null }, locale: Locale, max = 170): string {
  const base = post.excerpt || (locale === "SW" && post.bodySw ? post.bodySw : post.body);
  const flat = base.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// ───────────────────────── Events ─────────────────────────

const eventSchema = z
  .object({ title: text(160), titleSw: optText(160), description: optText(2000), descriptionSw: optText(2000), location: optText(160), category: optText(40), coverImage: imageRef(), startsOn: dateOnly(), endsOn: optDateOnly(), isPublic: checkbox() })
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
      data: { title: d.title, titleSw: d.titleSw ?? null, description: d.description ?? null, descriptionSw: d.descriptionSw ?? null, location: d.location ?? null, category: d.category ?? null, coverImage: d.coverImage ?? null, startsOn: d.startsOn, endsOn: d.endsOn ?? null, isPublic: d.isPublic },
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

export async function getPublicEvent(schoolId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return db.schoolEvent.findFirst({ where: { id, schoolId, isPublic: true } });
}

/** Public search: published news and public events whose text contains the words typed (case-insensitive). Nothing private is searched. */
export async function searchPublicSite(schoolId: string, q: string) {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return { news: [], events: [] };
  const like = { contains: term, mode: "insensitive" as const };
  const [news, events] = await Promise.all([
    db.announcement.findMany({ where: { ...publicNewsWhere(schoolId), OR: [{ title: like }, { titleSw: like }, { excerpt: like }, { body: like }, { bodySw: like }, { category: like }] }, orderBy: { publishedAt: "desc" }, take: 10 }),
    db.schoolEvent.findMany({ where: { schoolId, isPublic: true, OR: [{ title: like }, { titleSw: like }, { description: like }, { descriptionSw: like }, { location: like }, { category: like }] }, orderBy: { startsOn: "desc" }, take: 10 }),
  ]);
  return { news, events };
}

/** Where the school year stands today, for the public home page: the term in progress (week and days left) or the next term to start. */
export async function publicTermProgress(schoolId: string, timezone: string) {
  const today = todayInTimezone(timezone);
  const day = parseDateOnly(today) as Date;
  const [current, next] = await Promise.all([
    db.term.findFirst({ where: { schoolId, startsOn: { lte: day }, endsOn: { gte: day } }, include: { academicYear: { select: { name: true } } } }),
    db.term.findFirst({ where: { schoolId, startsOn: { gt: day } }, orderBy: { startsOn: "asc" }, include: { academicYear: { select: { name: true } } } }),
  ]);
  const cur = current && (() => {
    const from = formatDateOnly(current.startsOn), to = formatDateOnly(current.endsOn);
    const totalWeeks = Math.max(1, Math.ceil((daysBetween(from, to) + 1) / 7));
    return { name: current.name, year: current.academicYear.name, startsOn: current.startsOn, endsOn: current.endsOn, week: termWeek(from, to, today) ?? 1, totalWeeks, daysLeft: daysBetween(today, to), pct: Math.min(100, Math.max(0, Math.round(((daysBetween(from, today) + 1) / (daysBetween(from, to) + 1)) * 100))) };
  })();
  return { current: cur ?? null, next: next ? { name: next.name, year: next.academicYear.name, startsOn: next.startsOn } : null };
}
