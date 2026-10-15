/**
 * Telefonen efter publicering med "Korta hål visar hela slänten" på, mot Torphyttan i demoläget
 * (out/demo-url.txt, kräver npm run dev som tar emot paketet via POST /api/share):
 * 1. skrivbordet: kryssa i rutan, publicera, läs paketets id ur länken,
 * 2. paketet: style.floorZ satt, fot per hål, ingen spökbana,
 * 3. telefonen: från översikten ska pil höger öppna första hålet (inte det andra),
 * 4. skärmdump av det kortaste hålet i out/phone-floor.png.
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const url = readFileSync("out/demo-url.txt", "utf8").trim();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errs = [];
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
page.on("pageerror", (e) => errs.push(`skrivbord: ${e.message}`));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length > 0, { timeout: 120000 });
await page.waitForSelector("#profile-container svg", { timeout: 60000 });
await page.click("#show-floor");
await page.waitForFunction(() => !document.getElementById("btn-share").disabled, { timeout: 60000 });
// Texturen måste vara klar innan publiceringen, annars nekar appen
await page.waitForFunction(() => document.querySelector("#plan-container svg image") !== null, { timeout: 60000 }).catch(() => {});
await page.click("#btn-share");
await page.waitForSelector("#publish-dialog[open]", { timeout: 10000 });
await page.click('#publish-dialog button[value="ok"]');
await page.waitForFunction(() => document.querySelectorAll("#share-links a").length > 0, { timeout: 180000 });
const href = await page.$eval("#share-links a", (a) => a.getAttribute("href"));
const id = /\/m\/([A-Za-z0-9_-]+)|[?&]s=([A-Za-z0-9_-]+)/.exec(href ?? "");
const shareId = id?.[1] ?? id?.[2];
if (!shareId) throw new Error(`Hittade inget paket-id i länken ${href}`);

const bundle = JSON.parse(readFileSync(`out/share/${shareId}.json`, "utf8"));
const ids = bundle.holes.map((h) => h.id);
const ghosts = bundle.holes.filter((h) => h.result.ghost !== undefined).length;
const toes = bundle.holes.filter((h) => h.toe).length;
console.log(`paket ${shareId}: ${ids.length} hål, floorZ ${bundle.style.floorZ}, fot hittad för ${toes}, spökbanor ${ghosts}`);

const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
phone.on("pageerror", (e) => errs.push(`telefon: ${e.message}`));
await phone.goto(`http://127.0.0.1:5173/mobil.html?s=${shareId}`, { waitUntil: "load" });
await phone.waitForSelector("#view svg", { timeout: 60000 });
const inPlan = await phone.$eval("#app", (el) => el.classList.contains("plan"));
await phone.click("#next");
await new Promise((r) => setTimeout(r, 300));
const title = await phone.$eval("#title", (el) => el.textContent?.trim());
console.log(`översikt först: ${inPlan}, pil höger från översikten öppnar: "${title}" (första hålet är ${ids[0]})`);
// Kortaste hålet: kortast hålbana
const lengths = bundle.holes.map((h) => h.result.path.length);
const shortest = lengths.indexOf(Math.min(...lengths));
await phone.goto(`http://127.0.0.1:5173/mobil.html?s=${shareId}&h=${shortest}`, { waitUntil: "load" });
await phone.waitForSelector("#view svg", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 400));
await phone.screenshot({ path: "out/phone-floor.png" });
console.log(`kortaste hål ${ids[shortest]} (${lengths[shortest].toFixed(1)} m) i out/phone-floor.png, fel: ${errs.length ? errs.join(" | ") : "inga"}`);
await browser.close();
