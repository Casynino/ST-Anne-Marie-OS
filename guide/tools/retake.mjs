import puppeteer from "puppeteer-core";
const OUT = "/Users/Nino/Desktop/Clients /3-Devs/ST-Anne-OS/guide/shots";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
async function session(email) {
  const cx = await b.createBrowserContext(); const p = await cx.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await p.goto("http://localhost:3100/login", { waitUntil: "networkidle2" });
  await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /log in/i.test(x.textContent))?.click());
  await p.waitForSelector('input[name="identifier"]', { visible: true });
  await p.type('input[name="identifier"]', email); await p.type('input[name="password"]', "StAnne2026");
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}), p.keyboard.press("Enter")]);
  return p;
}
async function take(p, name, candidates, re) {
  for (const c of candidates) {
    await p.goto("http://localhost:3100" + c, { waitUntil: "networkidle2", timeout: 90000 });
    const href = await p.evaluate((r) => [...document.querySelectorAll("main a")].map((a) => a.getAttribute("href")).find((h) => h && new RegExp(r).test(h)), re);
    if (!href) { console.log("none at", c); continue; }
    await p.goto("http://localhost:3100" + href, { waitUntil: "networkidle2", timeout: 90000 });
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await new Promise((r) => setTimeout(r, 2000));
    await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });
    console.log("ok", name, href); return;
  }
  console.log("FAILED", name);
}
let p = await session("admissions@stannemarie.local");
await take(p, "stu-profile", ["/students?view=all"], "^/students/[0-9a-f-]{36}(\\?.*)?$");
p = await session("academic@stannemarie.local");
await take(p, "ac-sheet", ["/marks?view=all", "/marks?view=queue"], "^/marks/[0-9a-f-]{36}");
await take(p, "ac-prog-detail", ["/academic-office/progression?show=approved", "/academic-office/progression?show=draft", "/academic-office/progression?show=review"], "^/academic-office/progression/[0-9a-f-]{36}");
p = await session("finance@stannemarie.local");
await take(p, "fin-invoice", ["/finance/invoices?status=ISSUED", "/finance/invoices?view=all", "/finance/payments"], "^/finance/(invoices|students)/[0-9a-f-]{36}");
await b.close();
