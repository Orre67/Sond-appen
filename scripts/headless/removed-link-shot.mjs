import puppeteer from "puppeteer-core";
const base = "/@fs/C:/Users/oscar/Desktop/filer till claude/bugg 1/";
const files = ["2026-10-07-Hakunge.txt", "261007hakunge.dm4", "261007hakunge1.dm4"];
const url = `http://127.0.0.1:5173/?demo=${encodeURIComponent(base)}&files=${files.map(encodeURIComponent).join(",")}`;
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"], defaultViewport: { width: 1500, height: 950 } });
const page = await browser.newPage();
const messages = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") messages.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));
// Oscars läge: 63 och 37 borttagna och en omnumrering där punkt 62 heter 63.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("sond-appen:borttagna:2026-10-07-Hakunge.txt", JSON.stringify(["63", "37"]));
  localStorage.setItem("sond-appen:numrering:2026-10-07-Hakunge.txt", JSON.stringify([["62", "63"]]));
});
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => [...document.querySelectorAll("#file-status li")].length >= 3, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
console.log("hål-panel:", await page.$eval("#unmatched", (el) => el.innerText.replace(/\n/g, " · ")));
console.log("borttagna-panel:", await page.$eval("#removed-panel", (el) => ({ hidden: el.hidden, open: el.open })));
await page.click(`.tabs button[data-tab="plan"]`);
await new Promise((r) => setTimeout(r, 1200));
console.log(JSON.stringify(await page.evaluate(() => ({
  holes: document.querySelectorAll("#plan-container g.plan-hole").length,
  hole63FromSource62: !!document.querySelector('#plan-container g.plan-hole[data-source="62"][data-id="63"]'),
  point37: !!document.querySelector('#plan-container g.plan-point[data-source="37"]'),
}))));
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
