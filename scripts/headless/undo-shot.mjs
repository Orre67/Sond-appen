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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has240 = () => page.evaluate(() => !!document.querySelector('#plan-container g.plan-point[data-source="240"]'));
const hint = () => page.$eval("#undo-hint", (el) => el.textContent);
const removeBtn = () => page.$eval("#hole-remove", (b) => ({ text: b.textContent, disabled: b.disabled }));

await page.click(`.tabs button[data-tab="plan"]`);
await wait(1000);
// Markera 240 och ta bort med Delete-tangenten.
await (await page.$('#plan-container g.plan-point[data-source="240"] circle.collar')).click();
await wait(400);
console.log("knapp efter markering:", JSON.stringify(await removeBtn()));
await page.keyboard.press("Delete");
await wait(800);
console.log("efter Delete: 240 finns", await has240(), "·", await hint());
// Ctrl+Z, Ctrl+Y
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await wait(800);
console.log("efter Ctrl+Z: 240 finns", await has240(), "· redo-knapp aktiv:", await page.$eval("#redo", (b) => !b.disabled));
await page.keyboard.down("Control");
await page.keyboard.press("y");
await page.keyboard.up("Control");
await wait(800);
console.log("efter Ctrl+Y: 240 finns", await has240(), "·", await hint());
// Inställning: ändra min försättning, ångra.
await page.evaluate(() => {
  const el = document.querySelector("#opt-min");
  el.value = "2";
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await wait(600);
console.log("efter inställning:", await hint(), "· fält =", await page.$eval("#opt-min", (e) => e.value));
await page.click("#undo");
await wait(600);
console.log("efter Ångra-knapp:", await hint(), "· fält =", await page.$eval("#opt-min", (e) => e.value), "· 240 finns", await has240());
// Numrering: numrera om 101 till 1 och ångra.
await page.evaluate(() => (document.querySelector("#num-from").value = "1"));
await page.click("#num-start");
await wait(300);
await (await page.$('#plan-container g.plan-point[data-source="101"] circle.collar')).click();
await wait(700);
const label = () => page.evaluate(() => document.querySelector('#plan-container g.plan-point[data-source="101"] text')?.textContent);
console.log("efter numrering:", await label(), "·", await hint());
await page.keyboard.press("Escape");
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await wait(700);
console.log("efter Ctrl+Z:", await label(), "· lagrat:", await page.evaluate(() => localStorage.getItem("sond-appen:numrering:Gladökvarn260907")));
console.log("meddelanden:", messages.length ? messages.join("\n") : "inga");
await browser.close();
