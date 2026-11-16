import Link from "next/link";
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { getLibraryViewer } from "@/lib/library/next";
import { PageHero } from "@/components/site/blocks";
import { VerifyForm } from "@/components/library/parts";
import { ActionForm } from "@/components/form";
import { leaveLibraryAction } from "../actions";

export const metadata: Metadata = { title: "School member verification" };

/** The entry point for school members: students and teachers prove who they are once, then browse and open what is theirs. */
export default async function LibraryVerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [t, site, sp, lv] = await Promise.all([getT(), getSite(), searchParams, getLibraryViewer()]);
  if (!site) return null;
  const next = typeof sp.next === "string" && /^\/library(\/[A-Za-z0-9\-_/?=&%.]*)?$/.test(sp.next) && !sp.next.includes("//") ? sp.next : "/library";
  return (
    <>
      <PageHero photo={false} eyebrow={t("lib.kicker")} title={t("lib.verify.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/library", label: t("lib.title") }, { href: "/library/verify", label: t("lib.verify.title") }]}>{t("lib.verify.lead")}</PageHero>
      <div className="mx-auto grid max-w-[100rem] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2">
        <div className="max-w-lg">
          {lv.source === "visitor" ? <VerifyForm t={t} next={next} /> : <div className="space-y-4 border border-line bg-surface p-5"><p>{t("lib.verify.already")} <Link href={next} className="font-semibold text-link underline underline-offset-4">{t("lib.verify.continue")}</Link></p><ActionForm action={leaveLibraryAction} submitLabel={t("lib.leave")} inline /></div>}
        </div>
        <div className="space-y-4 text-muted">
          <p className="flex gap-3"><ShieldCheck className="mt-1 size-5 shrink-0 text-link" aria-hidden /><span>{t("lib.verify.why")}</span></p>
          <p>{t("lib.verify.students")}</p>
          <p>{t("lib.verify.staff")}</p>
        </div>
      </div>
    </>
  );
}
