import type { BurdenOptions, HoleResult } from "../geom/burden";
import type { Bounds } from "../io/mesh";
import { escapeXml } from "./format";

export interface PlanBackground {
  /** Data-URL för en bild som täcker bounds sedd uppifrån, norr uppåt. */
  dataUrl: string;
}

/** Startpunkt som visas i översikten utan beräknat hål: utan sondering, eller utan nummer (id null). */
export interface PlanPoint {
  id: string | null;
  sourceId: string;
  e: number;
  n: number;
}

/** En rak linje från riggen sedd uppifrån. */
export interface PlanLine {
  id: string;
  e0: number;
  n0: number;
  e1: number;
  n1: number;
}

export interface PlanExtras {
  /** Skjutriktning i grader medurs från norr. Översikten vrids så att den pekar uppåt. null = norr uppåt. */
  bearing: number | null;
  points: PlanPoint[];
  /** Hål-id -> id i filen, för omnumrerade hål. */
  sourceIds: Map<string, string>;
  /** Numreringsläge: markörerna visas som klickbara mål. */
  numbering: boolean;
  /** Modellens utbredning i den vridna ramen, så att kartan följer modellen och inte dess rektangel i E N. */
  extent: RotatedExtent | null;
  /**
   * Meter per skärmpixel. Anges den ritas siffror, markörer och linjer i skärmstorlek
   * (telefonen, som zoomar genom att ändra viewBox), annars i fasta meter som på skrivbordet.
   */
  pixelScale: number | null;
  /** "auto": tätheten väljer prickar eller ringar. "rings": alltid vita ringar med numret inuti, som i rapporten. */
  markers: "auto" | "rings";
  /** Riggens raka linjer sedda uppifrån: planen prickad grå, loggen blå. */
  rigLines: { plan: PlanLine[]; quality: PlanLine[] };
  /** Streckad ram runt modellens rektangel när ortofoto saknas. Av när ingen modell finns. */
  modelFrame: boolean;
  /** Markerad startpunkt utan beräknat hål (ursprungs-id), ritas med ring som ett markerat hål. */
  selectedSource: string | null;
}

/** Utbredning i den vridna ramen, i meter kring modellens centrum. */
export interface RotatedExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function rotator(bounds: Bounds, bearing: number | null) {
  const B = ((bearing ?? 0) * Math.PI) / 180;
  const cos = Math.cos(B);
  const sin = Math.sin(B);
  const ce = (bounds.min[0] + bounds.max[0]) / 2;
  const cn = (bounds.min[1] + bounds.max[1]) / 2;
  // Uppåt i bilden är skjutriktningen (sin B, cos B) i E N, höger är (cos B, -sin B).
  const rot = (e: number, n: number): [number, number] => {
    const de = e - ce;
    const dn = n - cn;
    return [de * cos - dn * sin, -(de * sin + dn * cos)];
  };
  return { cos, sin, ce, cn, rot };
}

function extentOf(iter: Iterable<[number, number]>, rot: (e: number, n: number) => [number, number]): RotatedExtent {
  const ext: RotatedExtent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [e, n] of iter) {
    const [x, y] = rot(e, n);
    ext.minX = Math.min(ext.minX, x);
    ext.maxX = Math.max(ext.maxX, x);
    ext.minY = Math.min(ext.minY, y);
    ext.maxY = Math.max(ext.maxY, y);
  }
  return ext;
}

function cornersExtent(bounds: Bounds, rot: (e: number, n: number) => [number, number]): RotatedExtent {
  const corners: [number, number][] = [];
  for (const e of [bounds.min[0], bounds.max[0]]) for (const n of [bounds.min[1], bounds.max[1]]) corners.push([e, n]);
  return extentOf(corners, rot);
}

/** Modellens utbredning i den vridna ramen ur dess punkter (E N Z i följd), var `stride`:e punkt. */
export function rotatedExtent(positions: ArrayLike<number>, bounds: Bounds, bearing: number | null, stride = 1): RotatedExtent {
  const { rot } = rotator(bounds, bearing);
  const step = Math.max(1, Math.floor(stride)) * 3;
  function* points(): Generator<[number, number]> {
    for (let i = 0; i + 1 < positions.length; i += step) yield [positions[i], positions[i + 1]];
  }
  const ext = extentOf(points(), rot);
  return Number.isFinite(ext.minX) ? ext : cornersExtent(bounds, rot);
}

/** Översiktens kartram: viewBox i meter, vriden så att skjutriktningen pekar uppåt. */
export interface PlanFrame {
  bearing: number;
  w: number;
  h: number;
  center: [number, number];
  toScreen(e: number, n: number): [number, number];
  toWorld(x: number, y: number): [number, number];
}

