import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { getT } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Application received", robots: { index: false } };

export default async function ReceivedPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const [t, sp] = await Promise.all([getT(), searchParams]);
  const ref = /^APP\/\d{4}\/\d{4,}$/.test(sp.ref ?? "") ? sp.ref : undefined;
  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-36 text-center sm:px-6 sm:pt-44">
      <CheckCircle2 className="mx-auto size-12 text-ok" aria-hidden />
      <h1 className="display mt-4 text-5xl">{t("apply.received.title")}</h1>
      <p className="mt-3 text-muted">{t("apply.received.body")}</p>
      {ref && (
        <div className="mt-6 border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("apply.received.ref")}</p>
          <p className="display mt-1 select-all text-4xl tracking-wide">{ref}</p>
        </div>
      )}
      <p className="mt-6"><Link href="/apply/track" className="font-semibold text-heading hover:underline">{t("apply.received.track")}</Link></p>
    </div>
  );
}
