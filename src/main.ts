import "./style.css";
import { classifyFile, downloadText, parseMeshInWorker } from "./app/files";
import { toCsv } from "./core/csv";
import { toDxf } from "./core/dxf";
import { checkCollars } from "./core/check";
import { applyRenames, assignNumber, clearNumbers, numberUnnumbered, type Applied, type NamedPoint, type Renames } from "./core/numbering";
import { linkHoles, replacedLogEntries, rigReferences, rigStartPoints, type RigReference } from "./core/project";
import { History } from "./core/history";
import { computeHole, DEFAULT_OPTIONS, type BurdenOptions, type HoleResult, type RigLines } from "./geom/burden";
import { autoBearingCorrection, describeCorrection, type AutoBearingCorrection } from "./geom/geodesy";
import { buildHolePath, type HoleInput } from "./geom/hole";
import { Surface } from "./geom/surface";
import type { Vec3 } from "./geom/vec";
import { parseDm4, type SondeProfile } from "./io/dm4";
import { parseIredes, sniffXml, type IredesFile, type IredesHole } from "./io/iredes";
import type { Bounds, MeshData } from "./io/mesh";
import { parseMtl } from "./io/obj";
import { normalizeId, parseStartPoints, type StartPoint } from "./io/startpoints";
import { CLASS_COLORS, fmt, holeClass } from "./view/format";
import { blastBearingFromLine, planFrame, renderPlanSvg, rotatedExtent, type PlanFrame, type PlanPoint } from "./view/plan";
import QRCode from "qrcode";
import { publishEntry, unpublishEntry, uploadShare, type ShareBundle, type SharePlan } from "./core/share";
import { dateFromFileName, suggestSalva } from "./core/catalog";
import { attachHover } from "./view/hover";
import { sectionSegments } from "./geom/section";
import {
  frontLayout,
  holeInfoText,
  profileLayout,
  renderFrontSvg,
  renderProfile,
  renderProfileSvg,
  sectionWindowFor,
  signedDeg,
  type ProfileStyle,
} from "./view/profile";
import { Scene3D, type RigLine } from "./view/scene3d";
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
  collarWarnings: [] as string[],
  profiles: new Map<string, SondeProfile[]>(),
  dm4Warnings: new Map<string, string[]>(),
  /** Riggens borrplaner och kvalitetsloggar (IREDES), per filnamn, och deras uppgifter per hålnamn. */
  rigFiles: new Map<string, IredesFile>(),
  rigRefs: new Map<string, RigReference>(),
  files: [] as FileEntry[],
  opts: { ...DEFAULT_OPTIONS } as BurdenOptions,
  /** Inställningsfältens värden vid senaste omräkning, underlag för ångra. */
  form: {} as Record<string, string>,
  /** Automatisk bäringskorrektion: kryssrutan och underlaget för aktuell ytmodell och sonderingsdatum. */
  autoCorr: false,
  autoInfo: null as AutoBearingCorrection | null,
  results: [] as HoleResult[],
  /** Det som visas i 3D och översikt: resultaten, eller bara hålbanorna när ytmodell saknas. */
  sceneResults: [] as HoleResult[],
  selectedId: null as string | null,
  /** Markerad startpunkt utan beräknat hål, ursprungs-id, för borttagning i översikten. */
  selectedSource: null as string | null,
  /** Borttagna hål, normaliserade ursprungs-id, sparas per plats i webbläsaren. */
  removed: new Set<string>(),
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
  /** Omnumrering av startpunkter, per startpunktsfil (pointsSource), sparas i webbläsaren. */
  renames: new Map() as Renames,
  pointsSource: "",
  applied: { numbered: [], unnumbered: [] } as Applied,
  /** Hål-id -> id i filen för omnumrerade hål. */
  sourceIds: new Map<string, string>(),
  /** Skjutriktning i grader, per ytmodell, sparas i webbläsaren. */
  blastBearing: null as number | null,
  blastBearingFor: null as string | null,
  numbering: null as { next: number } | null,
  drawingDirection: false,
  /** Översiktens zoom och läge som viewBox, null = hela ytan. */
  planView: null as { x: number; y: number; w: number; h: number } | null,
};

const scene = new Scene3D($("scene-container"));
scene.onSelect = (id) => selectBySource(pickInStack(state.sourceIds.get(id) ?? id), true);
scene.onSelectPoint = (source) => selectBySource(pickInStack(source), true);
// Texturen läses in asynkront. Ortofotot och vyerna framifrån som renderats innan dess är svarta, så rita om.
scene.onTextureLoaded = () => {
  state.planBg = null;
  schedulePlanBackground();
  renderProfileView();
};

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
        case "xml": {
          // En .xml kan vara en LandXML-yta eller en IREDES-fil från riggen: avgörs på innehållet.
          const sniffed = sniffXml(await file.slice(0, 4096).text());
          if (sniffed === "landxml") await loadMesh(file, "landxml");
          else if (sniffed === "iredes-plan" || sniffed === "iredes-quality") loadRigFile(file.name, await file.text());
          else setFile(file.name, "XML", "fel", "varken LandXML-yta eller IREDES-borrplan/kvalitetslogg");
          break;
        }
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

/** Borrplan eller kvalitetslogg från riggen. Planen är vad som skulle borras, loggen vad riggen registrerade som borrat. */
function loadRigFile(name: string, text: string): void {
  const f = parseIredes(text, name);
  state.rigFiles.set(name, f);
  const what = f.kind === "plan" ? "Borrplan (IREDES)" : "Kvalitetslogg (IREDES)";
  const parts = [`${f.holes.length} hål`, f.planName, f.equipment, ...f.warnings].filter((p): p is string => !!p);
  setFile(name, what, "klar", parts.join(" · "));
  // Utan startpunktsfil hör omnumreringen till riggens plannamn.
  if (!state.pointsSource) {
    state.renames = loadRenames(renamesSource());
    state.removed = loadRemoved(renamesSource());
  }
}

/** Startpunktsfilens punkter utom de borttagna. */
function activePoints(): StartPoint[] {
  return state.points.filter((p) => !state.removed.has(normalizeId(p.id)));
}

