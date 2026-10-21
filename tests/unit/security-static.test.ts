import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Guard rails that read the source, so a new route or action cannot quietly skip authentication.
 * They are blunt on purpose: a failure means "look at this file", not "the code is wrong".
 */
const ROOT = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p: string) => path.relative(ROOT, p);

describe("every API route authenticates", () => {
  // A cookie session, the library viewer (a school account or a verified school ID; a visitor can only ever get public material), the cron bearer secret, or (webhooks) a signature checked by the service.
  const MARKERS = ["getContext(", "requireContext(", "getLibraryViewer(", "CRON_SECRET", "processProviderEvent(", "processSmsReport("];
  const routes = walk(path.join(ROOT, "src/app/api")).filter((f) => f.endsWith("route.ts"));
  it("finds the routes", () => expect(routes.length).toBeGreaterThan(10));
  for (const f of routes) {
    it(rel(f), () => {
      const src = readFileSync(f, "utf8");
      expect(MARKERS.some((m) => src.includes(m)), `${rel(f)} has no authentication marker`).toBe(true);
    });
  }
});

describe("every server action goes through run()", () => {
  // Sign-in/out and the password change handle their own session logic and are reviewed by hand.
  const ALLOWED = new Set(["loginAction", "signOutAction", "changePasswordAction", "setLocaleAction"]); // setLocaleAction only sets a language cookie, also for signed-out visitors
  const files = walk(path.join(ROOT, "src/app")).filter((f) => /actions(-shared)?\.ts$/.test(f));
  it("finds the action files", () => expect(files.length).toBeGreaterThan(10));
  for (const f of files) {
    it(rel(f), () => {
      const src = readFileSync(f, "utf8");
      const parts = src.split(/\nexport async function /).slice(1);
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("("));
        if (ALLOWED.has(name)) continue;
        expect(/\b(run|publicRun)\(/.test(part), `${rel(f)}: ${name} does not use run()/publicRun()`).toBe(true);
      }
    });
  }
});

describe("configuration and secrets", () => {
  it("sends a strict Content-Security-Policy in production and the other security headers always", () => {
    const cfg = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    for (const h of ["frame-ancestors 'none'", "object-src 'none'", "default-src 'self'", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) expect(cfg).toContain(h);
    expect(cfg).toMatch(/NODE_ENV === "production"/);
  });

  it("the session cookie is HttpOnly, SameSite and Secure in production", () => {
    const src = readFileSync(path.join(ROOT, "src/app/login/actions.ts"), "utf8");
    expect(src).toContain("httpOnly: true");
    expect(src).toContain('sameSite: "lax"');
    expect(src).toMatch(/secure: process\.env\.NODE_ENV === "production"/);
  });

  it("no database password, token or key is committed", () => {
    const files = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(files.some((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example"))).toBe(false);
    const bad: string[] = [];
    for (const f of files) {
      if (/\.(png|jpe?g|webp|ico|pdf|woff2?|dump)$/i.test(f) || f.startsWith("src/generated/") || f === "package-lock.json" || f === "tests/unit/security-static.test.ts" || f === "tests/unit/backup.test.ts") continue; // the latter holds a made-up connection string as a parsing fixture
      let text: string;
      try { text = readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
      if (/postgres(ql)?:\/\/[^\s:@/"']+:[^\s@/"']{6,}@/.test(text) || /npg_[A-Za-z0-9]{10,}/.test(text) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) || /\bAKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}\b/.test(text)) bad.push(f);
    }
    expect(bad, `possible secret in: ${bad.join(", ")}`).toEqual([]);
  });
});
