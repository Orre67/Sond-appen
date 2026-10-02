import "./style.css";
import { classifyFile, downloadText, parseMeshInWorker } from "./app/files";
import { toCsv } from "./core/csv";
import { toDxf } from "./core/dxf";
import { linkHoles } from "./core/project";
import { computeHole, DEFAULT_OPTIONS, type BurdenOptions, type HoleResult } from "./geom/burden";
import { Surface } from "./geom/surface";
import { parseDm4, type SondeProfile } from "./io/dm4";
import type { MeshData } from "./io/mesh";
import { parseMtl } from "./io/obj";
import { parseStartPoints, type StartPoint } from "./io/startpoints";
import { CLASS_COLORS, fmt, holeClass } from "./view/format";
import { renderPlanSvg } from "./view/plan";
import QRCode from "qrcode";
import { uploadShare, type ShareBundle } from "./core/share";
import { attachHover } from "./view/hover";
import { frontLayout, holeInfoText, profileLayout, renderFrontSvg, renderProfile, renderProfileSvg, type ProfileStyle } from "./view/profile";
import { Scene3D } from "./view/scene3d";
import { renderTable } from "./view/table";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Saknar element #${id}`);
  return el as T;
};

interface FileEntry {
  name: string;
  kind: string;
  state: "läser" | "klar" | "fel";
  detail: string;
}

const state = {
  mesh: null as MeshData | null,
  meshName: "",
  surface: null as Surface | null,
  textureUrl: null as string | null,
  textureName: null as string | null,
  mtlTextures: {} as Record<string, string>,
  points: [] as StartPoint[],
  pointsWarnings: [] as string[],
  profiles: new Map<string, SondeProfile[]>(),
  dm4Warnings: new Map<string, string[]>(),
  files: [] as FileEntry[],
  opts: { ...DEFAULT_OPTIONS } as BurdenOptions,
  results: [] as HoleResult[],
  selectedId: null as string | null,
  showAll: false,
  showSkipped: true,
  showTrace: true,
  showSticks: true,
  showFront: true,
  mergeLabels: true,
  linkWarnings: [] as string[],
  unmatchedPoints: [] as string[],
  unmatchedProfiles: [] as string[],
  planBg: null as string | null,
  planBgSurface: null as Surface | null,
};

const scene = new Scene3D($("scene-container"));
scene.onSelect = (id) => selectHole(id, true);

// ---------- Filer ----------

const dropzone = $("dropzone");
const fileInput = $<HTMLInputElement>("file-input");
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("over");
  if (e.dataTransfer) void handleFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files) void handleFiles([...fileInput.files]);
  fileInput.value = "";
});

function setFile(name: string, kind: string, fstate: FileEntry["state"], detail: string): void {
  const existing = state.files.find((f) => f.name === name);
  if (existing) Object.assign(existing, { kind, state: fstate, detail });
  else state.files.push({ name, kind, state: fstate, detail });
  renderFileStatus();
}

async function handleFiles(files: File[]): Promise<void> {
  // Textur och MTL först så att de finns när OBJ-filen är klar.
  const order = (f: File) => {
    const k = classifyFile(f.name);
    return k === "mtl" ? 0 : k === "image" ? 1 : 2;
  };
  files.sort((a, b) => order(a) - order(b));
  for (const file of files) {
    const kind = classifyFile(file.name);
    try {
      switch (kind) {
        case "obj":
        case "landxml":
          await loadMesh(file, kind);
          break;
        case "mtl":
          state.mtlTextures = parseMtl(await file.text());
          setFile(file.name, "Material", "klar", Object.values(state.mtlTextures).join(", ") || "ingen textur");
          break;
        case "image":
          if (state.textureUrl) URL.revokeObjectURL(state.textureUrl);
          state.textureUrl = URL.createObjectURL(file);
          state.textureName = file.name;
          setFile(file.name, "Textur", "klar", `${(file.size / 1e6).toFixed(1)} MB`);
          if (state.surface && state.mesh && state.mesh.source === "obj") {
            scene.setSurface(state.surface, state.mesh, state.textureUrl);
            state.planBg = null;
            schedulePlanBackground();
          }
          break;
        case "dm4": {
          const r = parseDm4(await file.text(), file.name);
          state.profiles.set(file.name, r.profiles);
          state.dm4Warnings.set(file.name, r.warnings);
          setFile(file.name, "Sondering", "klar", `${r.profiles.length} hål: ${r.profiles.map((p) => p.id).join(", ")}`);
          break;
        }
        case "points": {
          const text = await file.text();
          $<HTMLTextAreaElement>("points-text").value = text;
          applyPointsText(text, file.name);
          break;
        }
        default:
          setFile(file.name, "Okänd", "fel", "filtypen känns inte igen");
      }
    } catch (err) {
      setFile(file.name, kind, "fel", err instanceof Error ? err.message : String(err));
    }
  }
  recompute();
}

