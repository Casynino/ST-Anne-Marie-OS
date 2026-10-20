import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/academic-setup", "/enquiries", "/api/", "/login", "/change-password", "/students", "/admissions", "/attendance", "/users", "/roles", "/settings", "/audit", "/website", "/apply/received", "/apply/track"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
