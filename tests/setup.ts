// Safety: tests only ever run against TEST_DATABASE_URL, and only if it looks like a test database.
try {
  process.loadEnvFile();
} catch {
  /* env provided by the shell/CI */
}
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required to run tests.");
if (!/_test(\?|$)/.test(url)) throw new Error("Refusing to run tests: TEST_DATABASE_URL must point to a database whose name ends in _test.");
process.env.DATABASE_URL = url;