async function loadMesh(file: File, kind: "obj" | "landxml"): Promise<void> {
  setFile(file.name, kind === "obj" ? "Yta (OBJ)" : "Yta (LandXML)", "läser", `${(file.size / 1e6).toFixed(0)} MB …`);
  const t0 = performance.now();
  const mesh = await parseMeshInWorker(file, kind);
  const surface = Surface.fromMesh(mesh);
  state.mesh = mesh;
  state.meshName = file.name;
  state.surface = surface;
  state.planBg = null;
  const ms = Math.round(performance.now() - t0);
  const b = surface.bounds;
  setFile(
    file.name,
    kind === "obj" ? "Yta (OBJ)" : "Yta (LandXML)",
    "klar",
    `${surface.triangleCount.toLocaleString("sv-SE")} trianglar, ${ms} ms. E ${fmt(b.min[0], 0)}–${fmt(b.max[0], 0)}, N ${fmt(b.min[1], 0)}–${fmt(b.max[1], 0)}, Z ${fmt(b.min[2], 1)}–${fmt(b.max[2], 1)}${mesh.crsName ? `, ${mesh.crsName}` : ""}`,
  );
  scene.setSurface(surface, mesh, kind === "obj" ? state.textureUrl : null);
  schedulePlanBackground();
}

function schedulePlanBackground(): void {
  setTimeout(() => {
    if (!state.surface) return;
    try {
      state.planBg = scene.renderTopDown(state.surface.bounds, 1800);
      state.planBgSurface = state.surface;
    } catch {
      state.planBg = null;
    }
    renderPlan();
  }, 300);
}

$("points-apply").addEventListener("click", () => {
  applyPointsText($<HTMLTextAreaElement>("points-text").value, "Inklistrad text");
  recompute();
});

function applyPointsText(text: string, source: string): void {
  const r = parseStartPoints(text);
  state.points = r.points;
  state.pointsWarnings = r.warnings;
  setFile(source, "Startpunkter", r.points.length > 0 ? "klar" : "fel", `${r.points.length} punkter`);
}

function renderFileStatus(): void {
  const ul = $("file-status");
  ul.innerHTML = state.files
    .map(
      (f) =>
        `<li><span><b>${esc(f.kind)}</b> ${esc(f.name)}</span><span class="${f.state === "fel" ? "err" : f.state === "klar" ? "ok" : ""}">${esc(f.detail)}</span></li>`,
    )
    .join("");
}

// ---------- Inställningar ----------

const optIds = ["opt-interval", "opt-mode", "opt-start", "opt-fine", "opt-min", "opt-max", "opt-corr", "opt-method"];
for (const id of optIds) $(id).addEventListener("change", () => recompute());

function readOptions(): BurdenOptions {
  const num = (id: string, fallback: number) => {
    const v = Number($<HTMLInputElement>(id).value.replace(",", "."));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    ...DEFAULT_OPTIONS,
    interval: Math.max(0.1, num("opt-interval", 1)),
    mode: $<HTMLSelectElement>("opt-mode").value === "point" ? "point" : "stick",
    startDepth: Math.max(0, num("opt-start", 1)),
    fineStep: Math.min(0.5, Math.max(0.01, num("opt-fine", 0.05))),
    minBurden: num("opt-min", 1.5),
    maxBurden: num("opt-max", 3.5),
    bearingCorrection: num("opt-corr", 0),
    method: $<HTMLSelectElement>("opt-method").value === "tangent" ? "tangent" : "average",
  };
}

// ---------- Beräkning ----------

