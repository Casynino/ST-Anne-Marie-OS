import puppeteer from "puppeteer-core";
import fs from "node:fs";
const OUT = "/Users/Nino/Desktop/Clients /3-Devs/ST-Anne-OS/guide/shots";
const BASE = "http://localhost:3100";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PW = "StAnne2026";
const log = [];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });

async function newPage(w = 1440, h = 900, mobile = false) {
  const cx = await browser.createBrowserContext(); // a clean session each time, so each department signs in on its own
  const page = await cx.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1.5, isMobile: mobile, hasTouch: mobile });
  return page;
}
const hideDev = (page) => page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast]{display:none!important}" }).catch(() => {});
async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 90000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /log in/i.test(b.textContent))?.click());
  await page.waitForSelector('input[name="identifier"]', { visible: true, timeout: 20000 });
  await page.type('input[name="identifier"]', email);
  await page.type('input[name="password"]', PW);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }).catch(() => {}), page.keyboard.press("Enter")]);
}
async function shot(page, name, path, opts = {}) {
  try {
    let url = path;
    if (typeof path === "object") { // resolve a record link from a list page
      await page.goto(BASE + path.from, { waitUntil: "networkidle2", timeout: 90000 });
      const href = await page.evaluate((re) => [...document.querySelectorAll("main a")].map((a) => a.getAttribute("href")).find((h) => h && new RegExp(re).test(h)), path.re);
      if (!href) { log.push(`NO LINK ${name}`); return; }
      url = href;
    }
    await page.goto(url.startsWith("http") ? url : BASE + url, { waitUntil: "networkidle2", timeout: 90000 });
    await hideDev(page);
    if (opts.click) { await page.evaluate((t) => [...document.querySelectorAll("button,a")].find((b) => new RegExp(t, "i").test(b.textContent))?.click(), opts.click); }
    await new Promise((r) => setTimeout(r, opts.wait ?? 1200));
    if (opts.scroll) await page.evaluate((s) => { const el = typeof s === "string" ? document.querySelector(s) : null; if (el) { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -90); } else if (typeof s === "number") window.scrollTo(0, s); }, opts.scroll);
    await new Promise((r) => setTimeout(r, 700));
    const noAccess = await page.evaluate(() => /no access|not found|could not be found|something went wrong/i.test((document.querySelector("main")?.innerText?.slice(0, 200) ?? "") + " " + (document.body.innerText.includes("Something went wrong") ? "something went wrong" : "")));
    if (noAccess) log.push(`NO ACCESS/404 ${name} ${url}`);
    await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });
    log.push(`ok ${name}`);
  } catch (e) { log.push(`FAIL ${name}: ${String(e.message).slice(0, 80)}`); }
}
async function signOut(page) { await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /sign out/i.test(b.textContent))?.click()); await new Promise((r) => setTimeout(r, 2500)); }

const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
if (!ONLY) {
  const p = await newPage();
  await shot(p, "pub-home", "/", { wait: 2500 });
  await shot(p, "pub-home-2", "/", { scroll: 1000, wait: 2000 });
  await shot(p, "pub-apply", "/apply", { wait: 2000 });
  await shot(p, "pub-applyform", "/apply/form", { wait: 2000 });
  await shot(p, "pub-track", "/apply/track", { wait: 1500 });
  await shot(p, "pub-calendar", "/calendar", { wait: 1500 });
  await shot(p, "entry", "/login", { wait: 3500 });
  await shot(p, "entry-dialog", "/login", { click: "log in", wait: 3500 });
  await p.close();
}

