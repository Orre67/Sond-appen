/**
 * Röktest mot den publika appen: läser in exempelfilerna via filväljaren, delar profilerna
 * (delningsnyckeln hämtas ur .env.local eller SHARE_KEY i miljön), öppnar länken i
 * telefonstorlek och fotar. Skriver out/vercel-*.png.
 *
 *   node scripts/vercel-smoke.mjs https://sond-appen.vercel.app
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) throw new Error("Ange appens adress, t.ex. https://sond-appen.vercel.app");
const SAMPLES = "C:/Users/oscar/Desktop/filer till claude/sond appen";
const files = [
  `${SAMPLES}/obj/test1.obj`,
  `${SAMPLES}/obj/test1.mtl`,
  `${SAMPLES}/obj/test1.jpg`,
  `${SAMPLES}/hålens startpunkter/2026-10-01-Torphyttan.txt`,
  `${SAMPLES}/sond data dm4/261001-torphyttan-993.dm4`,
  `${SAMPLES}/sond data dm4/261001-torphyttan-995.dm4`,
  `${SAMPLES}/sond data dm4/261001-torphyttan-999.dm4`,
];
const key =
  process.env.SHARE_KEY ??
  (existsSync(".env.local") ? /^SHARE_KEY="?([^"\r\n]+)"?/m.exec(readFileSync(".env.local", "utf8"))?.[1] : undefined);
if (!key) throw new Error("Ingen delningsnyckel: sätt SHARE_KEY eller kör `npx vercel env pull .env.local`.");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"],
  defaultViewport: { width: 1500, height: 950 },
});
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(`error: ${m.text()}`);
});
page.on("dialog", (d) => {
  console.log(`Dialog (${d.type()}): ${d.message()}`);
  if (d.type() === "prompt") void d.accept(key);
  else void d.accept();
});
const t0 = Date.now();
await page.goto(`${base}/`, { waitUntil: "load" });
const input = await page.$("#file-input");
await input.uploadFile(...files);
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length >= 24, { timeout: 180000 });
console.log(`Hålen klara efter ${Date.now() - t0} ms`);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: "out/vercel-1-app.png" });

await page.click("#btn-share");
await page.waitForSelector("#share-result:not(.hidden) a", { timeout: 180000 });
const link = await page.$eval("#share-result a", (a) => a.getAttribute("href"));
console.log(`Delningslänk: ${link}`);

const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 614, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phoneErrs = [];
phone.on("pageerror", (e) => phoneErrs.push(`pageerror: ${e.message}`));
phone.on("console", (m) => {
  if (m.type() === "error") phoneErrs.push(`error: ${m.text()}`);
});
const t1 = Date.now();
await phone.goto(link, { waitUntil: "load" });
await phone.waitForSelector("#view svg, #view .empty", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
console.log(`Telefonsidan: ${await phone.$eval("#title", (e) => e.textContent)} efter ${Date.now() - t1} ms`);
console.log(`Meddelande: ${await phone.$eval("#view", (e) => e.querySelector(".empty")?.textContent ?? "profil visas")}`);
await phone.screenshot({ path: "out/vercel-2-mobil.png" });
await phone.click("#toggle");
await new Promise((r) => setTimeout(r, 800));
await phone.screenshot({ path: "out/vercel-3-framifran.png" });
console.log(errs.length ? `Skrivbord: ${errs.join(" | ")}` : "Skrivbord: inga konsolfel");
console.log(phoneErrs.length ? `Telefon: ${phoneErrs.join(" | ")}` : "Telefon: inga konsolfel");
await browser.close();
