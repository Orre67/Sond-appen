/**
 * Kryssrutan "Korta hål visar hela slänten" mot Torphyttan i demoläget (out/demo-url.txt, kräver npm run dev):
 * mäter hålbanans höjd i profilbilden för varje hål med rutan av och på. Det kortaste hålet ska krympa
 * i bild (fönstret når ned till salvans botten), det djupaste ska vara nästan oförändrat, Ctrl+Z ska
 * slå av rutan igen. Skärmdump av det kortaste hålet med rutan på i out/floor-shot.png.
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const url = readFileSync("out/demo-url.txt", "utf8").trim();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length > 0, { timeout: 120000 });
await page.waitForSelector("#profile-container svg", { timeout: 60000 });

const ids = await page.$$eval("#hole-select option", (os) => os.map((o) => o.value));
/** Hålbanans höjd i bildpunkter för det valda hålet: den tjocka polylinen i snittet. */
const holeHeight = () =>
  page.$eval("#profile-container svg", (svg) => {
    const lines = [...svg.querySelectorAll("polyline")].filter((p) => p.getAttribute("stroke-width") === "2.6");
    const b = lines[0]?.getBBox();
    return b ? Math.round(b.height) : -1;
  });
const measure = async () => {
  const out = {};
  for (const id of ids) {
    await page.select("#hole-select", id);
    await new Promise((r) => setTimeout(r, 60));
    out[id] = await holeHeight();
  }
  return out;
};

// Rutan är på som standard: slå av, mät, slå på igen, mät
if (await page.$eval("#show-floor", (el) => el.checked)) {
  await page.click("#show-floor");
  await new Promise((r) => setTimeout(r, 200));
}
const off = await measure();
await page.click("#show-floor");
await new Promise((r) => setTimeout(r, 200));
const on = await measure();
const checked = await page.$eval("#show-floor", (el) => el.checked);
// Djupaste hålet = längst bana i bild med rutan av; kortaste = kortast bana
const sorted = ids.slice().sort((a, b) => off[a] - off[b]);
const shortest = sorted[0];
const deepest = sorted[sorted.length - 1];
await page.select("#hole-select", shortest);
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: "out/floor-shot.png", clip: { x: 0, y: 0, width: 1500, height: 1000 } });
// Blädderlistan har fokus efter page.select och tangenter dit ignoreras, så släpp fokus först.
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await new Promise((r) => setTimeout(r, 200));
const afterUndo = await page.$eval("#show-floor", (el) => el.checked);
const undoHint = await page.$eval("#undo-hint", (el) => el.textContent);

console.log(`hål: ${ids.length}, ruta på: ${checked}, efter Ctrl+Z: ${afterUndo}, ångra-text före: "${undoHint}"`);
console.log(`kortaste ${shortest}: ${off[shortest]} -> ${on[shortest]} px, djupaste ${deepest}: ${off[deepest]} -> ${on[deepest]} px`);
const shrunk = ids.filter((id) => on[id] < off[id] - 2).length;
console.log(`krympte i bild: ${shrunk} av ${ids.length}, fel: ${errs.length ? errs.join(" | ") : "inga"}`);
await browser.close();
