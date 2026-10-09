import puppeteer from "puppeteer-core";

const base = "/@fs/C:/Users/oscar/Desktop/filer till claude/iredes och quallog/";
const files = ["rockma/iredes/Gladökvarn260907.xml", "rockma/quallog/DQGladökvarn260907.xml"];
const url = `http://127.0.0.1:5173/?demo=${encodeURIComponent(base)}&files=${files.map(encodeURIComponent).join(",")}`;
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
await page.waitForFunction(() => [...document.querySelectorAll("#file-status li")].length >= 2, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await page.click(`.tabs button[data-tab="plan"]`);
await new Promise((r) => setTimeout(r, 1200));
const before = await page.evaluate(() => ({
  points: document.querySelectorAll("#plan-container g.plan-point").length,
  lines: document.querySelectorAll("#plan-container line.plan-rig-line").length,
}));
console.log("översikt före:", JSON.stringify(before));

// Omnumrering: starta från 1, klicka på hål 240 (loggens) och se att det blir 1.
await page.evaluate(() => {
  const input = document.querySelector("#num-from");
  input.value = "1";
});
await page.click("#num-start");
await new Promise((r) => setTimeout(r, 400));
const target = await page.$('#plan-container g.plan-point[data-source="240"] circle.collar');
if (!target) throw new Error("hittar inte markören för hål 240");
await target.click();
await new Promise((r) => setTimeout(r, 800));
const after = await page.evaluate(() => {
  const g = document.querySelector('#plan-container g.plan-point[data-source="240"]');
  const texts = g ? [...g.querySelectorAll("text")].map((t) => t.textContent) : [];
  return { texts, stored: Object.keys(localStorage).filter((k) => k.includes("numrering")) };
});
console.log("efter numrering av 240:", JSON.stringify(after));
await page.screenshot({ path: "C:/Sond appen/out/app-rig-plan.png" });

await page.click(`.tabs button[data-tab="scene"]`);
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: "C:/Sond appen/out/app-rig-scene.png" });
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
