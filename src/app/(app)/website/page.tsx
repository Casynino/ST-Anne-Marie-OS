import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import * as web from "@/server/website";
import { listMedia } from "@/server/media";
import { displayDate, formatDateOnly } from "@/lib/dates";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n";
import siteMedia from "@/lib/site-media.json";
import * as A from "./actions";

export const metadata: Metadata = { title: "Website" };
type Ctx = Awaited<ReturnType<typeof requireContext>>;
const TABS = ["content", "news", "events", "media"] as const;

type Opt = { value: string; label: string };
async function imageOptions(ctx: Ctx): Promise<Opt[]> {
  const uploaded = await listMedia(ctx);
  const bundled = siteMedia as unknown as { logo?: { path: string }; og?: { path: string }; about?: { path: string }; hero: { path: string }[]; gallery: { path: string }[] };
  const files = [bundled.logo, bundled.og, bundled.about, ...bundled.hero, ...bundled.gallery].filter((x): x is { path: string } => !!x).map((x) => x.path);
  return [...uploaded.map((m) => ({ value: `/media/${m.id}`, label: `${m.fileName} — ${m.alt}` })), ...files.map((p) => ({ value: p, label: p }))];
}
const withCurrent = (opts: Opt[], current?: string | null) => (current && !opts.some((o) => o.value === current) ? [{ value: current, label: current }, ...opts] : opts);

export default async function WebsitePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("website.manage")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "content";
  return (
    <>
      <PageHeader title={t("website.title")} subtitle={t("website.intro")} actions={<LinkButton href="/" variant="secondary"><ExternalLink className="size-4" aria-hidden /> {t("website.view")}</LinkButton>} />
      <nav aria-label="Website sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <Link key={k} href={`/website?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>{t(`website.tab.${k}`)}</Link>
        ))}
      </nav>
      {tab === "content" && <ContentTab ctx={ctx} />}
      {tab === "news" && <NewsTab ctx={ctx} />}
      {tab === "events" && <EventsTab ctx={ctx} />}
      {tab === "media" && <MediaTab ctx={ctx} />}
    </>
  );
}

const GROUPS: { title: MessageKey; fields: { key: web.LocalKey; hint?: MessageKey; rows?: number }[] }[] = [
  { title: "website.group.home", fields: [{ key: "heroTitle", hint: "website.heroTitle.hint", rows: 2 }, { key: "heroSubtitle", rows: 2 }, { key: "strengths", hint: "website.pairs.hint", rows: 5 }] },
  { title: "website.group.about", fields: [{ key: "about", rows: 6 }, { key: "vision", rows: 3 }, { key: "mission", rows: 3 }, { key: "philosophy", rows: 4 }, { key: "values", hint: "website.pairs.hint", rows: 5 }, { key: "history", rows: 5 }, { key: "leadership", hint: "website.leadership.hint", rows: 4 }] },
  { title: "website.group.academics", fields: [{ key: "programs", hint: "website.programs.hint", rows: 6 }, { key: "learningApproach", rows: 4 }, { key: "curriculum", rows: 4 }, { key: "academicSupport", rows: 3 }, { key: "examinations", rows: 3 }] },
  { title: "website.group.life", fields: [{ key: "schoolLife", hint: "website.pairs.hint", rows: 6 }, { key: "parentCommunity", rows: 4 }] },
  { title: "website.group.admissions", fields: [{ key: "admissionsIntro", rows: 3 }, { key: "requirements", hint: "website.lines.hint", rows: 5 }, { key: "feesNote", rows: 4 }, { key: "faqs", hint: "website.faqs.hint", rows: 8 }] },
];

