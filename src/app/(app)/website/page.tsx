import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import * as web from "@/server/website";
import { displayDate, formatDateOnly } from "@/lib/dates";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import * as A from "./actions";

export const metadata: Metadata = { title: "Website" };
type Ctx = Awaited<ReturnType<typeof requireContext>>;
const TABS = ["content", "news", "events"] as const;

export default async function WebsitePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("website.manage")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "content";
  const labels = { content: t("website.content"), news: t("website.news"), events: t("website.events") };
  return (
    <>
      <PageHeader title={t("website.title")} subtitle={t("website.intro")} actions={<LinkButton href="/" variant="secondary"><ExternalLink className="size-4" aria-hidden /> {t("website.view")}</LinkButton>} />
      <nav aria-label="Website sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <Link key={k} href={`/website?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>{labels[k]}</Link>
        ))}
      </nav>
      {tab === "content" && <ContentTab ctx={ctx} />}
      {tab === "news" && <NewsTab ctx={ctx} />}
      {tab === "events" && <EventsTab ctx={ctx} />}
    </>
  );
}

async function ContentTab({ ctx }: { ctx: Ctx }) {
  const t = await getT();
  const s = await web.getWebsiteSettings(ctx);
  const lang = (code: "en" | "sw") => (
    <Card title={t(`website.lang.${code}`)} className="space-y-0">
      <div className="space-y-3">
        <Field name={`${code}_heroTitle`} label={t("website.heroTitle")} hint={t("website.heroTitle.hint")} defaultValue={s[code].heroTitle} />
        <Field name={`${code}_heroSubtitle`} label={t("website.heroSubtitle")} defaultValue={s[code].heroSubtitle} />
        <Field name={`${code}_about`} label={t("website.about")} type="textarea" rows={5} defaultValue={s[code].about} />
        <Field name={`${code}_admissionsIntro`} label={t("website.admissionsIntro")} type="textarea" rows={3} defaultValue={s[code].admissionsIntro} />
        <Field name={`${code}_requirements`} label={t("website.requirements")} type="textarea" rows={5} defaultValue={s[code].requirements} />
        <Field name={`${code}_feesNote`} label={t("website.feesNote")} type="textarea" rows={3} defaultValue={s[code].feesNote} />
        <Field name={`${code}_faqs`} label={t("website.faqs")} hint={t("website.faqs.hint")} type="textarea" rows={7} defaultValue={s[code].faqs} />
      </div>
    </Card>
  );
  return (
    <ActionForm action={A.saveContentAction} submitLabel={t("common.save")} className="space-y-5">
      <Card>
        <Field name="applicationsOpen" type="checkbox" label={t("website.applicationsOpen")} hint={t("website.applicationsOpen.hint")} defaultValue={s.applicationsOpen} />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">{lang("en")}{lang("sw")}</div>
      <Card title={t("website.contact")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="phone" label={t("website.phone")} type="tel" defaultValue={s.phone} />
          <Field name="phone2" label={t("website.phone2")} type="tel" defaultValue={s.phone2} />
          <Field name="whatsapp" label={t("website.whatsapp")} type="tel" defaultValue={s.whatsapp} />
          <Field name="email" label={t("common.email")} type="email" defaultValue={s.email} />
          <Field name="address" label={t("common.address")} defaultValue={s.address} className="sm:col-span-2" />
          <Field name="hours" label={t("website.hours")} defaultValue={s.hours} className="sm:col-span-2" />
        </div>
      </Card>
      <Card title={t("website.social")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="facebook" label={t("website.facebook")} placeholder="https://" defaultValue={s.facebook} />
          <Field name="instagram" label={t("website.instagram")} placeholder="https://" defaultValue={s.instagram} />
        </div>
      </Card>
      <Card title={t("website.images")}>
        <p className="mb-3 text-sm text-muted">{t("website.images.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="logoPath" label={t("website.logoPath")} placeholder="/site/logo.png" defaultValue={s.logoPath} />
          <Field name="heroImagePath" label={t("website.heroImagePath")} placeholder="/site/hero.jpg" defaultValue={s.heroImagePath} />
          <Field name="aboutImagePath" label={t("website.aboutImagePath")} placeholder="/site/about.jpg" defaultValue={s.aboutImagePath} />
        </div>
        <Field name="gallery" label={t("website.gallery")} hint={t("website.gallery.hint")} type="textarea" rows={5} placeholder={"/site/classroom.jpg | Optional caption"} defaultValue={(s.gallery ?? []).map((g) => (g.caption ? `${g.path} | ${g.caption}` : g.path)).join("\n")} className="mt-3" />
      </Card>
    </ActionForm>
  );
}

async function NewsTab({ ctx }: { ctx: Ctx }) {
  const t = await getT();
  const locale = await getLocale();
  const posts = await web.listNews(ctx);
  const fields = (p?: (typeof posts)[number]) => (
    <>
      <Field name="title" label={t("common.name")} defaultValue={p?.title} required />
      <Field name="body" label={t("website.news.body")} type="textarea" rows={6} defaultValue={p?.body} required />
      <Field name="titleSw" label={t("website.news.titleSw")} defaultValue={p?.titleSw} optionalLabel={t("common.optional")} />
      <Field name="bodySw" label={t("website.news.bodySw")} type="textarea" rows={6} defaultValue={p?.bodySw} optionalLabel={t("common.optional")} />
      <Field name="isPublic" type="checkbox" label={t("website.news.public")} defaultValue={p ? p.isPublic : true} />
    </>
  );
  return (
    <div className="space-y-5">
      <Card title={t("website.news.new")}>
        <ActionForm action={A.createNewsAction} submitLabel={t("common.create")}>{fields()}</ActionForm>
      </Card>
      {posts.length === 0 && <EmptyState>{t("website.news.none")}</EmptyState>}
      {posts.map((p) => (
        <Card key={p.id} title={p.title} actions={<div className="flex gap-2">{p.publishedAt ? <Badge tone="ok">{t("website.news.live")}</Badge> : <Badge>{t("website.news.draft")}</Badge>}{!p.isPublic && <Badge tone="warn">{t("website.news.internal")}</Badge>}</div>}>
          <p className="text-xs text-muted">{p.publishedAt ? displayDate(p.publishedAt, locale) : displayDate(p.createdAt, locale)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionForm action={A.publishNewsAction} submitLabel={p.publishedAt ? t("website.news.unpublish") : t("website.news.publish")} inline className="inline">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="published" value={p.publishedAt ? "false" : "true"} />
            </ActionForm>
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
  const events = await web.listEvents(ctx);
  const today = new Date().toISOString().slice(0, 10);
  const fields = (e?: (typeof events)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="title" label={t("common.name")} defaultValue={e?.title} required />
      <Field name="titleSw" label={t("website.news.titleSw")} defaultValue={e?.titleSw} optionalLabel={t("common.optional")} />
      <Field name="startsOn" label={t("website.events.starts")} type="date" defaultValue={e ? formatDateOnly(e.startsOn) : undefined} required />
      <Field name="endsOn" label={t("website.events.ends")} type="date" defaultValue={e?.endsOn ? formatDateOnly(e.endsOn) : undefined} />
      <Field name="location" label={t("website.events.location")} defaultValue={e?.location} optionalLabel={t("common.optional")} className="sm:col-span-2" />
      <Field name="description" label={t("website.events.description")} type="textarea" defaultValue={e?.description} optionalLabel={t("common.optional")} />
      <Field name="descriptionSw" label={t("website.events.descriptionSw")} type="textarea" defaultValue={e?.descriptionSw} optionalLabel={t("common.optional")} />
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
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-brand-700">{t("common.edit")}</summary>
              <ActionForm action={A.updateEventAction} submitLabel={t("common.save")} className="mt-2 space-y-3"><input type="hidden" name="id" value={e.id} />{fields(e)}</ActionForm>
            </details>
            <ActionForm action={A.deleteEventAction} submitLabel={t("common.delete")} inline tone="danger" confirm={t("common.confirmAction")} className="mt-2"><input type="hidden" name="id" value={e.id} /></ActionForm>
          </Card>
        );
      })}
    </div>
  );
}
