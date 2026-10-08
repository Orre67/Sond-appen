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
  /** Riggens raka linjer sedda uppifrån: planen prickad grå, loggen blå. */
  rigLines: { plan: PlanLine[]; quality: PlanLine[] };
  /** Streckad ram runt modellens rektangel när ortofoto saknas. Av när ingen modell finns. */
  modelFrame: boolean;
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
const DEFAULT_EXTRAS: PlanExtras = {
  bearing: null,
  points: [],
  sourceIds: new Map(),
  numbering: false,
  extent: null,
  pixelScale: null,
  rigLines: { plan: [], quality: [] },
  modelFrame: true,
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
  const R = sz(4, 0.32);
  const traceW = sz(1.2, 0.09);
  const fontL = sz(11, 0.65);
  // Osynligt klickmål i numreringsläge, så att markören är lätt att träffa utan att bilden belamras.
  const target = (x: number, y: number) => (ex.numbering ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(sz(9, 1.0))}" fill="transparent" stroke="none"/>` : "");
  // Numret står ovanför påhugget, centrerat och litet, så att en tät rad inte flyter ihop
  const label = (x: number, y: number, text: string) =>
    `<text x="${f(x)}" y="${f(y - sz(7, 0.55))}" font-size="${f(fontL)}" font-weight="500" text-anchor="middle" fill="${INK}" stroke="#fff" stroke-width="${f(sz(2, 0.16))}" paint-order="stroke">${escapeXml(text)}</text>`;

  // Riggens linjer sedda uppifrån, bakom hålen: planen prickad grå, loggen blå.
  const rigLine = (kind: string, l: PlanLine, color: string, dash: string | null) => {
    const a = P(l.e0, l.n0);
    const b = P(l.e1, l.n1);
    return `<line class="plan-rig-line ${kind}" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${color}" stroke-width="${f(traceW)}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  };
  for (const l of ex.rigLines.plan) parts.push(rigLine("plan", l, "#8a8f99", `${f(sz(2, 0.25))} ${f(sz(3, 0.35))}`));
  for (const l of ex.rigLines.quality) parts.push(rigLine("quality", l, "#2b6cb0", null));

  for (const r of results) {
    const sel = r.id === selectedId;
    const source = ex.sourceIds.get(r.id);
    const k = P(r.path.collar[0], r.path.collar[1]);
    parts.push(`<g class="plan-hole" data-id="${escapeXml(r.id)}" data-source="${escapeXml(source ?? r.id)}" style="cursor:pointer">`);
    const trace = r.path.points
      .map((p) => {
        const q = P(p[0], p[1]);
        return `${f(q.x)},${f(q.y)}`;
      })
      .join(" ");
    parts.push(`<polyline points="${trace}" fill="none" stroke="${INK}" stroke-width="${f(traceW)}"/>`);
    if (sel) parts.push(`<circle cx="${f(k.x)}" cy="${f(k.y)}" r="${f(sz(8, 0.7))}" fill="none" stroke="${INK}" stroke-width="${f(sz(1.5, 0.14))}"/>`);
    parts.push(target(k.x, k.y));
    parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="${INK}" stroke="#fff" stroke-width="${f(sz(1, 0.08))}"/>`);
    parts.push(label(k.x, k.y, r.id));
    parts.push(`</g>`);
  }

  // Startpunkter utan beräknat hål: grå markör med nummer (utan sondering), eller ihålig helt utan text
  for (const p of ex.points) {
    const k = P(p.e, p.n);
    parts.push(`<g class="plan-point" data-source="${escapeXml(p.sourceId)}" style="cursor:pointer">`);
    parts.push(target(k.x, k.y));
    if (p.id !== null) {
      // Utan sondering: ljus ring med grå kant, som i en borrplan.
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="#e3e6ea" stroke="${MUTED}" stroke-width="${f(sz(1.2, 0.1))}"/>`);
      parts.push(label(k.x, k.y, p.id));
    } else {
      // Utan nummer: ihålig markör utan text, originalnamnet belamrar bara bilden.
      parts.push(`<circle class="collar" cx="${f(k.x)}" cy="${f(k.y)}" r="${f(R)}" fill="#fff" stroke="${INK}" stroke-width="${f(sz(1.4, 0.12))}"/>`);
    }
    parts.push(`</g>`);
  }

  // Lager för linjen som dras när skjutriktningen ritas
  parts.push(`<g id="plan-overlay" pointer-events="none"></g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}
