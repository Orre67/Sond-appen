import puppeteer from "puppeteer-core";

// Torphyttan utan ytmodell: startpunkter och sonderingar, inga OBJ-filer.
const base = "/@fs/C:/Users/oscar/Desktop/filer till claude/sond appen/";
const files = ["hålens startpunkter/2026-10-01-Torphyttan.txt", "sond data dm4/261001-torphyttan-993.dm4", "sond data dm4/261001-torphyttan-995.dm4", "sond data dm4/261001-torphyttan-999.dm4"];
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
await page.waitForFunction(() => [...document.querySelectorAll("#file-status li")].length >= 4, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await page.click(`.tabs button[data-tab="plan"]`);
await new Promise((r) => setTimeout(r, 1200));
const info = await page.evaluate(() => {
  const holes = [...document.querySelectorAll("#plan-container g.plan-hole")].map((g) => g.dataset.source);
  const points = [...document.querySelectorAll("#plan-container g.plan-point")].map((g) => g.dataset.source);
  const both = holes.filter((h) => points.includes(h));
  return { holes: holes.length, points: points.length, both, badges: (document.body.innerHTML.match(/>×\d</g) ?? []).length };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: "C:/Sond appen/out/app-nomesh-plan.png" });
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
