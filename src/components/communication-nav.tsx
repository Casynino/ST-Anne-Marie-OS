import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import type { Translate } from "@/lib/i18n";

export function CommunicationNav({ ctx, t, current, attention = 0 }: { ctx: AuthContext; t: Translate; current: string; attention?: number }) {
  const has = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const items = [
    { href: "/communication", label: t("comm.nav.notices"), show: has("comms.read") },
    { href: "/communication/messages", label: t("comm.nav.messages"), show: has("messages.read") || has("messages.moderate"), badge: attention },
    { href: "/communication/templates", label: t("comm.nav.templates"), show: has("comms.manage") },
    { href: "/notifications", label: t("comm.nav.alerts"), show: has("notification.read") },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return (
    <nav aria-label={t("comm.title")} className="no-print -mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 whitespace-nowrap">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={current === i.href ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${current === i.href ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface text-ink hover:bg-canvas"}`}>
              {i.label}
              {"badge" in i && i.badge ? <span className="rounded-full bg-warn px-1.5 text-xs font-semibold text-white">{i.badge}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
