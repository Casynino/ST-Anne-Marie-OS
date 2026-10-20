import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// Content-Security-Policy (production only: the development server needs eval for hot reload). Everything the site loads comes from its
// own origin; inline scripts and styles are allowed because Next.js streams its page data inline, but nothing may be loaded from
// another site, the page cannot be framed, and plug-ins are off.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Lets a second server (e.g. a smoke-test copy on another database) run beside the main dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    // Only the school's own images (bundled under /site, uploaded under /media) may be optimised.
    localPatterns: [{ pathname: "/site/**" }, { pathname: "/media/**" }],
    deviceSizes: [360, 480, 640, 828, 1080, 1280, 1600, 1920],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  serverExternalPackages: ["pg"],
  // Document uploads (default limit 4 MB, see DOCUMENT_MAX_BYTES) and CSV imports go through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [{ source: "/:path*", headers: process.env.NODE_ENV === "production" ? [...securityHeaders, { key: "Content-Security-Policy", value: csp }] : securityHeaders }];
  },
};

export default nextConfig;
