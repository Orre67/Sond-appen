/**
 * Fotar 3D-vyn i headless Chrome med bara ytmodell och startpunkter (ingen sondering), för att
 * kontrollera att påhuggen ligger rätt mot ytan. Kräver "npm run dev" och out/demo-url.txt.
 *
 *   node scripts/scene-shot.mjs [out/scene-points.png]
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const out = process.argv[2] ?? "out/scene-points.png";
const url = new URL(readFileSync("out/demo-url.txt", "utf8").trim().replace("localhost", "127.0.0.1"));
const files = (url.searchParams.get("files") ?? "").split(",").filter((f) => !f.toLowerCase().endsWith(".dm4"));
url.searchParams.set("files", files.join(","));
url.searchParams.set("tab", "scene");
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"], defaultViewport: { width: 1500, height: 950 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto(url.href, { waitUntil: "load" });
await page.waitForFunction(() => /\d+ punkter/.test(document.querySelector("#file-status")?.textContent ?? ""), { timeout: 120000 });
await page.waitForFunction(() => /trianglar/.test(document.querySelector("#file-status")?.textContent ?? ""), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
const status = await page.$eval("#file-status", (e) => e.textContent);
const warnings = await page.$eval("#warnings", (e) => e.textContent);
const el = await page.$("#scene-container");
await el.screenshot({ path: out });
console.log(out);
console.log("Filer:", status.replace(/\s+/g, " ").trim());
console.log("Varningar:", warnings.trim() || "inga");
console.log(errs.length ? errs.join(" | ") : "inga konsolfel");
await browser.close();