/** Alla startpunkter som kan numreras om: startpunktsfilen och riggens hål som saknas där, utom borttagna. */
function basePoints(): StartPoint[] {
  const active = activePoints();
  return [...active, ...rigStartPoints(state.rigRefs, active)];
}

/** Riggens raka linjer för ett hål, när plan eller logg finns. */
function rigLinesFor(id: string): RigLines | undefined {
  const ref = state.rigRefs.get(normalizeId(id));
  if (!ref || (!ref.plan && !ref.quality)) return undefined;
  const line = (h: IredesHole | undefined) => (h ? { start: h.start, end: h.end } : undefined);
  return { plan: line(ref.plan), quality: line(ref.quality) };
}

/** Riggens linjer av ett slag, för 3D-vyn och översikten, märkta med hålets gällande nummer efter omnumrering. */
function rigLines(kind: "plan" | "quality"): RigLine[] {
  const current = new Map(state.applied.numbered.map((p) => [normalizeId(p.sourceId), p.id]));
  const out: RigLine[] = [];
  for (const ref of state.rigRefs.values()) {
    const h = ref[kind];
    if (h) out.push({ id: current.get(normalizeId(h.id)) ?? `(${h.id})`, source: h.id, start: h.start, end: h.end });
  }
  return out;
}

/** Utan yta finns ingen försättning, men hålbanorna kan ändå byggas och visas i 3D mot riggens linjer. */
function pathOnlyResults(holes: HoleInput[]): HoleResult[] {
  const out: HoleResult[] = [];
  for (const h of holes) {
    try {
      const path = buildHolePath(h, { method: state.opts.method, bearingCorrection: state.opts.bearingCorrection });
      out.push({ id: h.id, path, rows: [], fine: [], minBurden: null, minBurdenDepth: null, reference: rigLinesFor(state.sourceIds.get(h.id) ?? h.id) });
    } catch {
      // Ogiltig sondering, hoppas över här; felet visas när ytan finns.
    }
  }
  return out;
}

async function loadMesh(file: File, kind: "obj" | "landxml"): Promise<void> {
  setFile(file.name, kind === "obj" ? "Yta (OBJ)" : "Yta (LandXML)", "läser", `${(file.size / 1e6).toFixed(0)} MB …`);
  const t0 = performance.now();
  const mesh = await parseMeshInWorker(file, kind);
  const surface = Surface.fromMesh(mesh);
  state.mesh = mesh;
  state.planView = null;
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
    // Väntar texturen fortfarande kommer onTextureLoaded att schemalägga igen.
    if (!state.surface || !scene.textureReady) return;
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
  state.pointsSource = source;
  state.renames = loadRenames(source);
  state.removed = loadRemoved(source);
  state.numbering = null;
  setFile(source, "Startpunkter", r.points.length > 0 ? "klar" : "fel", `${r.points.length} punkter${r.note ? `, ${r.note}` : ""}`);
}

// ---------- Omnumrering och skjutriktning sparas i webbläsaren, per fil ----------

const renamesKey = (source: string) => `sond-appen:numrering:${source}`;
const bearingKey = (mesh: string) => `sond-appen:skjutriktning:${mesh}`;

/** Nyckel för sparad omnumrering: startpunktsfilen, annars riggens plannamn. */
function renamesSource(): string {
  return state.pointsSource || [...state.rigFiles.values()][0]?.planName || "";
}

const removedKey = (source: string) => `sond-appen:borttagna:${source}`;

function loadRemoved(source: string): Set<string> {
  try {
    const raw = localStorage.getItem(removedKey(source));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Ingen lagring tillgänglig: börja tomt
  }
  return new Set();
}

function saveRemoved(): void {
  try {
    if (state.removed.size === 0) localStorage.removeItem(removedKey(renamesSource()));
    else localStorage.setItem(removedKey(renamesSource()), JSON.stringify([...state.removed]));
  } catch {
    // Ingen lagring tillgänglig
  }
}

/** Tar bort det markerade hålet, oavsett källa, ur allt: beräkning, 3D, profiler, översikt och publicering. */
function removeSelected(): void {
  const source = state.selectedId ? (state.sourceIds.get(state.selectedId) ?? state.selectedId) : state.selectedSource;
  if (!source) return;
  history.apply(`ta bort hål ${source}`, () => {
    state.removed.add(normalizeId(source));
    state.selectedId = null;
    state.selectedSource = null;
    scene.select(null);
    scene.selectSource(null);
    saveRemoved();
    recompute();
  });
}

function restoreRemoved(key: string): void {
  history.apply(`återställ hål ${key}`, () => {
    state.removed.delete(key);
    saveRemoved();
    recompute();
  });
}

/** Hål vars påhugg ligger inom 0,25 m i plan från det givna, som ursprungs-id, i filordning. */
function stackAt(source: string): string[] {
  const pts = [...state.applied.numbered, ...state.applied.unnumbered];
  const me = pts.find((p) => p.sourceId === source);
  if (!me) return [source];
  return pts.filter((p) => Math.hypot(p.e - me.e, p.n - me.n) <= 0.25).map((p) => p.sourceId);
}

/** Klick på en plats med flera hål: första klicket tar det klickade, nästa klick går vidare i stapeln. */
function pickInStack(clicked: string): string {
  const stack = stackAt(clicked);
  if (stack.length < 2) return clicked;
  const current = state.selectedId ? (state.sourceIds.get(state.selectedId) ?? state.selectedId) : state.selectedSource;
  const i = current ? stack.indexOf(current) : -1;
  return i < 0 ? clicked : stack[(i + 1) % stack.length];
}

/** Markerar ett hål via ursprungs-id: som beräknat hål om det finns, annars som punkt. */
function selectBySource(source: string, focus3d: boolean): void {
  const r = state.results.find((x) => (state.sourceIds.get(x.id) ?? x.id) === source);
  if (r) selectHole(r.id, focus3d);
  else selectPoint(source);
}