export function planFrame(bounds: Bounds, bearing: number | null, pad = 3, extent?: RotatedExtent | null): PlanFrame {
  const { cos, sin, ce, cn, rot } = rotator(bounds, bearing);
  const ext = extent ?? cornersExtent(bounds, rot);
  const minX = ext.minX - pad;
  const maxX = ext.maxX + pad;
  const minY = ext.minY - pad;
  const maxY = ext.maxY + pad;
  return {
    bearing: bearing ?? 0,
    w: maxX - minX,
    h: maxY - minY,
    center: [ce, cn],
    toScreen(e, n) {
      const [x, y] = rot(e, n);
      return [x - minX, y - minY];
    },
    toWorld(x, y) {
      const a = x + minX;
      const b = -(y + minY);
      return [ce + a * cos + b * sin, cn - a * sin + b * cos];
    },
  };
}

/**
 * Skjutriktning ur en linje dragen längs raden från höger till vänster, sedd från hålsidan:
 * vinkelrät mot linjen, 90° medurs från dragriktningen. Hela grader.
 */
export function blastBearingFromLine(e0: number, n0: number, e1: number, n1: number): number {
  const line = (Math.atan2(e1 - e0, n1 - n0) * 180) / Math.PI;
  return Math.round((line + 90 + 720) % 360) % 360;
}

const INK = "#141414";
const MUTED = "#8a8a8a";
/** Hålspåren i översikten: vita och streckade, under markörer och siffror, så att de syns mot ortofotot utan att ta över. */
const TRACE_COLOR = "#ffffff";
const DEFAULT_EXTRAS: PlanExtras = {
  bearing: null,
  points: [],
  sourceIds: new Map(),
  numbering: false,
  extent: null,
  pixelScale: null,
  markers: "auto",
  rigLines: { plan: [], quality: [] },
  modelFrame: true,
  selectedSource: null,
};

/**
 * Översikt av hela salvan uppifrån: ortofotot, hålens spår och nummer, inget mer. Inga mått och
 * inga färger, det är en karta för att orientera sig och numrera. Enheten i viewBox är meter, så
 * linjebredder och textstorlekar anges i meter. Med skjutriktning vrids kartan så att den pekar uppåt.
 */
