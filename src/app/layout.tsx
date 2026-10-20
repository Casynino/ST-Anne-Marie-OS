import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/lib/auth/next";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-fraunces" });

export const metadata: Metadata = {
  title: { default: "St Anne Marie Schools", template: "%s · St Anne Marie Schools" },
  description: "School management system",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#028051" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === "SW" ? "sw" : "en"} className={fraunces.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