/** Markerar en startpunkt utan beräknat hål i översikten, så att den kan tas bort. */
function selectPoint(source: string | null): void {
  state.selectedSource = source;
  state.selectedId = null;
  scene.select(null);
  scene.selectSource(source);
  renderHoleList();
  renderPlan();
}

function loadRenames(source: string): Renames {
  try {
    const raw = localStorage.getItem(renamesKey(source));
    if (raw) return new Map(JSON.parse(raw) as [string, string | null][]);
  } catch {
    // Ingen lagring tillgänglig: börja tomt
  }
  return new Map();
}

function saveRenames(): void {
  try {
    if (state.renames.size === 0) localStorage.removeItem(renamesKey(renamesSource()));
    else localStorage.setItem(renamesKey(renamesSource()), JSON.stringify([...state.renames]));
  } catch {
    // Ingen lagring tillgänglig
  }
}

function loadBlastBearing(mesh: string): number | null {
  try {
    const raw = localStorage.getItem(bearingKey(mesh));
    if (raw !== null && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  } catch {
    // Ingen lagring tillgänglig
  }
  return null;
}

/** Nyckel för sparad skjutriktning: ytmodellens namn, annars riggens plannamn. */
function siteKey(): string {
  return state.meshName || [...state.rigFiles.values()][0]?.planName || "";
}

function saveBlastBearing(): void {
  try {
    if (state.blastBearing === null) localStorage.removeItem(bearingKey(siteKey()));
    else localStorage.setItem(bearingKey(siteKey()), String(state.blastBearing));
  } catch {
    // Ingen lagring tillgänglig
  }
}

function setBlastBearing(value: number | null): void {
  state.blastBearing = value;
  state.blastBearingFor = siteKey();
  state.planView = null;
  try {
    if (value === null) localStorage.removeItem(bearingKey(siteKey()));
    else localStorage.setItem(bearingKey(siteKey()), String(value));
  } catch {
    // Ingen lagring tillgänglig
  }
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

const AUTO_KEY = "sond.autoCorrection";
const optIds = ["opt-interval", "opt-mode", "opt-start", "opt-free", "opt-fine", "opt-min", "opt-max", "opt-corr", "opt-auto", "opt-method"];
const OPTION_LABELS: Record<string, string> = {
  "opt-interval": "måttsticka",
  "opt-mode": "mätsätt",
  "opt-start": "startdjup",
  "opt-free": "fri 3D från djup",
  "opt-fine": "söksteg",
  "opt-min": "min försättning",
  "opt-max": "max försättning",
  "opt-corr": "bäringskorrektion",
  "opt-auto": "automatisk bäringskorrektion",
  "opt-method": "metod",
};
for (const id of optIds) {
  $(id).addEventListener("change", () => history.apply(`inställning ${OPTION_LABELS[id] ?? id}`, () => recompute(), id));
}
try {
  $<HTMLInputElement>("opt-auto").checked = localStorage.getItem(AUTO_KEY) === "1";
} catch {
  // Ingen lagring tillgänglig
}
$("opt-auto").addEventListener("change", () => {
  try {
    localStorage.setItem(AUTO_KEY, $<HTMLInputElement>("opt-auto").checked ? "1" : "0");
  } catch {
    // Ingen lagring tillgänglig
  }
});

/** Ett inställningsfälts värde som text: kryssrutor som 1/0. */
function fieldValue(id: string): string {
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  return el instanceof HTMLInputElement && el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value;
}

function setFieldValue(id: string, value: string): void {
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = value === "1";
  else el.value = value;
}

function readOptions(): BurdenOptions {
  state.form = Object.fromEntries(optIds.map((id) => [id, fieldValue(id)]));
  const num = (id: string, fallback: number) => {
    const v = Number($<HTMLInputElement>(id).value.replace(",", "."));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    ...DEFAULT_OPTIONS,
    interval: Math.max(0.1, num("opt-interval", 1)),
    mode: $<HTMLSelectElement>("opt-mode").value === "point" ? "point" : "stick",
    startDepth: Math.max(0, num("opt-start", 1)),
    free3dFromDepth: Math.max(0, num("opt-free", 0)),
    fineStep: Math.min(0.5, Math.max(0.01, num("opt-fine", 0.05))),
    minBurden: num("opt-min", 1.5),
    maxBurden: num("opt-max", 3.5),
    bearingCorrection: num("opt-corr", 0) + (state.autoCorr && state.autoInfo ? state.autoInfo.correction : 0),
    method: $<HTMLSelectElement>("opt-method").value === "tangent" ? "tangent" : "average",
  };
}

/** Sonderingsdatum ur DM4-filernas namn, annars i dag. */
function soundingDate(): Date {
  for (const name of state.profiles.keys()) {
    const d = dateFromFileName(name);
    if (d) {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(y, m - 1, day);
    }
  }
  return new Date();
}

/** Underlaget för Auto: ytmodellens mitt i SWEREF 99 TM och sonderingsdatumet. */
function computeAutoInfo(): AutoBearingCorrection | null {
  if (!state.surface) return null;
  const b = state.surface.bounds;
  return autoBearingCorrection((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, soundingDate());
}

function renderAutoInfo(): void {
  const el = $("auto-info");
  if (!state.surface) {
    el.textContent = state.autoCorr ? "Auto: läs in en ytmodell, platsen tas ur den." : "";
    return;
  }
  if (!state.autoInfo) {
    el.textContent = "Auto: ytmodellens koordinater är inte SWEREF 99 TM, ingen automatisk korrektion.";
    return;
  }
  const prefix = state.autoCorr ? "Auto på: " : "Auto av, skulle ge: ";
  el.textContent = `${prefix}${describeCorrection(state.autoInfo)}. Tillämpad bäringskorrektion ${signedDeg(state.opts.bearingCorrection)}.`;
}

// ---------- Ångra ----------

/** Allt användaren bestämt, i serialiserbar form. Nya beslut läggs till här och blir ångringsbara direkt. */
interface Decisions {
  renames: [string, string | null][];
  removed: string[];
  blastBearing: number | null;
  form: Record<string, string>;
  view: { showAll: boolean; showSkipped: boolean; showTrace: boolean; showSticks: boolean; showFront: boolean; mergeLabels: boolean };
}

function getDecisions(): Decisions {
  return {
    renames: [...state.renames],
    removed: [...state.removed],
    blastBearing: state.blastBearing,
    form: { ...state.form },
    view: {
      showAll: state.showAll,
      showSkipped: state.showSkipped,
      showTrace: state.showTrace,
      showSticks: state.showSticks,
      showFront: state.showFront,
      mergeLabels: state.mergeLabels,
    },
  };
}

function setDecisions(d: Decisions): void {
  state.renames = new Map(d.renames);
  state.removed = new Set(d.removed);
  state.blastBearing = d.blastBearing;
  state.blastBearingFor = siteKey();
  for (const [id, v] of Object.entries(d.form)) setFieldValue(id, v);
  state.showAll = d.view.showAll;
  state.showSkipped = d.view.showSkipped;
  state.showTrace = d.view.showTrace;
  state.showSticks = d.view.showSticks;
  state.showFront = d.view.showFront;
  state.mergeLabels = d.view.mergeLabels;
  $<HTMLInputElement>("show-all").checked = d.view.showAll;
  $<HTMLInputElement>("show-skipped").checked = d.view.showSkipped;
  $<HTMLInputElement>("show-trace").checked = d.view.showTrace;
  $<HTMLInputElement>("show-sticks").checked = d.view.showSticks;
  $<HTMLInputElement>("show-front").checked = d.view.showFront;
  $<HTMLInputElement>("merge-labels").checked = d.view.mergeLabels;
  state.numbering = null;
  saveRenames();
  saveRemoved();
  saveBlastBearing();
  recompute();
}

const history = new History<Decisions>(getDecisions, setDecisions);
history.onChange = () => renderHistoryButtons();

function renderHistoryButtons(): void {
  const undo = $<HTMLButtonElement>("undo");
  const redo = $<HTMLButtonElement>("redo");
  undo.disabled = !history.canUndo;
  redo.disabled = !history.canRedo;
  undo.title = history.undoLabel ? `Ångra: ${history.undoLabel} (Ctrl+Z)` : "Inget att ångra";
  redo.title = history.redoLabel ? `Gör om: ${history.redoLabel} (Ctrl+Y)` : "Inget att göra om";
  $("undo-hint").textContent = history.undoLabel ? `Ångra: ${history.undoLabel}` : "";
}

// ---------- Beräkning ----------

function recompute(): void {
  state.autoCorr = $<HTMLInputElement>("opt-auto").checked;
  state.autoInfo = computeAutoInfo();
  state.opts = readOptions();
  renderAutoInfo();
  // Borttagna hål filtreras bort ur startpunkter och rigg. Sonderingen rörs inte: dess nummer är gällande
  // nummer, och efter omnumrering kan det tillhöra en annan punkt än den borttagna.
  const profiles = [...state.profiles.values()].flat();
  // Riggens plan och logg matchas mot startpunktsfilens ursprungliga nummer och ger startpunkter för hål som saknas där.
  // Omnumreringen gäller sedan alla punkter lika, från fil och från rigg.
  state.rigRefs = rigReferences([...state.rigFiles.values()], activePoints());
  for (const key of state.removed) state.rigRefs.delete(key);
  state.applied = applyRenames(basePoints(), state.renames);
  state.sourceIds = new Map(state.applied.numbered.filter((p) => p.sourceId !== p.id).map((p) => [p.id, p.sourceId]));
  const link = linkHoles(state.applied.numbered, profiles);
  state.linkWarnings = link.warnings;
  // Bara startpunktsfilens punkter listas som utan sondering; riggens hål är många och syns i översikten ändå.
  const txtSources = new Set(state.points.map((p) => normalizeId(p.id)));
  state.unmatchedPoints = link.unmatchedPoints.filter((p) => txtSources.has(normalizeId((p as NamedPoint).sourceId ?? p.id))).map((p) => p.id);
  state.unmatchedProfiles = link.unmatchedProfiles.map((p) => p.id);
  // Påhugg som inte ligger på ytmodellen avslöjar fel koordinater som ingen filtolkning kan se.
  state.collarWarnings = state.surface ? checkCollars(state.surface, link.holes) : [];

  if (state.surface && link.holes.length > 0) {
    const surface = state.surface;
    const t0 = performance.now();
    state.results = [];
    for (const h of link.holes) {
      try {
        const r = computeHole(surface, h, state.opts);
        if (state.autoCorr && state.autoInfo && Math.abs(state.autoInfo.correction) > 1e-9) {
          r.ghost = buildHolePath(h, { method: state.opts.method, bearingCorrection: state.opts.bearingCorrection - state.autoInfo.correction });
        }
        r.reference = rigLinesFor(state.sourceIds.get(h.id) ?? h.id);
        state.results.push(r);
      } catch (err) {
        state.linkWarnings.push(`Hål ${h.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.info(`Beräknade ${state.results.length} hål på ${Math.round(performance.now() - t0)} ms`);
  } else {
    state.results = [];
  }
  if (!state.results.some((r) => r.id === state.selectedId)) state.selectedId = state.results[0]?.id ?? null;

  // Utan yta visas ändå hålbanorna och riggens linjer i 3D, så att sondering och logg kan jämföras.
  const planLines = rigLines("plan");
  const qualityLines = rigLines("quality");
  const sceneResults = state.surface ? state.results : pathOnlyResults(link.holes);
  state.sceneResults = sceneResults;
  if (!state.surface) {
    scene.frameWithoutSurface([
      ...sceneResults.flatMap((r) => r.path.points),
      ...[...planLines, ...qualityLines].flatMap((l) => [l.start, l.end]),
      ...state.applied.numbered.map((p): Vec3 => [p.e, p.n, p.z]),
    ]);
  }
  scene.setRigLines(planLines, qualityLines);
  scene.setResults(sceneResults, state.opts);
  scene.setPoints(pointsWithoutHole().map((p) => ({ id: p.id ?? `(${p.sourceId})`, source: p.sourceId, e: p.e, n: p.n, z: p.z })));
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

/** Hål vars påhugg ligger inom 0,25 m i plan från ett annat: gällande id -> de andras id. */
function duplicateMap(): Map<string, string[]> {
  const pts = [...state.applied.numbered, ...state.applied.unnumbered];
  const out = new Map<string, string[]>();
  for (let i = 0; i < pts.length; i++) {
    const others: string[] = [];
    for (let j = 0; j < pts.length; j++) {
      if (i !== j && Math.hypot(pts[i].e - pts[j].e, pts[i].n - pts[j].n) <= 0.25) others.push(pts[j].id);
    }
    if (others.length) out.set(pts[i].id, others);
  }
  return out;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "okänd tid";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** Listan över borttagna hål: manuellt borttagna med återställning, och loggningar som ersatts av en senare. */
function renderRemovedPanel(): void {
  const panel = $<HTMLDetailsElement>("removed-panel");
  const ul = $("removed-list");
  const manual = [...state.removed].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const replaced = replacedLogEntries([...state.rigFiles.values()]);
  panel.hidden = manual.length === 0 && replaced.length === 0;
  if (!panel.hidden) panel.open = true;
  $("removed-summary").textContent = `Borttagna hål (${manual.length + replaced.length})`;
  ul.innerHTML = [
    ...manual.map((k) => `<li><b>${esc(k)}</b><span>borttaget</span><button class="secondary small" data-restore="${esc(k)}">Återställ</button></li>`),
    ...replaced.map(
      (x) => `<li><b>${esc(x.id)}</b><span>loggning ${esc(fmtTime(x.time))} ersatt av ${esc(fmtTime(x.keptTime))} · ${esc(x.source)}</span></li>`,
    ),
  ].join("");
  for (const b of ul.querySelectorAll<HTMLButtonElement>("button[data-restore]")) {
    b.addEventListener("click", () => restoreRemoved(b.dataset.restore ?? ""));
  }
  const btn = $<HTMLButtonElement>("hole-remove");
  const chosen = state.selectedId ?? state.selectedSource;
  btn.disabled = !chosen;
  btn.textContent = chosen ? `Ta bort hål ${chosen}` : "Ta bort hål";
}

function renderHoleList(): void {
  const ul = $("hole-list");
  const sel = $<HTMLSelectElement>("hole-select");
  const dup = duplicateMap();
  ul.innerHTML = state.results
    .map((r) => {
      const cls = holeClass(r, state.opts);
      const low = r.rows.filter((x) => x.cls === "low").length;
      const high = r.rows.filter((x) => x.cls === "high").length;
      return (
        `<li data-id="${esc(r.id)}" class="${r.id === state.selectedId ? "selected" : ""}">` +
        `<span class="dot" style="background:${CLASS_COLORS[cls]}"></span><b>${esc(r.id)}</b>` +
        `<span>min ${fmt(r.minBurden, 2)} m på ${fmt(r.minBurdenDepth, 1)} m</span>` +
        `<span class="counts">${low ? `${low} röda ` : ""}${high ? `${high} blå` : ""}</span>` +
        `${dup.has(r.id) ? `<span class="counts">samma läge som ${esc(dup.get(r.id)!.join(", "))}</span>` : ""}</li>`
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
  if (state.applied.unnumbered.length) unmatched.push(`Utan nummer: ${state.applied.unnumbered.length} startpunkter (numrera i Översikt)`);
  // Sparade beslut som styr vad som visas: de ligger kvar i webbläsaren mellan sessionerna och ska aldrig vara osynliga.
  if (state.removed.size) unmatched.push(`Borttagna hål: ${[...state.removed].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ")} (återställ nedan)`);
  if (state.renames.size) unmatched.push(`Omnumrering aktiv för ${state.renames.size} startpunkter (Originalnummer i Översikt tar bort den)`);
  if (state.results.length === 0) {
    const missing: string[] = [];
    if (!state.surface) missing.push("yta");
    if (state.points.length === 0 && state.rigFiles.size === 0) missing.push("startpunkter");
    if (state.profiles.size === 0) missing.push("sondering");
    if (missing.length) unmatched.unshift(`Saknas: ${missing.join(", ")}.`);
  }
  $("unmatched").innerHTML = unmatched.map(esc).join("<br>");
  renderRemovedPanel();
}

function selectHole(id: string | null, focus3d: boolean): void {
  state.selectedId = id;
  state.selectedSource = null;
  scene.select(id);
  scene.selectSource(null);
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
  if (e.key === "Delete") removeSelected();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    history.redo();
  }
});
$("undo").addEventListener("click", () => history.undo());
$("redo").addEventListener("click", () => history.redo());

function stepHole(delta: number): void {
  if (state.results.length === 0) return;
  const i = state.results.findIndex((r) => r.id === state.selectedId);
  const j = (i + delta + state.results.length) % state.results.length;
  selectHole(state.results[j].id, false);
}

// Visningsvalen är beslut som alla andra: ångringsbara, en kryssruta i taget.
const VIEW_TOGGLES: [string, keyof Decisions["view"], string][] = [
  ["show-all", "showAll", "visa alla"],
  ["show-skipped", "showSkipped", "ovanför startdjup"],
  ["show-trace", "showTrace", "ytspår"],
  ["show-sticks", "showSticks", "stickor"],
  ["merge-labels", "mergeLabels", "en siffra per ytpunkt"],
  ["show-front", "showFront", "framifrån"],
];
for (const [id, key, label] of VIEW_TOGGLES) {
  $<HTMLInputElement>(id).addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    history.apply(`visning: ${label} ${checked ? "på" : "av"}`, () => {
      state[key] = checked;
      renderProfileView();
      if (key === "showAll") renderTableView();
    });
  });
}

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

/** Startpunkter som inte blev beräknade hål: utan sondering, eller utan nummer. */
function pointsWithoutHole(): (PlanPoint & { z: number })[] {
  // Jämför mot det som visas: utan ytmodell finns inga resultat men väl hålbanor, och de ska inte dubbleras som punkter.
  const has = new Set(state.sceneResults.map((r) => r.id));
  return [
    ...state.applied.numbered.filter((p) => !has.has(p.id)).map((p) => ({ id: p.id, sourceId: p.sourceId, e: p.e, n: p.n, z: p.z })),
    ...state.applied.unnumbered.map((p) => ({ id: null, sourceId: p.sourceId, e: p.e, n: p.n, z: p.z })),
  ];
}

/** Hålens utbredning när ytmodell saknas: sonderingar, riggens linjer och startpunkter, med marginal. */
function holeBounds(): Bounds | null {
  const pts: Vec3[] = [
    ...state.sceneResults.flatMap((r) => r.path.points),
    ...[...rigLines("plan"), ...rigLines("quality")].flatMap((l) => [l.start, l.end]),
    ...state.applied.numbered.map((p): Vec3 => [p.e, p.n, p.z]),
  ];
  if (pts.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  const m = 4;
  return { min: [min[0] - m, min[1] - m, min[2]], max: [max[0] + m, max[1] + m, max[2]] };
}

function renderPlan(): void {
  const c = $("plan-container");
  if (state.blastBearingFor !== siteKey()) {
    state.blastBearing = loadBlastBearing(siteKey());
    state.blastBearingFor = siteKey();
  }
  updatePlanToolbar();
  // Utan yta byggs ramen av hålen själva: sonderingar, riggens linjer och startpunkter.
  const bounds = state.surface ? state.surface.bounds : holeBounds();
  if (!bounds) {
    c.innerHTML = `<p class="empty">Översikten visas när en yta, en borrplan eller en kvalitetslogg är inläst.</p>`;
    return;
  }
  const points = pointsWithoutHole();
  const bg = state.surface && state.planBg && state.planBgSurface === state.surface ? { dataUrl: state.planBg } : null;
  // Ramen följer modellens verkliga utbredning i den vridna vyn, inte dess rektangel i E N.
  const extent = state.surface && state.mesh ? rotatedExtent(state.mesh.positions, bounds, state.blastBearing, 4) : null;
  const frame = planFrame(bounds, state.blastBearing, 3, extent);
  const toPlanLine = (l: RigLine) => ({ id: l.id, e0: l.start[0], n0: l.start[1], e1: l.end[0], n1: l.end[1] });
  c.innerHTML = renderPlanSvg(state.sceneResults, state.opts, bounds, bg, state.selectedId, {
    bearing: state.blastBearing,
    points,
    sourceIds: state.sourceIds,
    numbering: state.numbering !== null,
    extent,
    selectedSource: state.selectedSource,
    rigLines: { plan: rigLines("plan").map(toPlanLine), quality: rigLines("quality").map(toPlanLine) },
    modelFrame: state.surface !== null,
  });
  const svg = c.querySelector("svg");
  if (!svg) return;
  if (state.planView) {
    const v = state.planView;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }
  for (const g of c.querySelectorAll<SVGGElement>("g.plan-hole, g.plan-point")) {
    g.addEventListener("click", (e) => {
      if (state.drawingDirection || planDragged) return;
      if (state.numbering) {
        e.stopPropagation();
        numberPoint(g.dataset.source ?? "");
        return;
      }
      const clicked = g.dataset.source ?? g.dataset.id ?? "";
      if (clicked) selectBySource(pickInStack(clicked), false);
    });
  }
  attachPlanNavigation(svg, frame);
  attachDirectionDrawing(svg, frame);
}

let planDragged = false;

/** Scrollhjulet zoomar kring pekaren, dra flyttar kartan, dubbelklick visar hela ytan. */
function attachPlanNavigation(svg: SVGSVGElement, frame: PlanFrame): void {
  const fit = { x: 0, y: 0, w: frame.w, h: frame.h };
  const view = () => state.planView ?? fit;
  const apply = (v: { x: number; y: number; w: number; h: number } | null) => {
    state.planView = v;
    const b = v ?? fit;
    svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  };
  const toView = (clientX: number, clientY: number): [number, number] | null => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = toView(e.clientX, e.clientY);
      if (!p) return;
      const v = view();
      const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const w = Math.min(fit.w * 2, Math.max(fit.w / 60, v.w * k));
      const s = w / v.w;
      apply({ x: p[0] - (p[0] - v.x) * s, y: p[1] - (p[1] - v.y) * s, w, h: v.h * s });
    },
    { passive: false },
  );
  let drag: { x: number; y: number; view: { x: number; y: number; w: number; h: number }; scale: number } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    if (state.drawingDirection || e.button !== 0) return;
    // Annars börjar webbläsaren markera etiketterna när kartan dras
    e.preventDefault();
    const m = svg.getScreenCTM();
    drag = { x: e.clientX, y: e.clientY, view: view(), scale: m ? 1 / m.a : 0 };
    planDragged = false;
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!planDragged && Math.hypot(dx, dy) < 4) return;
    if (!planDragged) {
      planDragged = true;
      svg.setPointerCapture(e.pointerId);
    }
    apply({ ...drag.view, x: drag.view.x - dx * drag.scale, y: drag.view.y - dy * drag.scale });
  });
  const stop = () => {
    drag = null;
    // Klicket som följer på ett drag ska varken välja eller numrera ett hål
    if (planDragged) setTimeout(() => (planDragged = false), 0);
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
  svg.addEventListener("dblclick", () => apply(null));
}

/** Numreringsläge: klickad punkt får nästa nummer, upptagna nummer hoppas över. */
function numberPoint(sourceId: string): void {
  if (!state.numbering || !sourceId) return;
  const numbering = state.numbering;
  history.apply(`numrera hål ${sourceId}`, () => {
    const n = assignNumber(state.renames, basePoints(), sourceId, numbering.next);
    numbering.next = n + 1;
    saveRenames();
    recompute();
  });
}

function numberFrom(): number {
  const v = Number($<HTMLInputElement>("num-from").value);
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 1;
}

/** Rita skjutriktning: dra en linje längs raden, riktningen blir vinkelrät mot den och kartan vrids. */
function attachDirectionDrawing(svg: SVGSVGElement, F: PlanFrame): void {
  const overlay = svg.querySelector("#plan-overlay");
  let start: [number, number] | null = null;
  const toView = (e: PointerEvent): [number, number] | null => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  svg.addEventListener("pointerdown", (e) => {
    if (!state.drawingDirection) return;
    start = toView(e);
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!start || !overlay) return;
    const p = toView(e);
    if (!p) return;
    overlay.innerHTML = `<line x1="${start[0].toFixed(2)}" y1="${start[1].toFixed(2)}" x2="${p[0].toFixed(2)}" y2="${p[1].toFixed(2)}" stroke="#e08a1e" stroke-width="0.35" stroke-dasharray="0.8 0.5"/>`;
  });
  const end = (e: PointerEvent) => {
    if (!start) return;
    const s = start;
    start = null;
    if (overlay) overlay.innerHTML = "";
    const p = toView(e);
    if (!p) return;
    const [e0, n0] = F.toWorld(s[0], s[1]);
    const [e1, n1] = F.toWorld(p[0], p[1]);
    if (Math.hypot(e1 - e0, n1 - n0) < 1) return; // för kort för att vara en riktning
    const drawn = blastBearingFromLine(e0, n0, e1, n1);
    history.apply(`skjutriktning ${drawn}°`, () => setBlastBearing(drawn));
    state.drawingDirection = false;
    renderPlan();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", () => {
    start = null;
    if (overlay) overlay.innerHTML = "";
  });
}

