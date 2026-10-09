import puppeteer from "puppeteer-core";

const base = "/@fs/C:/Users/oscar/Desktop/filer till claude/iredes och quallog/";
const files = ["rockma/quallog/DQGladökvarn260907.xml"];
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
await page.waitForFunction(() => [...document.querySelectorAll("#file-status li")].length >= 1, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const removeBtn = () => page.$eval("#hole-remove", (b) => (b.disabled ? "avstängd" : b.textContent));

// 3D först, utan någon tidigare markering: bara loggens cylindrar och markörer finns att klicka på.
await page.click(`.tabs button[data-tab="scene"]`);
await wait(2500);
console.log("3D före klick:", await removeBtn());
const box = await (await page.$("#scene-container canvas")).boundingBox();
let got = null;
for (const [dx, dy] of [[0, 0], [-40, 0], [40, 0], [0, -40], [0, 40], [-80, -20], [80, 20], [-120, 0], [120, 0], [-160, 30], [160, -30]]) {
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await wait(300);
  const t = await removeBtn();
  if (t !== "avstängd") {
    got = `${t} vid (${dx},${dy})`;
    break;
  }
}
console.log("3D efter klick:", got ?? "inget träffat");

// Översikt: två textpunkter på samma plats som loggens hål 240 ger en stapel om tre.
await page.evaluate(() => {
  const ta = document.querySelector("#points-text");
  ta.value = "317,671761.407,6563336.393,60.163\n317A,671761.45,6563336.40,60.17\n";
});
await page.click("#points-apply");
await wait(1500);
await page.click(`.tabs button[data-tab="plan"]`);
await wait(1000);
const selected = () => page.evaluate(() => {
  const ring = document.querySelector('#plan-container g.plan-point circle[r="0.70"]');
  return ring ? ring.closest("g").dataset.source : null;
});
console.log("×3 i bilden:", await page.evaluate(() => (document.body.innerHTML.match(/>×3</g) ?? []).length));
const clickMarker = async () => (await page.$('#plan-container g.plan-point[data-source="317A"] circle.collar')).click();
for (let i = 1; i <= 4; i++) {
  await clickMarker();
  await wait(500);
  console.log(`klick ${i}:`, await selected());
}
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
