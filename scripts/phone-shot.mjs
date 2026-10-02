/**
 * Fotar mobilsidan i headless Chrome med valfri skärmstorlek. Kräver att "npm run dev" kör.
 *
 *   node scripts/phone-shot.mjs "http://127.0.0.1:5173/mobil.html?s=<id>&h=0" out/phone.png [bredd] [höjd] [front]
 *
 * Standard är 390x844. "front" trycker på knappen Framifrån innan bilden tas.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const url = process.argv[2];
const out = process.argv[3] ?? "out/phone-now.png";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const W = Number(process.argv[4] ?? 390), H = Number(process.argv[5] ?? 844);
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("#view svg", { timeout: 60000 });
if (process.argv[6] === "front") { await page.click("#toggle"); await new Promise((r) => setTimeout(r, 500)); }
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: out });
console.log(out, errs.length ? errs.join(" | ") : "inga fel");
await browser.close();