function updatePlanToolbar(): void {
  const input = $<HTMLInputElement>("blast-bearing");
  if (document.activeElement !== input) input.value = state.blastBearing === null ? "" : String(state.blastBearing);
  $("blast-draw").classList.toggle("active", state.drawingDirection);
  const start = $<HTMLButtonElement>("num-start");
  start.classList.toggle("active", state.numbering !== null);
  start.textContent = state.numbering ? `Numrerar, nästa ${state.numbering.next}` : "Numrera om";
  const unnumbered = state.applied.unnumbered.length;
  const rest = $<HTMLButtonElement>("num-rest");
  rest.disabled = unnumbered === 0;
  rest.textContent = unnumbered ? `Numrera ${unnumbered} onumrerade` : "Numrera onumrerade";
  $<HTMLButtonElement>("num-reset").disabled = state.renames.size === 0;
  $("plan-hint").textContent = state.drawingDirection
    ? "Dra en linje längs raden från höger till vänster. Skjutriktningen blir vinkelrät mot linjen."
    : state.numbering
      ? `Klicka på hålen i tur och ordning. Nästa nummer: ${state.numbering.next}. Upptagna nummer hoppas över. Esc avslutar.`
      : "";
  const c = $("plan-container");
  c.classList.toggle("numbering", state.numbering !== null);
  c.classList.toggle("drawing", state.drawingDirection);
}

