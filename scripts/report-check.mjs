/**
 * Kontroll av rapporten: öppnar demoläget i headless Chrome, tar två bilder i 3D-vyn, skapar
 * rapporten och sparar den som out/rapport.pdf, plus skärmdumpar av 3D-fliken och rapportfliken.
 * Kräver att "npm run dev" kör och att out/demo-url.txt finns (skrivs av scripts/screenshot.mjs).
 *
 *   node scripts/report-check.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!CHROME) throw new Error("Hittar varken Chrome eller Edge.");

const url = readFileSync("out/demo-url.txt", "utf8").trim();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"],
  defaultViewport: { width: 1500, height: 950 },
});
const page = await browser.newPage();
const messages = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") messages.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));

const t0 = Date.now();
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length > 0, { timeout: 180000 });
console.log(`Hålen klara efter ${Date.now() - t0} ms`);
// Texturen läses in efteråt; bilder renderade innan dess blir svarta.
await new Promise((r) => setTimeout(r, 3000));

// Två bilder i 3D-vyn, med en vridning emellan
await page.click('.tabs button[data-tab="scene"]');
await new Promise((r) => setTimeout(r, 1500));
await page.click("#snap-take");
const mid = await page.$eval("#scene-container", (e) => {
  const b = e.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
await page.mouse.move(mid.x, mid.y);
await page.mouse.down();
await page.mouse.move(mid.x + 250, mid.y - 60, { steps: 10 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
await page.click("#snap-take");
console.log(`Bilder i listan: ${await page.$$eval("#snap-list img", (els) => els.length)}`);
await page.screenshot({ path: "out/rapport-3d-flik.png" });

// Två bilder i översikten: hela modellen och en inzoomning kring mitten
await page.click('.tabs button[data-tab="plan"]');
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: "out/rapport-plan-start.png" });
await page.click("#plan-snap");
const pc = await page.$eval("#plan-container svg", (e) => {
  const b = e.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
await page.mouse.move(pc.x, pc.y);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel({ deltaY: -300 });
  await new Promise((r) => setTimeout(r, 150));
}
await page.click("#plan-snap");
console.log(`Översiktsbilder i listan: ${await page.$$eval("#plan-snap-list img", (els) => els.length)}`);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "out/rapport-plan-flik.png" });

// Rapporten: rutan med plats och datum, sedan den nya fliken
const opened = browser.waitForTarget((t) => t.url().startsWith("blob:"), { timeout: 120000 });
await page.click("#btn-report");
await page.waitForSelector("#publish-dialog[open]");
await page.click("#pub-ok");
const report = await (await opened).page();
await report.waitForSelector(".page", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1000));
const info = await report.evaluate(() => ({
  title: document.title,
  pages: document.querySelectorAll(".page").length,
  svgs: document.querySelectorAll(".page svg").length,
  images: document.querySelectorAll(".page img").length,
  firstHole: [...document.querySelectorAll("section")].findIndex((s) => s.classList.contains("hole")) + 1,
  mb: Math.round(document.documentElement.outerHTML.length / 1e5) / 10,
}));
console.log(JSON.stringify(info));
await report.setViewport({ width: 1200, height: 900 });
await report.screenshot({ path: "out/rapport-skarm.png" });
// Enskilda sidor som bilder: försättsbladet, de två första bildsidorna och första hålet
for (const n of [1, 2, 3, info.firstHole]) {
  const el = await report.$(`section:nth-of-type(${n})`);
  if (el) await el.screenshot({ path: `out/rapport-sida-${n}.png` });
}
await report.pdf({ path: "out/rapport.pdf", preferCSSPageSize: true, printBackground: true });
console.log("out/rapport.pdf, out/rapport-skarm.png, out/rapport-sida-*.png, out/rapport-3d-flik.png");
console.log(messages.length ? messages.join("\n") : "Inga konsolfel.");
await browser.close();
