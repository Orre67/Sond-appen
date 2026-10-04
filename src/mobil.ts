import "./mobil.css";
import { fetchShare, type ShareBundle } from "./core/share";
import { CLASS_COLORS, fmt } from "./view/format";
import { attachHover } from "./view/hover";
import { drawProfile, type HoverSample } from "./view/profile";
import { planFrame, renderPlanSvg } from "./view/plan";
import { attachPanZoom, type ViewBox } from "./view/panzoom";
import { formatDate, timeAgo, type Catalog, type CatalogEntry } from "./core/catalog";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Saknar element #${id}`);
  return el as T;
};

const params = new URLSearchParams(location.search);
let bundle: ShareBundle | null = null;
let index = 0;
let mode: "plan" | "section" | "front" = "section";
/** Senast öppnade hål, markeras i översikten. */
let lastHole: string | null = null;
/** Översiktens zoom och läge, kvar när man går in i ett hål och tillbaka. */
let planView: ViewBox | null = null;

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
  $("app").classList.toggle("plan", mode === "plan");
  if (mode === "plan") {
    renderPlan();
    return;
  }
  const h = bundle.holes[index];
  $("title").innerHTML = `<span class="dot" style="background:${CLASS_COLORS[h.cls]}"></span>Hål ${esc(h.id)}`;
  $("subtitle").textContent =
    h.minBurden !== null ? `Minsta försättning ${fmt(h.minBurden, 2)} m på ${fmt(h.minBurdenDepth, 1)} m` : "Ingen yta hittad";
  $("info").textContent = h.info ?? "";
  const toggle = $<HTMLButtonElement>("toggle");
  toggle.textContent = mode === "section" ? "Framifrån" : "Snitt";
  toggle.disabled = mode === "section" && !h.frontSvg;
  const back = $<HTMLAnchorElement>("back");
  if (bundle.plan) {
    back.textContent = "‹ Översikt";
    back.href = "#oversikt";
  } else {
    back.textContent = "‹ Inmätningar";
    back.href = "/m";
  }

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

// ---------- Översikten: ortofotot i skrivbordets orientering, dra och nyp, tryck på ett hål ----------

function renderPlan(): void {
  if (!bundle?.plan) return;
  const plan = bundle.plan;
  const salva = bundle.salva;
  $("title").textContent = salva?.site ?? bundle.name;
  const parts = [salva ? formatDate(salva.date) : null, `${bundle.holes.length} hål`, plan.bearing !== null ? `skjutriktning ${plan.bearing}°` : null];
  $("subtitle").textContent = parts.filter((p): p is string => !!p).join(" · ");
  $("info").textContent = salva?.note || "Tryck på ett hål. Dra för att flytta, nyp för att zooma.";
  const back = $<HTMLAnchorElement>("back");
  back.textContent = "‹ Inmätningar";
  back.href = "/m";
  drawPlan();
  const url = new URL(location.href);
  url.searchParams.delete("h");
  history.replaceState(null, "", url);
}

function drawPlan(): void {
  if (!bundle?.plan) return;
  const plan = bundle.plan;
  const view = $("view");
  const frame = planFrame(plan.bounds, plan.bearing, 3, plan.extent);
  const fit: ViewBox = { x: 0, y: 0, w: frame.w, h: frame.h };
  const current = planView ?? fit;
  // Meter per skärmpixel vid den zoom som gäller, med bilden inpassad i rutan
  const pixelScale = Math.max(current.w / Math.max(1, view.clientWidth), current.h / Math.max(1, view.clientHeight));
  view.innerHTML = renderPlanSvg(
    bundle.holes.map((x) => x.result),
    bundle.opts,
    plan.bounds,
    plan.image ? { dataUrl: plan.image } : null,
    lastHole,
    { bearing: plan.bearing, points: plan.points, sourceIds: new Map(plan.sourceIds), extent: plan.extent, pixelScale },
  );
  const svg = view.querySelector("svg");
  if (!svg) return;
  attachPanZoom(svg, {
    fit,
    initial: planView,
    onTap: (_v, client) => tapHole(svg, client),
    onChange: (v) => {
      // Rita om med siffror och markörer i skärmstorlek för den nya zoomen
      planView = v;
      drawPlan();
    },
  });
}

/** Tryck i översikten: öppna närmaste hål inom räckhåll för ett finger. */
function tapHole(svg: SVGSVGElement, [cx, cy]: [number, number]): void {
  if (!bundle) return;
  let best: { id: string; d: number } | null = null;
  for (const g of svg.querySelectorAll<SVGGElement>("g.plan-hole")) {
    const c = g.querySelector("circle.collar");
    if (!c) continue;
    const r = c.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d <= 28 && (!best || d < best.d)) best = { id: g.dataset.id ?? "", d };
  }
  if (!best) return;
  const i = bundle.holes.findIndex((h) => h.id === best.id);
  if (i >= 0) openHole(i);
}

function openHole(i: number): void {
  if (!bundle) return;
  index = i;
  lastHole = bundle.holes[i].id;
  if (mode === "plan") mode = "section";
  render();
}

function step(delta: number): void {
  if (!bundle) return;
  const n = bundle.holes.length;
  openHole((index + delta + n) % n);
}

function toggleMode(): void {
  if (mode === "plan") return;
  mode = mode === "section" ? "front" : "section";
  render();
}

$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("toggle").addEventListener("click", toggleMode);
$("back").addEventListener("click", (e) => {
  if (bundle?.plan && mode !== "plan") {
    e.preventDefault();
    mode = "plan";
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === " " || e.key === "f") toggleMode();
});

// Ny storlek (vridning, webbläsarens fält som fälls in eller ut): rita om i den nya rutan.
let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (mode === "section") render();
    else if (mode === "plan") drawPlan();
  }, 150);
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
  document.title = `Sond appen · ${bundle.salva?.site ?? bundle.name}`;
  // Översikten först när den finns. ?h=<index> öppnar ett hål direkt, t.ex. från en delad länk.
  const h = params.get("h");
  const n = h === null ? NaN : Number(h);
  if (Number.isInteger(n) && n >= 0 && n < bundle.holes.length) {
    index = n;
    lastHole = bundle.holes[n].id;
    mode = "section";
  } else {
    mode = bundle.plan ? "plan" : "section";
  }
  render();
}

void init();
