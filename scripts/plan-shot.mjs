/**
 * Provar översikten i headless Chrome: skjutriktning (fält och ritad linje) och omnumrering.
 * Kräver "npm run dev" och out/demo-url.txt. Skriver out/plan-*.png.
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const url = new URL(readFileSync("out/demo-url.txt", "utf8").trim().replace("localhost", "127.0.0.1"));
url.searchParams.set("tab", "plan");
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"], defaultViewport: { width: 1500, height: 950 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (sel) => page.$$eval(sel, (els) => els.length);
const status = async () => ({ holes: await count("g.plan-hole"), points: await count("g.plan-point"), hint: await page.$eval("#plan-hint", (e) => e.textContent), bearing: await page.$eval("#blast-bearing", (e) => e.value) });

await page.goto(url.href, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("g.plan-hole").length >= 24, { timeout: 120000 });
await wait(800);
await page.screenshot({ path: "out/plan-1.png" });
console.log("start", await status());

// Skjutriktning via fältet
await page.focus("#blast-bearing");
await page.keyboard.type("100");
await page.keyboard.press("Tab");
await wait(500);
console.log("fält 100:", await page.$eval("#plan-container svg", (s) => s.dataset.bearing), await page.$eval("#plan-container svg", (s) => s.getAttribute("viewBox")));
await page.screenshot({ path: "out/plan-2-riktning.png" });

// Ritad linje: från höger till vänster över kartan
await page.click("#blast-draw");
const box = await (await page.$("#plan-container svg")).boundingBox();
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4, { steps: 8 });
await page.mouse.up();
await wait(500);
console.log("ritad linje:", (await status()).bearing);

// Zoom med scrollhjulet kring mitten, dra för att flytta, dubbelklick visar hela ytan
const vb = async () => page.$eval("#plan-container svg", (s) => s.getAttribute("viewBox"));
const before = await vb();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.wheel({ deltaY: -600 });
await wait(300);
console.log("zoom:", before, "->", await vb());
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 });
await page.mouse.up();
await wait(300);
console.log("pan:", await vb());
await page.screenshot({ path: "out/plan-4-zoom.png" });
await page.click("#plan-fit");
await wait(400);
console.log("hela ytan:", await vb());

// Omnumrering: nollställ, klicka två punkter, numrera resten, originalnummer
await page.click("#num-clear");
await wait(600);
console.log("nollställt", await status());
for (const src of ["20", "21"]) {
  await page.click(`g.plan-point[data-source="${src}"] circle:last-of-type`);
  await wait(600);
}
console.log("två klick", await status());
const labels = await page.$$eval("g.plan-hole", (gs) => gs.map((g) => `${g.dataset.id}(${g.dataset.source})`));
console.log("hål efter två klick:", labels.join(" "));
await page.screenshot({ path: "out/plan-3-numrering.png" });
await page.click("#num-rest");
await wait(800);
console.log("numrera onumrerade", await status());
await page.click("#num-reset");
await wait(800);
console.log("originalnummer", await status());
console.log(errs.length ? errs.join(" | ") : "inga konsolfel");
await browser.close();
