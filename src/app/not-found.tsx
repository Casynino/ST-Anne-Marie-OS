import Link from "next/link";
import { getT } from "@/lib/auth/next";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream px-4">
      <div className="max-w-md text-center">
        <p className="display text-8xl text-brand-300">404</p>
        <h1 className="display mt-2 text-3xl text-brand-950">{t("notfound.title")}</h1>
        <p className="mt-3 text-muted">{t("notfound.body")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="inline-flex min-h-12 items-center rounded-full bg-brand-700 px-6 font-semibold text-white hover:bg-brand-800">{t("site.nav.home")}</Link>
          <Link href="/contact" className="inline-flex min-h-12 items-center rounded-full border-2 border-brand-700 px-6 font-semibold text-brand-800 hover:bg-brand-700 hover:text-white">{t("site.nav.contact")}</Link>
        </div>
      </div>
    </main>
  );
}