export function renderPlanSvg(
  results: HoleResult[],
  _opts: BurdenOptions,
  bounds: Bounds,
  bg: PlanBackground | null,
  selectedId: string | null,
  extras: Partial<PlanExtras> = {},
): string {
  const ex: PlanExtras = { ...DEFAULT_EXTRAS, ...extras };
  const F = planFrame(bounds, ex.bearing, 3, ex.extent);
  const { w, h } = F;
  const B = F.bearing;
  const f = (v: number) => v.toFixed(2);
  const P = (e: number, n: number) => {
    const [x, y] = F.toScreen(e, n);
    return { x, y };
  };
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="100%" style="max-height:calc(100vh - 190px)" font-family="Segoe UI, Arial, sans-serif" data-bearing="${B}">`,
  );

  // Ortofotot täcker modellens rektangel i E N, vriden kring sitt centrum. Utanför modellen är bilden genomskinlig.
  const bw = bounds.max[0] - bounds.min[0];
  const bh = bounds.max[1] - bounds.min[1];
  const c = P(F.center[0], F.center[1]);
  parts.push(`<g transform="translate(${f(c.x)},${f(c.y)}) rotate(${f(-B)})">`);
  if (bg) {
    parts.push(`<image href="${bg.dataUrl}" x="${f(-bw / 2)}" y="${f(-bh / 2)}" width="${f(bw)}" height="${f(bh)}" preserveAspectRatio="none"/>`);
  } else if (ex.modelFrame) {
    parts.push(
      `<rect x="${f(-bw / 2)}" y="${f(-bh / 2)}" width="${f(bw)}" height="${f(bh)}" fill="none" stroke="#999" stroke-width="0.15" stroke-dasharray="0.6 0.4"/>`,
    );
  }
  parts.push(`</g>`);

  // Mått: på skrivbordet fasta meter, på telefonen skärmpixlar gånger meter per pixel
  const S = ex.pixelScale;
  const sz = (pixels: number, meters: number) => (S ? pixels * S : meters);
  const items = [...results.map((r) => ({ e: r.path.collar[0], n: r.path.collar[1] })), ...ex.points.map((p) => ({ e: p.e, n: p.n }))];
  // Tätheten styr vad som ritas med pixelScale (telefonen och skrivbordet): prickar när hålen står tätt i
  // bild, annars ringar med numret inuti, små först och större med mer plats. Utan pixelScale (tester,
  // kommandoraden) ritas siffror ovanför i fasta meter.
  // Rapporten tvingar ringarna: numren måste gå att läsa på papper, användaren väljer fönstret.
  const nn = S ? nearestNeighbourMedian(items) / S : Infinity;
  const mode: "dots" | "labels" | "rings" = ex.markers === "rings" ? "rings" : !S ? "labels" : nn < 16 ? "dots" : "rings";
  const showRig = !S || nn >= 30;
  // Ringens radie följer platsen: 7 till 11 bildpunkter, så att ringarna med nummer kommer så tidigt som möjligt
  const ringPx = Math.min(11, Math.max(7, nn * 0.42));
  const R = mode === "dots" ? sz(2.5, 0.32) : mode === "rings" ? sz(ringPx, 0.32) : sz(4, 0.32);
  const traceW = sz(1.2, 0.09);
  const fontL = mode === "rings" ? sz(Math.max(8, ringPx * 0.95), 0.65) : sz(11, 0.65);
  // Osynligt klickmål i numreringsläge, så att markören är lätt att träffa utan att bilden belamras.
  const target = (x: number, y: number) => (ex.numbering ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(sz(9, 1.0))}" fill="transparent" stroke="none"/>` : "");
  // Numret står ovanför påhugget, centrerat och litet, så att en tät rad inte flyter ihop. På telefonen
  // ritas inte en siffra som skulle hamna ovanpå en redan ritad; den kommer fram vid inzoomning.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const label = (x: number, y: number, text: string, force = false) => {
    const yTop = y - sz(7, 0.55);
    if (S && !force) {
      const w = text.length * fontL * 0.62 + sz(2, 0);
      const box = { x0: x - w / 2, x1: x + w / 2, y0: yTop - fontL, y1: yTop };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) return "";
      placed.push(box);
    }
    return `<text x="${f(x)}" y="${f(yTop)}" font-size="${f(fontL)}" font-weight="500" text-anchor="middle" fill="${INK}" stroke="#fff" stroke-width="${f(sz(2, 0.16))}" paint-order="stroke">${escapeXml(text)}</text>`;
  };
  // Numret inuti ringen
  const inside = (x: number, y: number, text: string, color: string) =>
    `<text class="ring-id" x="${f(x)}" y="${f(y + fontL * 0.36)}" font-size="${f(fontL)}" font-weight="700" text-anchor="middle" fill="${color}">${escapeXml(text)}</text>`;

  // Riggens linjer sedda uppifrån, bakom hålen: planen prickad grå, loggen blå.
  const rigLine = (kind: string, l: PlanLine, color: string, dash: string | null) => {
    const a = P(l.e0, l.n0);
    const b = P(l.e1, l.n1);
    return `<line class="plan-rig-line ${kind}" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${color}" stroke-width="${f(traceW)}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  };
  if (showRig) {
    for (const l of ex.rigLines.plan) parts.push(rigLine("plan", l, "#8a8f99", `${f(sz(2, 0.25))} ${f(sz(3, 0.35))}`));
    for (const l of ex.rigLines.quality) parts.push(rigLine("quality", l, "#2b6cb0", null));
  }

  // Hål på samma plats, inom 0,25 m, får siffrorna staplade ovanför varandra och ett ×n vid markören.
  const stackIdx = new Array<number>(items.length).fill(0);
  const groupSize = new Array<number>(items.length).fill(1);
  const grouped = new Array<boolean>(items.length).fill(false);
  for (let i = 0; i < items.length; i++) {
    if (grouped[i]) continue;
    const members = [i];
    for (let j = i + 1; j < items.length; j++) {
      if (!grouped[j] && Math.hypot(items[i].e - items[j].e, items[i].n - items[j].n) <= 0.25) members.push(j);
    }
    members.forEach((m, k) => {
      grouped[m] = true;
      stackIdx[m] = k;
      groupSize[m] = members.length;
    });
  }
  // Numret för en markör: inuti ringen när det finns plats, annars ovanför, staplat vid samma läge; prickar får inget.
  const number = (i: number, x: number, y: number, text: string, color: string, force: boolean) => {
    if (mode === "dots") return "";
    if (mode === "rings" && stackIdx[i] === 0) return inside(x, y, text, color);
    const lift = mode === "rings" ? R + sz(2, 0.2) : 0;
    return label(x, y - lift - stackIdx[i] * fontL * 1.15, text, force);
  };
  const badge = (i: number, x: number, y: number) =>
    stackIdx[i] === 0 && groupSize[i] > 1
      ? `<text class="stack-badge" x="${f(x + R * (mode === "rings" ? 1.0 : 1.8))}" y="${f(y + R * (mode === "rings" ? 1.2 : 0.9))}" font-size="${f(fontL * 0.75)}" fill="#666" stroke="#fff" stroke-width="${f(sz(1.5, 0.12))}" paint-order="stroke">×${groupSize[i]}</text>`
      : "";
  const ring = (x: number, y: number) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(mode === "rings" ? R + sz(4, 0.4) : sz(8, 0.7))}" fill="none" stroke="${INK}" stroke-width="${f(sz(1.5, 0.14))}"/>`;

  // Hålspåren, banorna sedda uppifrån, i ett eget lager under alla markörer och siffror: svagt grått så att de
  // syns utan att ta över. Inte när bilden är tät.
  if (mode !== "dots") {
    parts.push(`<g class="traces">`);
    for (const r of results) {
      const trace = r.path.points.map((p) => { const q = P(p[0], p[1]); return `${f(q.x)},${f(q.y)}`; }).join(" ");
      parts.push(`<polyline class="trace" points="${trace}" fill="none" stroke="${TRACE_COLOR}" stroke-width="${f(traceW)}" stroke-dasharray="${f(sz(4, 0.3))} ${f(sz(3, 0.25))}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`);
    }
    parts.push(`</g>`);
  }

  // Beräknade hål: svart markör, eller vit ring med numret inuti när det finns plats
  for (const [ri, r] of results.entries()) {
    const sel = r.id === selectedId;
    const source = ex.sourceIds.get(r.id);
    const k = P(r.path.collar[0], r.path.collar[1]);
    parts.push(`<g class="plan-hole" data-id="${escapeXml(r.id)}" data-source="${escapeXml(source ?? r.id)}" style="cursor:pointer">`);
    if (sel) parts.push(ring(k.x, k.y));
    parts.push(target(k.x, k.y));
    if (mode === "rings") {
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="#fff" stroke="${INK}" stroke-width="${f(sz(1.6, 0.12))}"/>`);
    } else if (mode === "dots") {
      // Tätt: små vita prickar med svart kant, samma språk som ringarna
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="#fff" stroke="${INK}" stroke-width="${f(sz(1, 0.08))}"/>`);
    } else {
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="${INK}" stroke="#fff" stroke-width="${f(sz(1, 0.08))}"/>`);
    }
    parts.push(number(ri, k.x, k.y, r.id, INK, sel));
    parts.push(badge(ri, k.x, k.y));
    parts.push(`</g>`);
  }

  // Startpunkter utan beräknat hål: ljus markör med nummer (utan sondering), eller ihålig helt utan text
  for (const [pi, p] of ex.points.entries()) {
    const i = results.length + pi;
    const k = P(p.e, p.n);
    const sel = p.sourceId === ex.selectedSource;
    parts.push(`<g class="plan-point" data-source="${escapeXml(p.sourceId)}" style="cursor:pointer">`);
    if (sel) parts.push(ring(k.x, k.y));
    parts.push(target(k.x, k.y));
    if (p.id !== null) {
      // Utan sondering: ljus markör med grå kant, som i en borrplan.
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="#e3e6ea" stroke="${MUTED}" stroke-width="${f(sz(1.2, 0.1))}"/>`);
      parts.push(number(i, k.x, k.y, p.id, mode === "rings" ? "#555" : INK, sel));
    } else {
      // Utan nummer: ihålig markör utan text, originalnamnet belamrar bara bilden.
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="#fff" stroke="${INK}" stroke-width="${f(sz(1.4, 0.12))}"/>`);
    }
    parts.push(badge(i, k.x, k.y));
    parts.push(`</g>`);
  }

  // Lager för linjen som dras när skjutriktningen ritas
  parts.push(`<g id="plan-overlay" pointer-events="none"></g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

/** Medianen av varje punkts avstånd till sin närmaste granne, meter. Oändligt med färre än två punkter. */
export function nearestNeighbourMedian(items: { e: number; n: number }[]): number {
  if (items.length < 2) return Infinity;
  const nearest: number[] = [];
  for (let i = 0; i < items.length; i++) {
    let best = Infinity;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(items[i].e - items[j].e, items[i].n - items[j].n);
      if (d < best) best = d;
    }
    nearest.push(best);
  }
  nearest.sort((a, b) => a - b);
  const mid = Math.floor(nearest.length / 2);
  return nearest.length % 2 ? nearest[mid] : (nearest[mid - 1] + nearest[mid]) / 2;
}

/** Hålens utbredning i kartramen med marginal: startvyn på telefonen, så att salvan fyller skärmen och inte modellen. */
export function holesViewBox(frame: PlanFrame, points: { e: number; n: number }[]): { x: number; y: number; w: number; h: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const [x, y] = frame.toScreen(p.e, p.n);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const m = Math.max(4, 0.12 * Math.max(maxX - minX, maxY - minY));
  return { x: minX - m, y: minY - m, w: maxX - minX + 2 * m, h: maxY - minY + 2 * m };
}
