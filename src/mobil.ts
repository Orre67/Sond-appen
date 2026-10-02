import "./mobil.css";
import { fetchShare, type ShareBundle } from "./core/share";
import { CLASS_COLORS, fmt } from "./view/format";
import { attachHover } from "./view/hover";

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
}

function render(): void {
  if (!bundle || bundle.holes.length === 0) return;
  const h = bundle.holes[index];
  $("title").innerHTML = `<span class="dot" style="background:${CLASS_COLORS[h.cls]}"></span>Hål ${esc(h.id)}`;
  $("subtitle").textContent =
    h.minBurden !== null ? `Minsta försättning ${fmt(h.minBurden, 2)} m på ${fmt(h.minBurdenDepth, 1)} m` : "Ingen yta hittad";
  $("info").textContent = h.info ?? "";
  $("counter").textContent = `${index + 1} / ${bundle.holes.length}`;
  $("hint").textContent = `Dra längs hålet för mått, svep för nästa hål. ${bundle.rule ?? ""}`;
  const toggle = $<HTMLButtonElement>("toggle");
  toggle.textContent = mode === "section" ? "Framifrån" : "Snitt";
  toggle.disabled = mode === "section" && !h.frontSvg;

  const view = $("view");
  view.innerHTML = mode === "section" ? h.sectionSvg : (h.frontSvg ?? `<p class="empty">Ingen vy framifrån för detta hål.</p>`);
  const svg = view.querySelector("svg");
  if (svg) {
    attachHover(svg, mode === "section" ? h.sectionSamples : [], {
      sticky: true,
      onSwipe: (dir) => (dir > 0 ? step(1) : step(-1)),
    });
  }
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

$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("toggle").addEventListener("click", () => {
  mode = mode === "section" ? "front" : "section";
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === " " || e.key === "f") {
    mode = mode === "section" ? "front" : "section";
    render();
  }
});

async function init(): Promise<void> {
  const id = params.get("s");
  if (!id) {
    message("Ingen profil angiven. Öppna länken eller QR-koden från skrivbordsappen.");
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