function recompute(): void {
  state.opts = readOptions();
  const profiles = [...state.profiles.values()].flat();
  const link = linkHoles(state.points, profiles);
  state.linkWarnings = link.warnings;
  state.unmatchedPoints = link.unmatchedPoints.map((p) => p.id);
  state.unmatchedProfiles = link.unmatchedProfiles.map((p) => p.id);

  if (state.surface && link.holes.length > 0) {
    const surface = state.surface;
    const t0 = performance.now();
    state.results = [];
    for (const h of link.holes) {
      try {
        state.results.push(computeHole(surface, h, state.opts));
      } catch (err) {
        state.linkWarnings.push(`Hål ${h.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.info(`Beräknade ${state.results.length} hål på ${Math.round(performance.now() - t0)} ms`);
  } else {
    state.results = [];
  }
  if (!state.results.some((r) => r.id === state.selectedId)) state.selectedId = state.results[0]?.id ?? null;

  scene.setResults(state.results, state.opts);
  scene.select(state.selectedId);
  renderHoleList();
  renderWarnings();
  renderProfileView();
  renderPlan();
  renderTableView();
  const has = state.results.length > 0;
  for (const id of ["btn-csv", "btn-svg", "btn-dxf", "btn-print", "btn-share"]) $<HTMLButtonElement>(id).disabled = !has;
}

// ---------- Hål-lista och val ----------

function renderHoleList(): void {
  const ul = $("hole-list");
  const sel = $<HTMLSelectElement>("hole-select");
  ul.innerHTML = state.results
    .map((r) => {
      const cls = holeClass(r, state.opts);
      const low = r.rows.filter((x) => x.cls === "low").length;
      const high = r.rows.filter((x) => x.cls === "high").length;
      return (
        `<li data-id="${esc(r.id)}" class="${r.id === state.selectedId ? "selected" : ""}">` +
        `<span class="dot" style="background:${CLASS_COLORS[cls]}"></span><b>${esc(r.id)}</b>` +
        `<span>min ${fmt(r.minBurden, 2)} m på ${fmt(r.minBurdenDepth, 1)} m</span>` +
        `<span class="counts">${low ? `${low} röda ` : ""}${high ? `${high} blå` : ""}</span></li>`
      );
    })
    .join("");
  for (const li of ul.querySelectorAll<HTMLLIElement>("li")) {
    li.addEventListener("click", () => selectHole(li.dataset.id ?? null, false));
  }
  sel.innerHTML = state.results
    .map((r) => `<option value="${esc(r.id)}"${r.id === state.selectedId ? " selected" : ""}>Hål ${esc(r.id)}  ·  min ${fmt(r.minBurden, 2)} m</option>`)
    .join("");
  const unmatched: string[] = [];
  if (state.unmatchedPoints.length) unmatched.push(`Startpunkter utan sondering: ${state.unmatchedPoints.join(", ")}`);
  if (state.unmatchedProfiles.length) unmatched.push(`Sondering utan startpunkt: ${state.unmatchedProfiles.join(", ")}`);
  if (state.results.length === 0) {
    const missing: string[] = [];
    if (!state.surface) missing.push("yta");
    if (state.points.length === 0) missing.push("startpunkter");
    if (state.profiles.size === 0) missing.push("sondering");
    if (missing.length) unmatched.unshift(`Saknas: ${missing.join(", ")}.`);
  }
  $("unmatched").innerHTML = unmatched.map(esc).join("<br>");
}

function selectHole(id: string | null, focus3d: boolean): void {
  state.selectedId = id;
  scene.select(id);
  const r = state.results.find((x) => x.id === id);
  if (focus3d && r) scene.focusHole(r);
  renderHoleList();
  renderProfileView();
  renderPlan();
  renderTableView();
}

$<HTMLSelectElement>("hole-select").addEventListener("change", (e) => selectHole((e.target as HTMLSelectElement).value, false));
$("prev-hole").addEventListener("click", () => stepHole(-1));
$("next-hole").addEventListener("click", () => stepHole(1));
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === "ArrowLeft") stepHole(-1);
  if (e.key === "ArrowRight") stepHole(1);
});

function stepHole(delta: number): void {
  if (state.results.length === 0) return;
  const i = state.results.findIndex((r) => r.id === state.selectedId);
  const j = (i + delta + state.results.length) % state.results.length;
  selectHole(state.results[j].id, false);
}

$<HTMLInputElement>("show-all").addEventListener("change", (e) => {
  state.showAll = (e.target as HTMLInputElement).checked;
  renderProfileView();
  renderTableView();
});
$<HTMLInputElement>("show-skipped").addEventListener("change", (e) => {
  state.showSkipped = (e.target as HTMLInputElement).checked;
  renderProfileView();
});
$<HTMLInputElement>("show-trace").addEventListener("change", (e) => {
  state.showTrace = (e.target as HTMLInputElement).checked;
  renderProfileView();
});
$<HTMLInputElement>("show-sticks").addEventListener("change", (e) => {
  state.showSticks = (e.target as HTMLInputElement).checked;
  renderProfileView();
});
$<HTMLInputElement>("merge-labels").addEventListener("change", (e) => {
  state.mergeLabels = (e.target as HTMLInputElement).checked;
  renderProfileView();
});
$<HTMLInputElement>("show-front").addEventListener("change", (e) => {
  state.showFront = (e.target as HTMLInputElement).checked;
  renderProfileView();
});

// ---------- Vyer ----------

function profileStyle(): Partial<ProfileStyle> {
  return {
    showSkipped: state.showSkipped,
    showTrace: state.showTrace,
    showSticks: state.showSticks,
    showFront: state.showFront,
    mergeLabelsWithin: state.mergeLabels ? 0.2 : 0,
  };
}

/** Stil för ett hål, med bilden av väggen framifrån renderad ur 3D-modellen. */
function profileStyleFor(r: HoleResult): Partial<ProfileStyle> {
  const style = profileStyle();
  if (!style.showFront) return style;
  try {
    const L = profileLayout(r, state.opts, style);
    const img = scene.renderFront(r.path.collar, L.frame.u, L.frame.n, L.latMin, L.latMax, L.zMin, L.zMax, Math.round(L.fw * 2.5));
    if (img) style.frontImage = img;
  } catch (err) {
    console.warn("Kunde inte rendera väggen framifrån", err);
  }
  return style;
}

function renderProfileView(): void {
  const c = $("profile-container");
  c.classList.toggle("all", state.showAll);
  if (!state.surface || state.results.length === 0) {
    c.innerHTML = `<p class="empty">Läs in yta, startpunkter och sondering så visas profilerna här.</p>`;
    return;
  }
  const list = state.showAll ? state.results : state.results.filter((r) => r.id === state.selectedId);
  const surface = state.surface;
  const rendered = list.map((r) => renderProfile(r, surface, state.opts, profileStyleFor(r)));
  c.innerHTML = rendered.map((x) => `<div class="profile-card">${x.svg}</div>`).join("");
  const svgs = c.querySelectorAll<SVGSVGElement>("svg");
  svgs.forEach((svg, i) => attachHover(svg, rendered[i].samples));
}

function renderPlan(): void {
  const c = $("plan-container");
  if (!state.surface || state.results.length === 0) {
    c.innerHTML = `<p class="empty">Översikten visas när en yta och hål finns.</p>`;
    return;
  }
  const bg = state.planBg && state.planBgSurface === state.surface ? { dataUrl: state.planBg } : null;
  c.innerHTML = renderPlanSvg(state.results, state.opts, state.surface.bounds, bg, state.selectedId);
  for (const g of c.querySelectorAll<SVGGElement>("g.plan-hole")) {
    g.addEventListener("click", () => selectHole(g.dataset.id ?? null, false));
  }
}

function renderTableView(): void {
  $("table-container").innerHTML = renderTable(state.results, state.selectedId, state.showAll);
}

function renderWarnings(): void {
  const all = [
    ...(state.mesh?.warnings ?? []),
    ...state.pointsWarnings,
    ...[...state.dm4Warnings.values()].flat(),
    ...state.linkWarnings,
  ];
  $("warnings").innerHTML = all.map((w) => `<li>${esc(w)}</li>`).join("");
}

// ---------- Flikar ----------

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b === btn);
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.id === `tab-${btn.dataset.tab}`);
    if (btn.dataset.tab === "scene") scene.resize();
  });
}

// ---------- Export ----------

$("btn-csv").addEventListener("click", () => {
  downloadText(`forsattning-${datestamp()}.csv`, "﻿" + toCsv(state.results), "text/csv");
});
$("btn-svg").addEventListener("click", () => {
  const r = state.results.find((x) => x.id === state.selectedId);
  if (!r || !state.surface) return;
  downloadText(`profil-hal-${r.id}.svg`, renderProfileSvg(r, state.surface, state.opts, profileStyleFor(r)), "image/svg+xml");
});
$("btn-dxf").addEventListener("click", () => {
  downloadText(`kontroll-${datestamp()}.dxf`, toDxf(state.results, { startDepth: state.opts.startDepth }), "application/dxf");
});
$("btn-print").addEventListener("click", () => {
  const wasAll = state.showAll;
  state.showAll = true;
  renderProfileView();
  setTimeout(() => {
    window.print();
    state.showAll = wasAll;
    renderProfileView();
  }, 100);
});

$("btn-share").addEventListener("click", () => void shareToMobile());

/** Ritar alla profiler i stående format, skickar paketet till servern och visar länk och QR-kod. */
async function shareToMobile(): Promise<void> {
  if (!state.surface || state.results.length === 0) return;
  const btn = $<HTMLButtonElement>("btn-share");
  btn.disabled = true;
  btn.textContent = "Ritar profiler …";
  try {
    const bundle = buildShareBundle();
    btn.textContent = "Skickar …";
    const res = await uploadShare(bundle);
    const lan = res.urls.find((u) => !u.includes("localhost")) ?? res.urls[0];
    $("share-links").innerHTML = res.urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("<br>");
    await QRCode.toCanvas($<HTMLCanvasElement>("share-qr"), lan, { width: 170, margin: 1 });
    $("share-result").classList.remove("hidden");
  } catch (err) {
    alert(`Delningen misslyckades: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Dela profilerna";
  }
}

function buildShareBundle(): ShareBundle {
  const surface = state.surface!;
  const base: Partial<ProfileStyle> = { ...profileStyle(), width: 420, height: 740, compact: true, showFront: false };
  const holes = state.results.map((r) => {
    const section = renderProfile(r, surface, state.opts, base);
    let frontSvg: string | null = null;
    try {
      const L = frontLayout(r, state.opts, { width: 420, height: 740, compact: true, showTrace: state.showTrace, showSkipped: state.showSkipped });
      const img = scene.renderFront(r.path.collar, L.frame.u, L.frame.n, L.latMin, L.latMax, L.zMin, L.zMax, Math.round(L.fw * 2.2));
      frontSvg = renderFrontSvg(r, state.opts, { compact: true, showTrace: state.showTrace }, L, img ?? undefined);
    } catch (err) {
      console.warn(`Hål ${r.id}: ingen vy framifrån`, err);
    }
    return {
      id: r.id,
      minBurden: r.minBurden,
      minBurdenDepth: r.minBurdenDepth,
      cls: holeClass(r, state.opts),
      info: holeInfoText(r),
      sectionSvg: section.svg,
      sectionSamples: section.samples,
      frontSvg,
    };
  });
  return {
    version: 1,
    name: state.meshName.replace(/\.[^.]+$/, "") || "salva",
    created: new Date().toISOString(),
    opts: {
      interval: state.opts.interval,
      mode: state.opts.mode,
      minBurden: state.opts.minBurden,
      maxBurden: state.opts.maxBurden,
      startDepth: state.opts.startDepth,
    },
    rule: `Rött < ${fmt(state.opts.minBurden, 1)} m, blått > ${fmt(state.opts.maxBurden, 1)} m, från ${fmt(state.opts.startDepth, 1)} m djup`,
    holes,
  };
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

recompute();

// ---------- Startparametrar: ?tab=scene och, i utvecklingsläge, ?demo=<bas>&files=<fil,fil,...> ----------

const params = new URLSearchParams(location.search);
const startTab = params.get("tab");
if (startTab) document.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${startTab}"]`)?.click();

if (import.meta.env.DEV && params.get("demo")) {
  const base = params.get("demo")!;
  const names = (params.get("files") ?? "").split(",").filter(Boolean);
  void (async () => {
    const files: File[] = [];
    for (const n of names) {
      const res = await fetch(base + encodeURI(n));
      if (!res.ok) {
        setFile(n, "Demo", "fel", `kunde inte hämtas (${res.status})`);
        continue;
      }
      files.push(new File([await res.blob()], n.split("/").pop()!));
    }
    await handleFiles(files);
    if (startTab) document.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${startTab}"]`)?.click();
  })();
}
