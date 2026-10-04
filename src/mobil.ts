import "./mobil.css";
import { fetchShare, type ShareBundle } from "./core/share";
import { CLASS_COLORS, fmt } from "./view/format";
import { attachHover } from "./view/hover";
import { drawProfile, type HoverSample } from "./view/profile";
import { formatDate, timeAgo, type Catalog, type CatalogEntry } from "./core/catalog";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Saknar element #${id}`);
  return el as T;
};

const params = new URLSearchParams(location.search);
let bundle: ShareBundle | null = null;
let index = 0;
let mode: "section" | "front" = "section";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function message(text: string): void {
  $("view").innerHTML = `<p class="empty">${esc(text)}</p>`;
  $("subtitle").textContent = "";
  $("info").textContent = "";
}

function render(): void {
  if (!bundle || bundle.holes.length === 0) return;
  const h = bundle.holes[index];
  $("title").innerHTML = `<span class="dot" style="background:${CLASS_COLORS[h.cls]}"></span>Hål ${esc(h.id)}`;
  $("subtitle").textContent =
    h.minBurden !== null ? `Minsta försättning ${fmt(h.minBurden, 2)} m på ${fmt(h.minBurdenDepth, 1)} m` : "Ingen yta hittad";
  $("info").textContent = h.info ?? "";
  const toggle = $<HTMLButtonElement>("toggle");
  toggle.textContent = mode === "section" ? "Framifrån" : "Snitt";
  toggle.disabled = mode === "section" && !h.frontSvg;

  const view = $("view");
  let samples: HoverSample[] = [];
  if (mode === "section") {
    // Snittet ritas i rutans egen storlek så att det fyller skärmen oavsett telefon och vridning.
    const width = Math.max(240, Math.round(view.clientWidth));
    const height = Math.max(320, Math.round(view.clientHeight));
    const drawn = drawProfile(h.result, h.section, bundle.opts, { ...bundle.style, width, height, compact: true, showFront: false });
    view.innerHTML = drawn.svg;
    samples = drawn.samples;
  } else {
    view.innerHTML = h.frontSvg ?? `<p class="empty">Ingen vy framifrån för detta hål.</p>`;
  }
  const svg = view.querySelector("svg");
  if (svg) attachHover(svg, samples, { sticky: true, onSwipe: (dir) => step(dir) });

  const url = new URL(location.href);
  url.searchParams.set("h", String(index));
  history.replaceState(null, "", url);
}

function step(delta: number): void {
  if (!bundle) return;
  const n = bundle.holes.length;
  index = (index + delta + n) % n;
  render();
}

function toggleMode(): void {
  mode = mode === "section" ? "front" : "section";
  render();
}

$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("toggle").addEventListener("click", toggleMode);
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === " " || e.key === "f") toggleMode();
});

// Ny storlek (vridning, webbläsarens fält som fälls in eller ut): rita om snittet i den nya rutan.
let resizeTimer = 0;
window.addEventListener("resize", () => {
  if (mode !== "section") return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 150);
});

// ---------- Listan över inmätningar: inloggning med företagets kod, sedan ett kort per publicering ----------

async function initList(): Promise<void> {
  $("app").classList.add("list");
  $("title").textContent = "Sond appen";
  $("subtitle").textContent = "Inmätningar";
  $("info").textContent = "";
  document.title = "Sond appen · inmätningar";
  await loadCatalog();
}

async function loadCatalog(): Promise<void> {
  $("view").innerHTML = `<p class="empty loading">Hämtar …</p>`;
  let res: Response;
  try {
    res = await fetch("/api/m/catalog", { cache: "no-store" });
  } catch {
    message("Ingen kontakt med servern.");
    return;
  }
  if (res.status === 401) {
    renderLogin();
    return;
  }
  if (!res.ok) {
    message(`Kunde inte hämta listan: ${res.status}`);
    return;
  }
  const catalog = (await res.json()) as Catalog;
  renderCards(catalog.entries ?? []);
}

function renderLogin(error = ""): void {
  $("view").innerHTML = `
    <form class="login" id="login-form">
      <h2>Logga in</h2>
      <p>Ange företagets åtkomstkod.</p>
      <input id="login-code" inputmode="numeric" autocomplete="one-time-code" placeholder="Kod" required autofocus />
      <button type="submit">Logga in</button>
      ${error ? `<p class="error">${esc(error)}</p>` : ""}
    </form>`;
  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void login($<HTMLInputElement>("login-code").value);
  });
}

async function login(code: string): Promise<void> {
  const res = await fetch("/api/m/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  if (res.ok) await loadCatalog();
  else renderLogin(res.status === 401 ? "Fel kod. Försök igen." : `Inloggningen misslyckades: ${res.status}`);
}

function renderCards(entries: CatalogEntry[]): void {
  if (entries.length === 0) {
    $("view").innerHTML = `<p class="empty">Inga publicerade inmätningar ännu.</p>`;
    return;
  }
  const card = (e: CatalogEntry) => `
    <a class="card" href="/m/${esc(e.id)}">
      <b>${esc(e.site)}</b>
      <span>${esc(formatDate(e.date))} · ${e.holes} hål</span>
      ${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}
      <span class="when">Publicerad ${esc(timeAgo(e.published))}</span>
    </a>`;
  $("view").innerHTML = `<div class="cards">${entries.map(card).join("")}</div>`;
}

async function init(): Promise<void> {
  // Länken är /m/<id> (Vercel och dev-servern) eller mobil.html?s=<id>. Utan id visas listan.
  const id = params.get("s") ?? /^\/m\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1] ?? null;
  if (!id) {
    await initList();
    return;
  }
  try {
    bundle = await fetchShare(id);
  } catch (err) {
    message(err instanceof Error ? err.message : String(err));
    return;
  }
  if (bundle.holes.length === 0) {
    message("Paketet innehåller inga hål.");
    return;
  }
  document.title = `Sond appen · ${bundle.name}`;
  const h = Number(params.get("h"));
  index = Number.isInteger(h) && h >= 0 && h < bundle.holes.length ? h : 0;
  render();
}

void init();