async function ContentTab({ ctx }: { ctx: Ctx }) {
  const t = await getT();
  const s = await web.getWebsiteSettings(ctx);
  const base = await imageOptions(ctx);
  const none = t("website.noImage");
  const img = (name: string, label: MessageKey, current?: string) => <Field key={name} name={name} label={t(label)} type="select" options={withCurrent(base, current)} placeholder={none} defaultValue={current} />;
  return (
    <ActionForm action={A.saveContentAction} submitLabel={t("common.save")} className="space-y-5">
      <Card><Field name="applicationsOpen" type="checkbox" label={t("website.applicationsOpen")} hint={t("website.applicationsOpen.hint")} defaultValue={s.applicationsOpen} /></Card>

      {GROUPS.map((g, gi) => (
        <details key={g.title} open={gi === 0} className="rounded-xl border border-line bg-white">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between px-4 text-base font-semibold">{t(g.title)}</summary>
          <div className="space-y-6 border-t border-line p-4">
            <div className="hidden grid-cols-2 gap-4 text-xs font-bold uppercase tracking-wider text-muted sm:grid"><span>{t("website.lang.en")}</span><span>{t("website.lang.sw")}</span></div>
            {g.fields.map((f) => (
              <fieldset key={f.key}>
                <legend className="mb-1 text-sm font-semibold">{t(`website.f.${f.key}` as MessageKey)}</legend>
                {f.hint && <p className="mb-2 text-sm text-muted">{t(f.hint)}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field name={`en_${f.key}`} label={`${t(`website.f.${f.key}` as MessageKey)} (EN)`} type="textarea" rows={f.rows ?? 3} defaultValue={s.en[f.key]} />
                  <Field name={`sw_${f.key}`} label={`${t(`website.f.${f.key}` as MessageKey)} (SW)`} type="textarea" rows={f.rows ?? 3} defaultValue={s.sw[f.key]} />
                </div>
              </fieldset>
            ))}
          </div>
        </details>
      ))}

      <Card title={t("website.contact")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="phone" label={t("website.phone")} type="tel" defaultValue={s.phone} />
          <Field name="phone2" label={t("website.phone2")} type="tel" defaultValue={s.phone2} />
          <Field name="whatsapp" label={t("website.whatsapp")} type="tel" defaultValue={s.whatsapp} />
          <Field name="email" label={t("common.email")} type="email" defaultValue={s.email} />
          <Field name="address" label={t("common.address")} defaultValue={s.address} className="sm:col-span-2" />
          <Field name="hours" label={t("website.hours")} defaultValue={s.hours} className="sm:col-span-2" />
          <Field name="mapUrl" label={t("website.mapUrl")} hint={t("website.mapUrl.hint")} placeholder="https://" defaultValue={s.mapUrl} className="sm:col-span-2" />
        </div>
      </Card>
      <Card title={t("website.social")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="facebook" label="Facebook" placeholder="https://" defaultValue={s.facebook} />
          <Field name="instagram" label="Instagram" placeholder="https://" defaultValue={s.instagram} />
          <Field name="youtube" label="YouTube" placeholder="https://" defaultValue={s.youtube} />
        </div>
      </Card>
      <Card title={t("website.images")}>
        <p className="mb-3 text-sm text-muted">{t("website.images.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {img("logoPath", "website.logoPath", s.logoPath)}
          {img("heroImagePath", "website.heroImagePath", s.heroImagePath)}
          {img("heroImage2Path", "website.heroImage2Path", s.heroImage2Path)}
          {img("heroImage3Path", "website.heroImage3Path", s.heroImage3Path)}
          {img("aboutImagePath", "website.aboutImagePath", s.aboutImagePath)}
          {img("ogImagePath", "website.ogImagePath", s.ogImagePath)}
        </div>
        <Field name="gallery" label={t("website.gallery")} hint={t("website.gallery.hint")} type="textarea" rows={6} placeholder={"/media/… | Optional caption"} defaultValue={(s.gallery ?? []).map((g) => (g.caption ? `${g.path} | ${g.caption}` : g.path)).join("\n")} className="mt-4" />
      </Card>
    </ActionForm>
  );
}

async function NewsTab({ ctx }: { ctx: Ctx }) {
  const t = await getT();
  const locale = await getLocale();
  const [posts, base] = await Promise.all([web.listNews(ctx), imageOptions(ctx)]);
  const fields = (p?: (typeof posts)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="title" label={t("website.news.title")} defaultValue={p?.title} required />
      <Field name="titleSw" label={t("website.news.titleSw")} defaultValue={p?.titleSw} optionalLabel={t("common.optional")} />
      <Field name="category" label={t("website.news.category")} defaultValue={p?.category} placeholder="News, Admissions, Sports…" optionalLabel={t("common.optional")} />
      <Field name="coverImage" label={t("website.news.cover")} type="select" options={withCurrent(base, p?.coverImage)} placeholder={t("website.noImage")} defaultValue={p?.coverImage} />
      <Field name="excerpt" label={t("website.news.excerpt")} hint={t("website.news.excerpt.hint")} defaultValue={p?.excerpt} optionalLabel={t("common.optional")} className="sm:col-span-2" />
      <Field name="body" label={t("website.news.body")} type="textarea" rows={7} defaultValue={p?.body} required />
      <Field name="bodySw" label={t("website.news.bodySw")} type="textarea" rows={7} defaultValue={p?.bodySw} optionalLabel={t("common.optional")} />
      <Field name="isPublic" type="checkbox" label={t("website.news.public")} defaultValue={p ? p.isPublic : true} />
      <div>
        <Field name="showInBar" type="checkbox" label={t("website.news.showInBar")} defaultValue={p?.showInBar} />
        <Field name="barLink" label={t("website.news.barLink")} hint={t("website.news.barLink.hint")} defaultValue={p?.barLink} optionalLabel={t("common.optional")} />
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <Card title={t("website.news.new")}><ActionForm action={A.createNewsAction} submitLabel={t("common.create")}>{fields()}</ActionForm></Card>
      {posts.length === 0 && <EmptyState>{t("website.news.none")}</EmptyState>}
      {posts.map((p) => (
        <Card key={p.id} title={p.title} actions={<div className="flex flex-wrap gap-2">{p.publishedAt ? <Badge tone="ok">{t("website.news.live")}</Badge> : <Badge>{t("website.news.draft")}</Badge>}{!p.isPublic && <Badge tone="warn">{t("website.news.internal")}</Badge>}{p.showInBar && <Badge tone="brand">{t("website.news.inBar")}</Badge>}</div>}>
          <p className="text-xs text-muted">{p.category ? `${p.category} · ` : ""}{p.publishedAt ? displayDate(p.publishedAt, locale) : displayDate(p.createdAt, locale)}{p.slug ? ` · /news/${p.slug}` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionForm action={A.publishNewsAction} submitLabel={p.publishedAt ? t("website.news.unpublish") : t("website.news.publish")} inline className="inline"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="published" value={p.publishedAt ? "false" : "true"} /></ActionForm>
            {!p.publishedAt && <ActionForm action={A.deleteNewsAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("common.confirmAction")} className="inline"><input type="hidden" name="id" value={p.id} /></ActionForm>}
          </div>
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-brand-700">{t("common.edit")}</summary>
            <ActionForm action={A.updateNewsAction} submitLabel={t("common.save")} className="mt-2 space-y-3"><input type="hidden" name="id" value={p.id} />{fields(p)}</ActionForm>
          </details>
        </Card>
      ))}
    </div>
  );
}

async function EventsTab({ ctx }: { ctx: Ctx }) {
  const t = await getT();
  const locale = await getLocale();
  const [events, base] = await Promise.all([web.listEvents(ctx), imageOptions(ctx)]);
  const today = new Date().toISOString().slice(0, 10);
  const fields = (e?: (typeof events)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="title" label={t("website.news.title")} defaultValue={e?.title} required />
      <Field name="titleSw" label={t("website.news.titleSw")} defaultValue={e?.titleSw} optionalLabel={t("common.optional")} />
      <Field name="startsOn" label={t("website.events.starts")} type="date" defaultValue={e ? formatDateOnly(e.startsOn) : undefined} required />
      <Field name="endsOn" label={t("website.events.ends")} type="date" defaultValue={e?.endsOn ? formatDateOnly(e.endsOn) : undefined} />
      <Field name="location" label={t("website.events.location")} defaultValue={e?.location} optionalLabel={t("common.optional")} />
      <Field name="category" label={t("website.news.category")} defaultValue={e?.category} optionalLabel={t("common.optional")} />
      <Field name="coverImage" label={t("website.news.cover")} type="select" options={withCurrent(base, e?.coverImage)} placeholder={t("website.noImage")} defaultValue={e?.coverImage} className="sm:col-span-2" />
      <Field name="description" label={t("website.events.description")} type="textarea" rows={4} defaultValue={e?.description} optionalLabel={t("common.optional")} />
      <Field name="descriptionSw" label={t("website.events.descriptionSw")} type="textarea" rows={4} defaultValue={e?.descriptionSw} optionalLabel={t("common.optional")} />
      <Field name="isPublic" type="checkbox" label={t("website.news.public")} defaultValue={e ? e.isPublic : true} className="sm:col-span-2" />
    </div>
  );
  return (
    <div className="space-y-5">
      <Card title={t("website.events.new")}><ActionForm action={A.createEventAction} submitLabel={t("common.create")}>{fields()}</ActionForm></Card>
      {events.length === 0 && <EmptyState>{t("website.events.none")}</EmptyState>}
      {events.map((e) => {
        const past = formatDateOnly(e.endsOn ?? e.startsOn) < today;
        return (
          <Card key={e.id} title={e.title} actions={<div className="flex gap-2">{past && <Badge>{t("website.events.past")}</Badge>}{!e.isPublic && <Badge tone="warn">{t("website.news.internal")}</Badge>}</div>}>
            <p className="text-sm text-muted">{displayDate(e.startsOn, locale)}{e.endsOn ? ` – ${displayDate(e.endsOn, locale)}` : ""}{e.location ? ` · ${e.location}` : ""}</p>
            <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-brand-700">{t("common.edit")}</summary>
              <ActionForm action={A.updateEventAction} submitLabel={t("common.save")} className="mt-2 space-y-3"><input type="hidden" name="id" value={e.id} />{fields(e)}</ActionForm></details>
            <ActionForm action={A.deleteEventAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("common.confirmAction")} className="mt-2"><input type="hidden" name="id" value={e.id} /></ActionForm>
          </Card>
        );
      })}
    </div>
  );
}

async function MediaTab({ ctx }: { ctx: Ctx }) {
  const t = await getT();
  const items = await listMedia(ctx);
  return (
    <div className="space-y-5">
      <Card title={t("website.media.upload")}>
        <p className="mb-3 text-sm text-muted">{t("website.media.hint")}</p>
        <ActionForm action={A.uploadMediaAction} submitLabel={t("website.media.uploadButton")} className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <div>
            <label htmlFor="media-file" className="mb-1 block text-sm font-medium">{t("website.media.file")}</label>
            <input id="media-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required className="block w-full min-h-11 rounded-lg border border-line bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:font-medium file:text-brand-800" />
          </div>
          <Field name="alt" label={t("website.media.alt")} hint={t("website.media.alt.hint")} required />
        </ActionForm>
      </Card>
      {items.length === 0 ? <EmptyState>{t("website.media.none")}</EmptyState> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-xl border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/media/${m.id}`} alt={m.alt} width={m.width} height={m.height} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              <div className="space-y-1 p-3 text-sm">
                <p className="font-medium">{m.fileName}</p>
                <p className="text-muted">{m.alt}</p>
                <p className="text-xs text-muted">{m.width}×{m.height} · {Math.round(m.sizeBytes / 1024)} KB</p>
                <code className="block select-all break-all rounded bg-canvas px-2 py-1 text-xs">/media/{m.id}</code>
                <ActionForm action={A.deleteMediaAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("common.confirmAction")} className="pt-1"><input type="hidden" name="id" value={m.id} /></ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
