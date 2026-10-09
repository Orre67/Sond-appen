import puppeteer from "puppeteer-core";
import fs from "node:fs";

const url = fs.readFileSync("C:/Sond appen/out/demo-url.txt", "utf8").trim();
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
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
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length > 0, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));

const info0 = await page.$eval("#auto-info", (el) => el.textContent);
console.log("Auto av:", info0);
await page.click("#opt-auto");
await new Promise((r) => setTimeout(r, 1500));
const info1 = await page.$eval("#auto-info", (el) => el.textContent);
console.log("Auto på:", info1);
const stored = await page.evaluate(() => localStorage.getItem("sond.autoCorrection"));
console.log("localStorage:", stored);

await page.click(`.tabs button[data-tab="profile"]`);
await page.click(`#hole-list li[data-id="20"]`);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "C:/Sond appen/out/app-auto-profile-20.png" });
const panel = await page.$("section.panel:nth-of-type(3)");
if (panel) await panel.screenshot({ path: "C:/Sond appen/out/app-auto-settings.png" });
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
