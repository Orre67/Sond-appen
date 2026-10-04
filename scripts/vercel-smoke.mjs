/**
 * Röktest av hela flödet mot en körande app, lokalt eller på Vercel: läser in exempelfilerna
 * via filväljaren, publicerar (delningsnyckel ur SHARE_KEY eller .env.local), loggar in på
 * telefonsidan med åtkomstkoden (ACCESS_CODE eller .env.local, lokalt duger vad som helst),
 * väljer inmätningen i listan och fotar. Skriver out/vercel-*.png.
 *
 *   node scripts/vercel-smoke.mjs https://sond-appen.vercel.app
 *   node scripts/vercel-smoke.mjs http://127.0.0.1:5173
 */
import { existsSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) throw new Error("Ange appens adress, t.ex. https://sond-appen.vercel.app");
const local = /127\.0\.0\.1|localhost/.test(base);
const SAMPLES = "C:/Users/oscar/Desktop/filer till claude/sond appen";
const files = [
  `${SAMPLES}/obj/test1.obj`,
  `${SAMPLES}/obj/test1.mtl`,
  `${SAMPLES}/obj/test1.jpg`,
  `${SAMPLES}/hålens startpunkter/2026-10-01-Torphyttan.txt`,
  `${SAMPLES}/sond data dm4/261001-torphyttan-993.dm4`,
  `${SAMPLES}/sond data dm4/261001-torphyttan-995.dm4`,
  `${SAMPLES}/sond data dm4/261001-torphyttan-999.dm4`,
];
const envLocal = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const fromEnv = (name) => process.env[name] ?? new RegExp(`^${name}="?([^"\\r\\n]+)"?`, "m").exec(envLocal)?.[1];
const shareKey = fromEnv("SHARE_KEY") ?? (local ? "dev" : undefined);
const accessCode = fromEnv("ACCESS_CODE") ?? (local ? "test" : undefined);
if (!shareKey || !accessCode) throw new Error("Saknar SHARE_KEY eller ACCESS_CODE: kör `npx vercel env pull .env.local`.");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"],
  defaultViewport: { width: 1500, height: 950 },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const watch = (p, label, sink) => {
  p.on("pageerror", (e) => sink.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => {
    // 401 från listan före inloggning är väntat
    if (m.type() === "error" && !/401/.test(m.text())) sink.push(`${label} error: ${m.text()}`);
  });
};
const errs = [];

// Skrivbordet: läs in filer, publicera via rutan
const page = await browser.newPage();
watch(page, "skrivbord", errs);
page.on("dialog", (d) => {
  console.log(`Dialog (${d.type()}): ${d.message()}`);
  if (d.type() === "prompt") void d.accept(shareKey);
  else void d.accept();
});
const t0 = Date.now();
await page.goto(`${base}/`, { waitUntil: "load" });
await (await page.$("#file-input")).uploadFile(...files);
await page.waitForFunction(() => document.querySelectorAll("#hole-list li").length >= 24, { timeout: 180000 });
console.log(`Hålen klara efter ${Date.now() - t0} ms`);
await wait(2500);
await page.click("#btn-share");
await page.waitForSelector("#publish-dialog[open]", { timeout: 10000 });
const prefilled = await page.evaluate(() => ({ site: document.querySelector("#pub-site").value, date: document.querySelector("#pub-date").value }));
console.log(`Publiceringsrutan föreslår: ${prefilled.site} ${prefilled.date}`);
await page.type("#pub-note", "Röktest");
await page.click('#publish-dialog button[value="ok"]');
await page.waitForSelector("#share-result:not(.hidden) a", { timeout: 180000 });
const link = await page.$eval("#share-result a", (a) => a.getAttribute("href"));
console.log(`Länk: ${link}`);
console.log(`Resultat: ${await page.$eval("#share-links div", (e) => e.textContent)}`);
await page.screenshot({ path: "out/vercel-1-app.png" });

// Telefonen: listan kräver inloggning, sedan kort, sedan vyn
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 614, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
watch(phone, "telefon", errs);
await phone.goto(`${base}/m`, { waitUntil: "load" });
await phone.waitForFunction(
  () => document.querySelector("#login-form, .card") || (document.querySelector("#view .empty") && !/Hämtar/.test(document.querySelector("#view .empty").textContent)),
  { timeout: 60000 },
);
if (await phone.$("#login-form")) {
  console.log("Listan kräver inloggning");
  await phone.type("#login-code", accessCode);
  await phone.click("#login-form button");
  await phone.waitForSelector(".card, .login .error", { timeout: 60000 });
}
const cards = await phone.$$eval(".card", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
console.log(`Kort: ${cards.length} st. Första: ${cards[0] ?? "inget"}`);
await phone.screenshot({ path: "out/vercel-2-lista.png" });
const t1 = Date.now();
await phone.click(".card");
// Vyn uppdaterar adressen med replaceState, så vänta på innehållet i stället för på ett sidbyte
await phone.waitForFunction(() => location.pathname.startsWith("/m/") && !!document.querySelector("#view svg"), { timeout: 120000 });
await wait(800);
const planFirst = await phone.$eval("#app", (e) => e.classList.contains("plan"));
console.log(`Öppnade: ${await phone.$eval("#title", (e) => e.textContent)} · ${await phone.$eval("#subtitle", (e) => e.textContent)} efter ${Date.now() - t1} ms, översikt först: ${planFirst}`);
await phone.screenshot({ path: "out/vercel-3-oversikt.png" });
if (planFirst) {
  // Tryck på det första hålets påhugg i översikten
  const marker = await phone.$("g.plan-hole circle.collar");
  const r = await marker.boundingBox();
  await phone.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  await phone.waitForSelector("#view svg[data-hole]", { timeout: 30000 });
  await wait(500);
  console.log(`Tryck på hål: ${await phone.$eval("#title", (e) => e.textContent)}, bakåt: ${await phone.$eval("#back", (e) => e.textContent)}`);
}
await phone.screenshot({ path: "out/vercel-4-hal.png" });
await phone.click("#toggle");
await wait(800);
await phone.screenshot({ path: "out/vercel-5-framifran.png" });
await phone.click("#back");
await wait(600);
console.log(`Tillbaka till översikten: ${await phone.$eval("#app", (e) => e.classList.contains("plan"))}`);

// Utloggad telefon (egen kakburk) får inte listan
const strangerContext = await browser.createBrowserContext();
const stranger = await strangerContext.newPage();
const res = await stranger.goto(`${base}/api/m/catalog`, { waitUntil: "load" });
console.log(`Utan inloggning: /api/m/catalog ger ${res.status()}`);
console.log(errs.length ? errs.join(" | ") : "Inga konsolfel på skrivbord eller telefon");
await browser.close();
