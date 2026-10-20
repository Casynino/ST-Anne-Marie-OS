import { execSync } from "node:child_process";

export default function setup() {
  try {
    process.loadEnvFile();
  } catch {
    /* env provided by the shell/CI */
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) throw new Error("TEST_DATABASE_URL must point to a *_test database.");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
