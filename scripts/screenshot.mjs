/**
 * Röktest av webbappen: öppnar demoläget i headless Chrome, väntar tills hålen är
 * beräknade och fotar alla flikar. Kräver att "npm run dev" kör på port 5173 och att
 * out/demo-url.txt innehåller demo-URL:en.
 *
 *   node scripts/screenshot.mjs
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
  else if (m.text().startsWith("Beräknade")) messages.push(m.text());
});
page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));

const t0 = Date.now();
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length > 0, { timeout: 180000 });
console.log(`Hålen klara efter ${Date.now() - t0} ms`);
await new Promise((r) => setTimeout(r, 1500));

for (const tab of ["profile", "scene", "plan", "table"]) {
  await page.click(`.tabs button[data-tab="${tab}"]`);
  await new Promise((r) => setTimeout(r, tab === "scene" ? 2000 : 600));
  await page.screenshot({ path: `out/app-${tab}.png` });
  console.log(`out/app-${tab}.png`);
}

await page.click(`.tabs button[data-tab="profile"]`);
await page.click(`#hole-list li[data-id="19"]`);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `out/app-profile-19.png` });
console.log("out/app-profile-19.png");

// Avläsning: för muspekaren till en punkt på hålet och fota markeringen
const target = await page.evaluate(() => {
  const svg = document.querySelector("#profile-container svg");
  if (!svg) return null;
  const hole = [...svg.querySelectorAll("polyline")].find((p) => p.getAttribute("stroke") === "#141414");
  if (!hole) return null;
  const b = hole.getBoundingClientRect();
  return { x: b.left + b.width * 0.5, y: b.top + b.height * 0.5 };
});
if (target) {
  await page.mouse.move(target.x, target.y);
  await new Promise((r) => setTimeout(r, 200));
  const text = await page.$eval("#profile-container svg g.hover-layer", (g) => g.textContent);
  console.log(`Avläsning vid muspekaren: ${text}`);
  await page.screenshot({ path: `out/app-hover.png` });
  console.log("out/app-hover.png");
}

// Dela till mobil: bygg paketet, hämta länken och öppna den i telefonstorlek
await page.click("#btn-share");
await page.waitForSelector("#share-result:not(.hidden) a", { timeout: 120000 });
const shareUrl = await page.$eval("#share-result a", (a) => a.getAttribute("href"));
console.log(`Delningslänk: ${shareUrl}`);

const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phoneMessages = [];
phone.on("console", (m) => {
  if (m.type() === "error") phoneMessages.push(`error: ${m.text()}`);
});
phone.on("pageerror", (e) => phoneMessages.push(`pageerror: ${e.message}`));
await phone.goto(shareUrl.replace("localhost", "127.0.0.1"), { waitUntil: "load" });
await phone.waitForSelector("#view svg", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 400));
await phone.screenshot({ path: "out/mobil-1.png" });
console.log("out/mobil-1.png");

// Dra fingret längs hålet: avläsning
const hole = await phone.evaluate(() => {
  const svg = document.querySelector("#view svg");
  const pl = [...svg.querySelectorAll("polyline")].find((p) => p.getAttribute("stroke") === "#141414");
  const b = pl.getBoundingClientRect();
  return { x: b.left + b.width * 0.55, y1: b.top + b.height * 0.3, y2: b.top + b.height * 0.7 };
});
await phone.touchscreen.touchStart(hole.x, hole.y1);
for (let i = 1; i <= 8; i++) await phone.touchscreen.touchMove(hole.x, hole.y1 + ((hole.y2 - hole.y1) * i) / 8);
await phone.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 200));
const reading = await phone.$eval("#view svg g.hover-layer", (g) => g.textContent);
console.log(`Avläsning på telefonen: ${reading}`);
await phone.screenshot({ path: "out/mobil-2-avlasning.png" });
console.log("out/mobil-2-avlasning.png");

// Svep åt höger: nästa hål
const before = await phone.$eval("#title", (e) => e.textContent);
await phone.touchscreen.touchStart(80, 500);
for (let i = 1; i <= 6; i++) await phone.touchscreen.touchMove(80 + i * 40, 500 + i * 2);
await phone.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 300));
const after = await phone.$eval("#title", (e) => e.textContent);
console.log(`Svep: ${before} -> ${after}`);

// Knappen Framifrån
await phone.click("#toggle");
await new Promise((r) => setTimeout(r, 400));
await phone.screenshot({ path: "out/mobil-3-framifran.png" });
console.log("out/mobil-3-framifran.png");
console.log(phoneMessages.length ? phoneMessages.join("\n") : "Inga konsolfel på telefonsidan.");
await phone.close();

const fileStatus = await page.$$eval("#file-status li", (els) => els.map((e) => e.textContent));
console.log(fileStatus.join("\n"));
console.log(messages.length ? messages.join("\n") : "Inga konsolfel.");
await browser.close();
