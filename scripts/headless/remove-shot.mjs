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
const count = () => page.evaluate(() => document.querySelectorAll("#plan-container g.plan-point").length);
console.log("markörer före:", await count());

// Markera hål 240 och ta bort det med knappen.
const target = await page.$('#plan-container g.plan-point[data-source="240"] circle.collar');
if (!target) throw new Error("hittar inte markören för hål 240");
await target.click();
await new Promise((r) => setTimeout(r, 500));
const ringed = await page.evaluate(() => !!document.querySelector('#plan-container g.plan-point[data-source="240"] circle[r="0.70"]'));
const btn = await page.$eval("#hole-remove", (b) => b.disabled);
console.log("markerad med ring:", ringed, "· knappen aktiv:", !btn);
await page.click("#hole-remove");
await new Promise((r) => setTimeout(r, 800));
const after = await page.evaluate(() => ({
  markers: document.querySelectorAll("#plan-container g.plan-point").length,
  has240: !!document.querySelector('#plan-container g.plan-point[data-source="240"]'),
  panelHidden: document.querySelector("#removed-panel").hidden,
  summary: document.querySelector("#removed-summary").textContent,
  rows: [...document.querySelectorAll("#removed-list li")].map((li) => li.textContent.trim()),
  stored: localStorage.getItem("sond-appen:borttagna:Gladökvarn260907"),
}));
console.log("efter borttagning:", JSON.stringify(after));
await page.screenshot({ path: "C:/Sond appen/out/app-removed.png" });

// Återställ.
await page.evaluate(() => document.querySelector("#removed-panel").open = true);
await page.click('#removed-list button[data-restore="240"]');
await new Promise((r) => setTimeout(r, 800));
console.log("efter återställning: markörer", await count(), "· 240 tillbaka:", await page.evaluate(() => !!document.querySelector('#plan-container g.plan-point[data-source="240"]')));
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
