import { cache } from "react";
import { getLocale } from "@/lib/auth/next";
import { getPublicSite } from "@/server/website";

/** Public site data for the current visitor's language; one query per request. */
export const getSite = cache(async () => getPublicSite(await getLocale()));

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export const waHref = (phone: string) => `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