const roles = {
  owner: ["administrator@stannemarie.local", [
    ["own-home", "/dashboard", { wait: 2500 }], ["own-money", "/dashboard", { scroll: "#money", wait: 2500 }], ["own-school", "/dashboard", { scroll: "#school", wait: 2500 }], ["own-dept", "/dashboard", { scroll: "#departments", wait: 2500 }],
    ["own-users", "/users"], ["own-user-new", "/users/new"], ["own-roles", "/roles"], ["own-settings", "/settings"], ["own-approvals", "/settings/approvals"], ["own-audit", "/audit"], ["own-stepin", "/step-in"], ["own-website", "/website"], ["own-system", "/settings/system"], ["own-backups", "/settings/backups"], ["own-tasks", "/tasks"],
  ]],
  admissions: ["admissions@stannemarie.local", [
    ["adm-home", "/dashboard", { wait: 2500 }], ["adm-list", "/admissions", { wait: 2000 }], ["adm-detail", { from: "/admissions", re: "^/admissions/[0-9a-f-]{36}$" }, { wait: 2000 }], ["adm-new", "/admissions/new"],
    ["adm-interviews", "/admissions/interviews"], ["adm-interview", { from: "/admissions/interviews", re: "^/admissions/interviews/[0-9a-f-]{36}$" }], ["adm-registration", "/admissions/registration"],
    ["adm-policy", "/admissions/policy"], ["adm-windows", "/admissions/windows"], ["adm-reports", "/admissions/reports"],
    ["stu-list", "/students"], ["stu-profile", { from: "/students", re: "^/students/[0-9a-f-]{36}$" }, { wait: 2500 }], ["stu-new", "/students/new"], ["stu-import", "/students/import"],
    ["ret-list", "/students/returning", { wait: 2000 }], ["ret-detail", { from: "/students/returning", re: "^/students/returning/[0-9a-f-]{36}$" }, { wait: 2500 }],
    ["par-list", "/guardians"], ["par-detail", { from: "/guardians", re: "^/guardians/[0-9a-f-]{36}$" }, { wait: 2000 }], ["enq", "/enquiries"], ["cal", "/school-calendar"], ["att-view", "/attendance"],
  ]],
  academic: ["academic@stannemarie.local", [
    ["ac-home", "/academic-office", { wait: 2500 }], ["ac-setup", "/academic-setup"], ["ac-ready", "/academic-setup/readiness"], ["ac-timetable", "/timetable"], ["ac-periods", "/timetable/periods"],
    ["ac-exams", "/exams"], ["ac-exam", { from: "/exams", re: "^/exams/[0-9a-f-]{36}$" }, { wait: 2000 }], ["ac-marks", "/marks"], ["ac-sheet", { from: "/marks", re: "^/marks/[0-9a-f-]{36}$" }, { wait: 2500 }], ["ac-results", "/results"], ["ac-grading", "/grading"],
    ["ac-cards", "/report-cards"], ["ac-prog", "/academic-office/progression", { wait: 2000 }], ["ac-prog-detail", { from: "/academic-office/progression", re: "^/academic-office/progression/[0-9a-f-]{36}$" }, { wait: 2500 }],
    ["ac-transfers", "/academic-office/transfers"], ["ac-concerns", "/academic-office/concerns"], ["ac-recruit", "/staff-recruitment"], ["ac-applexams", "/applicant-exams"],
  ]],
  finance: ["finance@stannemarie.local", [
    ["fin-home", "/dashboard", { wait: 2500 }], ["fin-over", "/finance", { wait: 2000 }], ["fin-fees", "/finance/fees"], ["fin-invoices", "/finance/invoices"], ["fin-invoice", { from: "/finance/invoices", re: "^/finance/invoices/[0-9a-f-]{36}$" }, { wait: 2000 }],
    ["fin-paynew", "/finance/payments/new"], ["fin-payments", "/finance/payments"], ["fin-recon", "/finance/reconciliation"], ["fin-expenses", "/finance/expenses"], ["fin-refunds", "/finance/refunds"],
    ["fin-reports", "/finance/reports", { wait: 2500 }], ["fin-annual", "/finance/annual", { wait: 2000 }], ["fin-appfees", "/finance/application-fees"],
  ]],
  head: ["head@stannemarie.local", [
    ["head-home", "/dashboard", { wait: 2500 }], ["head-teachers", "/dashboard", { scroll: 760, wait: 2500 }], ["head-att", "/attendance"], ["head-marks", "/marks"], ["head-plans", "/planning"], ["head-expenses", "/finance/expenses"], ["head-assign", "/assignments"], ["head-comm", "/communication"],
  ]],
  teacher: ["teacher1@stannemarie.local", [
    ["tch-home", "/dashboard", { wait: 2500 }], ["tch-att", "/attendance"], ["tch-marks", "/marks"], ["tch-sheet", { from: "/marks", re: "^/marks/[0-9a-f-]{36}$" }, { wait: 2500 }], ["tch-assign", "/assignments"], ["tch-assign-new", "/assignments/new"], ["tch-plan", "/planning"], ["tch-timetable", "/timetable"], ["tch-behaviour", "/behaviour"], ["tch-students", "/students"], ["tch-messages", "/communication/messages"],
  ]],
  parent: ["parent@stannemarie.local", [
    ["fam-home", "/family", { wait: 2500 }], ["fam-child", { from: "/family", re: "^/family/[0-9a-f-]{36}$" }, { wait: 2500 }], ["fam-fees", { from: "/family", re: "^/family/[0-9a-f-]{36}$", suffix: "/fees" }],
    ["fam-inbox", "/family/inbox"], ["fam-messages", "/family/messages"], ["fam-calendar", "/family/calendar"], ["fam-settings", "/family/settings"],
  ]],
  student: ["student@stannemarie.local", [["stu-home", "/family", { wait: 2500 }]]],
};

for (const [role, [email, list]] of Object.entries(roles)) {
  if (ONLY && !ONLY.includes(role)) continue;
  const p = await newPage();
  try { await login(p, email); } catch (e) { log.push(`LOGIN FAIL ${role}: ${e.message}`); await p.close(); continue; }
  for (const [name, path, opts] of list) {
    if (typeof path === "object" && path.suffix) { // child sub-page: resolve the id then append
      await p.goto(BASE + path.from, { waitUntil: "networkidle2" });
      const href = await p.evaluate((re) => [...document.querySelectorAll("main a")].map((a) => a.getAttribute("href")).find((h) => h && new RegExp(re).test(h)), path.re);
      if (href) await shot(p, name, href + path.suffix, opts); else log.push(`NO LINK ${name}`);
    } else await shot(p, name, path, opts);
  }
  if (role === "owner") {
    // phone view of the owner's home
  }
  await p.close();
}
// phone views
if (!ONLY || ONLY.includes("phones")) {
  const p = await newPage(390, 844, true);
  await login(p, "administrator@stannemarie.local");
  await shot(p, "phone-owner", "/dashboard", { wait: 2500 });
  await shot(p, "phone-owner-2", "/dashboard", { scroll: "#money", wait: 2500 });
  await p.close();
  const q = await newPage(390, 844, true);
  await login(q, "parent@stannemarie.local");
  await shot(q, "phone-parent", "/family", { wait: 2500 });
  await q.close();
  const r = await newPage(820, 1180, true);
  await login(r, "teacher1@stannemarie.local");
  await shot(r, "tablet-teacher", "/dashboard", { wait: 2500 });
  await r.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/_log.txt`, log.join("\n"));
console.log(log.filter((l) => !l.startsWith("ok")).join("\n") || "all ok", "\n", log.filter((l) => l.startsWith("ok")).length, "shots");
