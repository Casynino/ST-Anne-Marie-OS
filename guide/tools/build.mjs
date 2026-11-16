import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
const G = "/Users/Nino/Desktop/Clients /3-Devs/ST-Anne-OS/guide";
const css = fs.readFileSync(`${G}/parts/style.css`, "utf8");
let body = ["01-front", "02-ch1-3", "03-owner-admissions", "04-academic-finance", "05-head-teachers-family", "06-public-security-setup-ref"].map((n) => fs.readFileSync(`${G}/parts/${n}.html`, "utf8")).join("\n");
// drop any figure whose picture does not exist (never a broken image in the book)
let dropped = 0;
body = body.replace(/<figure class="shot[^"]*">\s*<img src="(shots\/[^"]+)"[\s\S]*?<\/figure>/g, (m, src) => { if (fs.existsSync(`${G}/${src}`)) return m; dropped++; console.log("dropped", src); return ""; });
const TITLES = ["The system at a glance","Getting started","How the departments connect","The Owner","Admissions Office","Academic Office","Finance Office","Head Teacher","Teachers","Parents and students","The public website and online application","Security, privacy and accountability","Setting up the school and going live","Quick reference"];
const mk = (pages) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>St Anne Marie Schools: The Complete System Guide</title><meta name="author" content="Emmanuel Paul Marcel"><style>${css}</style></head><body>${body.replace(/<span class="pg" data-ch="(\d+)"><\/span>/g, (m, n) => `<span class="pg">${pages[Number(n) - 1] ?? ""}</span>`)}</body></html>`;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--allow-file-access-from-files"] });
async function render(pages) {
  fs.writeFileSync(`${G}/guide.html`, mk(pages));
  const p = await b.newPage();
  await p.goto(`file://${G}/guide.html`, { waitUntil: "networkidle0", timeout: 180000 });
  await p.pdf({ path: `${G}/St-Anne-Marie-Schools-System-Guide.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true, outline: true, tagged: true, timeout: 300000 });
  await p.close();
}
await render([]);
const total = Number(execSync(`pdfinfo "${G}/St-Anne-Marie-Schools-System-Guide.pdf" | grep Pages | awk '{print $2}'`).toString());
const SUBS = ["One system for the whole school, with one job for each","Signing in, finding your way, and using the system on a phone","Who does what, who sees what, and how work travels from one","Overseeing the whole school without doing the departments","From the first enquiry to a registered student, and the return","The school year, the timetable, exams and results, report cards","Fees, invoices, payments, receipts, expenses, refunds and reports","Oversight of the teachers' work and the second approval","Attendance, marks, homework, lesson plans and behaviour for your","The family portal: what families see and what they can do","What visitors and applicants see, and how it connects","How the school's data, money and children's information","A practical checklist, in the order it should be done","Common questions, key words, and a one-page cheat sheet"];
const text = [];
for (let n = 1; n <= total; n++) text[n] = execSync(`pdftotext -f ${n} -l ${n} "${G}/St-Anne-Marie-Schools-System-Guide.pdf" -`, { maxBuffer: 1e8 }).toString().replace(/\s+/g, " ");
const pages = SUBS.map((sub) => { for (let n = 3; n <= total; n++) if (text[n].includes(sub)) return n; return ""; });
console.log("chapter pages:", pages.join(","));
await render(pages);
await b.close();
console.log("built; pages:", total, "dropped figures:", dropped);
