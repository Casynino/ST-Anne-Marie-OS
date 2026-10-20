import { defineConfig } from "prisma/config";

// Node 22 can load .env natively; Next.js does the same for the app itself.
try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. CI/Vercel provide real environment variables).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
