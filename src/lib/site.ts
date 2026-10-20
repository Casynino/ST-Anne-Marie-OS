import { cache } from "react";
import type { Metadata } from "next";
import { getLocale } from "@/lib/auth/next";
import { getPublicSite, type PublicSite } from "@/server/website";

/** Public site data for the current visitor's language; one query per request. */
export const getSite = cache(async () => getPublicSite(await getLocale()));

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export const waHref = (phone: string) => `https://wa.me/${phone.replace(/[^\d]/g, "")}`;

export const baseUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Shared page metadata: canonical URL, Open Graph and Twitter cards from the school's real name, text and image. */
export function pageMetadata(site: PublicSite | null, o: { title?: string; description?: string; path: string; image?: string; type?: "website" | "article" }): Metadata {
  const name = site?.school.name ?? "School";
  const url = `${baseUrl()}${o.path}`;
  const image = o.image ?? site?.images.og?.src;
  const description = o.description ?? site?.text.heroSubtitle ?? site?.text.about?.slice(0, 160);
  return {
    title: o.title ? { absolute: `${o.title} · ${name}` } : { absolute: name },
    description,
    alternates: { canonical: url },
    openGraph: { title: o.title ?? name, description, url, siteName: name, type: o.type ?? "website", ...(image ? { images: [{ url: image.startsWith("http") ? image : `${baseUrl()}${image}` }] } : {}) },
    twitter: { card: "summary_large_image", title: o.title ?? name, description },
    robots: { index: true, follow: true },
  };
}

/** schema.org EducationalOrganization built only from verified fields the school has entered. */
export function schoolJsonLd(site: PublicSite) {
  const { school, contact, social, images } = site;
  const sameAs = [social.facebook, social.instagram, social.youtube].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: school.name,
    url: baseUrl(),
    ...(images.logo ? { logo: `${baseUrl()}${images.logo.src}` } : {}),
    ...(contact.phone ? { telephone: contact.phone } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.address ? { address: { "@type": "PostalAddress", streetAddress: contact.address, addressCountry: "TZ" } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}