$("plan-fit").addEventListener("click", () => {
  state.planView = null;
  renderPlan();
});
$<HTMLInputElement>("blast-bearing").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).value.trim();
  const n = Number(v);
  const value = v === "" || !Number.isFinite(n) ? null : ((Math.round(n) % 360) + 360) % 360;
  history.apply(value === null ? "skjutriktning borttagen" : `skjutriktning ${value}°`, () => {
    setBlastBearing(value);
    renderPlan();
  }, "blast");
});
$("blast-draw").addEventListener("click", () => {
  state.drawingDirection = !state.drawingDirection;
  state.numbering = null;
  renderPlan();
});
$("num-start").addEventListener("click", () => {
  state.numbering = state.numbering ? null : { next: numberFrom() };
  state.drawingDirection = false;
  renderPlan();
});
$("num-rest").addEventListener("click", () => {
  history.apply("numrera onumrerade", () => {
    numberUnnumbered(state.renames, basePoints());
    saveRenames();
    recompute();
  });
});
$("num-clear").addEventListener("click", () => {
  history.apply("nollställ numrering", () => {
    clearNumbers(state.renames, basePoints());
    saveRenames();
    recompute();
  });
  state.numbering = { next: numberFrom() };
  state.drawingDirection = false;
  renderPlan();
});
$("hole-remove").addEventListener("click", () => removeSelected());
$("num-reset").addEventListener("click", () => {
  history.apply("originalnummer", () => {
    state.renames = new Map();
    saveRenames();
    state.numbering = null;
    recompute();
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (state.numbering || state.drawingDirection)) {
    state.numbering = null;
    state.drawingDirection = false;
    renderPlan();
  }
});

function renderTableView(): void {
  $("table-container").innerHTML = renderTable(state.results, state.selectedId, state.showAll);
}

function renderWarnings(): void {
  const all = [
    ...(state.mesh?.warnings ?? []),
    ...state.pointsWarnings,
    ...state.collarWarnings,
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

const SHARE_KEY_STORAGE = "sond-appen:delningsnyckel";

/** Delningsnyckeln (SHARE_KEY på servern) frågas efter en gång och sparas i webbläsaren. */
async function shareKey(): Promise<string | null> {
  let key = localStorage.getItem(SHARE_KEY_STORAGE);
  if (!key) {
    key = window.prompt("Delningsnyckel (samma som SHARE_KEY på servern):")?.trim() ?? null;
    if (key) localStorage.setItem(SHARE_KEY_STORAGE, key);
  }
  return key || null;
}

let publishedId: string | null = null;

/** Publiceringsrutan: plats, inmätningsdatum och anteckning, förifyllda ur filnamnen. */
function askPublishInfo(): Promise<{ site: string; date: string; note: string } | null> {
  const dlg = $<HTMLDialogElement>("publish-dialog");
  const suggestion = suggestSalva([...state.profiles.keys()], state.meshName);
  const site = $<HTMLInputElement>("pub-site");
  const date = $<HTMLInputElement>("pub-date");
  const note = $<HTMLInputElement>("pub-note");
  site.value = suggestion.site;
  date.value = suggestion.date;
  note.value = "";
  return new Promise((resolve) => {
    dlg.addEventListener(
      "close",
      () => resolve(dlg.returnValue === "ok" ? { site: site.value.trim(), date: date.value, note: note.value.trim() } : null),
      { once: true },
    );
    dlg.showModal();
  });
}

/** Ritar alla profiler i stående format, laddar upp paketet, lägger inmätningen i listan och visar länk och QR-kod. */
async function shareToMobile(): Promise<void> {
  if (!state.surface || state.results.length === 0) return;
  if (!scene.textureReady) {
    alert("Texturen läses fortfarande in. Vänta en stund och försök igen, annars blir vyerna framifrån svarta.");
    return;
  }
  const info = await askPublishInfo();
  if (!info || !info.site || !info.date) return;
  const btn = $<HTMLButtonElement>("btn-share");
  btn.disabled = true;
  btn.textContent = "Ritar profiler …";
  try {
    const bundle = buildShareBundle(info);
    btn.textContent = "Skickar …";
    const res = await uploadShare(bundle, shareKey);
    btn.textContent = "Publicerar …";
    await publishEntry({ id: res.id, site: info.site, date: info.date, note: info.note, holes: state.results.length }, shareKey);
    publishedId = res.id;
    const lan = res.urls.find((u) => !u.includes("localhost")) ?? res.urls[0];
    $("share-links").innerHTML =
      `<div><b>${esc(info.site)}</b>, ${esc(info.date)}, finns nu i listan på telefonerna.</div>` +
      res.urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("<br>");
    await QRCode.toCanvas($<HTMLCanvasElement>("share-qr"), lan, { width: 170, margin: 1 });
    $("share-result").classList.remove("hidden");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fel nyckel: servern svarar "Fel delningsnyckel", men Blob-klienten rapporterar det bara som att
    // uppladdningsnyckeln inte kunde hämtas. Glöm den sparade nyckeln i båda fallen så att nästa försök frågar igen.
    const keyProblem = /nyckel|token/i.test(msg);
    if (keyProblem) localStorage.removeItem(SHARE_KEY_STORAGE);
    const hint = keyProblem
      ? "\n\nTroligen fel delningsnyckel. Den sparade nyckeln är bortglömd: tryck Publicera igen och skriv in den på nytt, exakt som SHARE_KEY på servern."
      : "";
    alert(`Publiceringen misslyckades: ${msg}${hint}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Publicera";
  }
}

$("btn-unpublish").addEventListener("click", () => void unpublish());

async function unpublish(): Promise<void> {
  if (!publishedId) return;
  if (!confirm("Ta bort inmätningen från listan och radera paketet?")) return;
  try {
    await unpublishEntry(publishedId, shareKey);
    publishedId = null;
    $("share-result").classList.add("hidden");
  } catch (err) {
    alert(`Avpubliceringen misslyckades: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Översikten till telefonen: ortofoto i lagom upplösning, i skrivbordets orientering, plus punkter utan hål. */
function buildSharePlan(): SharePlan | null {
  if (!state.surface) return null;
  const bounds = state.surface.bounds;
  const w = bounds.max[0] - bounds.min[0];
  const h = bounds.max[1] - bounds.min[1];
  const px = Math.max(200, Math.round(h > w ? (1600 * w) / h : 1600));
  let image: string | null = null;
  try {
    image = scene.renderTopDown(bounds, px);
  } catch (err) {
    console.warn("Inget ortofoto till översikten", err);
  }
  return {
    bounds,
    bearing: state.blastBearing,
    extent: state.mesh ? rotatedExtent(state.mesh.positions, bounds, state.blastBearing, 4) : null,
    image,
    points: pointsWithoutHole().map((p) => ({ id: p.id, sourceId: p.sourceId, e: p.e, n: p.n })),
    sourceIds: [...state.sourceIds],
  };
}

function buildShareBundle(salva: { site: string; date: string; note: string }): ShareBundle {
  const surface = state.surface!;
  const style = {
    showSkipped: state.showSkipped,
    showTrace: state.showTrace,
    showSticks: state.showSticks,
    mergeLabelsWithin: state.mergeLabels ? 0.2 : 0,
  };
  const holes = state.results.map((r) => {
    // Ytans snitt med marginal: telefonen ritar snittet själv i sin egen skärmstorlek.
    const win = sectionWindowFor(r, state.opts, { ...style, compact: true });
    const section = Array.from(sectionSegments(surface, win.frame, win));
    let frontSvg: string | null = null;
    try {
      const L = frontLayout(r, state.opts, { width: 420, height: 620, compact: true, showTrace: state.showTrace, showSkipped: state.showSkipped });
      // Lägre upplösning och JPEG-kvalitet än på skrivbordet: bilderna är nästan hela paketet som telefonen hämtar.
      const img = scene.renderFront(r.path.collar, L.frame.u, L.frame.n, L.latMin, L.latMax, L.zMin, L.zMax, Math.round(L.fw * 1.6), 0.72);
      frontSvg = renderFrontSvg(r, state.opts, { compact: true, showTrace: state.showTrace }, L, img ?? undefined);
    } catch (err) {
      console.warn(`Hål ${r.id}: ingen vy framifrån`, err);
    }
    return {
      id: r.id,
      minBurden: r.minBurden,
      minBurdenDepth: r.minBurdenDepth,
      cls: holeClass(r, state.opts),
      info: holeInfoText(r, undefined, state.opts.bearingCorrection),
      result: r,
      section,
      frontSvg,
    };
  });
  return {
    version: 3,
    name: state.meshName.replace(/\.[^.]+$/, "") || "salva",
    created: new Date().toISOString(),
    opts: { ...state.opts },
    style,
    salva,
    plan: buildSharePlan(),
    rule: `Rött < ${fmt(state.opts.minBurden, 1)} m, blått > ${fmt(state.opts.maxBurden, 1)} m, från ${fmt(state.opts.startDepth, 1)} m djup${state.opts.free3dFromDepth > 0 ? `, fri 3D från ${fmt(state.opts.free3dFromDepth, 1)} m` : ""}`,
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
