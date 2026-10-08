import type { BurdenOptions, HoleResult } from "../geom/burden";
import { pointAt } from "../geom/hole";
import {
  bearingDifference,
  holeBearing,
  holeMeanInclination,
  sectionBearing,
  makeFrame,
  projectToSection,
  sectionSegments,
  type SectionFrame,
  type SectionWindow,
} from "../geom/section";
import type { Surface } from "../geom/surface";
import { distance, type Vec3 } from "../geom/vec";
import { CLASS_COLORS, escapeXml, fmt } from "./format";

export interface ProfileStyle {
  width: number;
  height: number;
  /** Rita även stickor/punkter ovanför startdjupet, svagt och utan siffra. */
  showSkipped: boolean;
  /** Rita ytspåret genom alla täta provpunkters närmaste ytpunkt. */
  showTrace: boolean;
  /** Markera varje stickas utbredning längs hålet. */
  showSticks: boolean;
  /** Mått vars ytpunkter ligger inom detta avstånd (meter) får en gemensam siffra, den minsta. 0 stänger av. */
  mergeLabelsWithin: number;
  /** Visa väggen framifrån till höger om snittet. */
  showFront: boolean;
  /** Bild av väggen framifrån (data-URL) som täcker exakt panelens utbredning enligt profileLayout. */
  frontImage?: string;
  /** Kompakt text och marginaler, för stående format på telefon. */
  compact: boolean;
  /**
   * Mått längre än detta ritas kapade med pilspets, siffran visar ändå det verkliga värdet.
   * Undefined betyder största försättning plus 1,5 m. 0 stänger av kapningen.
   */
  maxLineLength?: number;
}

export const DEFAULT_PROFILE_STYLE: ProfileStyle = {
  width: 960,
  height: 640,
  showSkipped: true,
  showTrace: true,
  showSticks: true,
  mergeLabelsWithin: 0.2,
  showFront: true,
  compact: false,
};

/** En tät provpunkt i bildkoordinater, för avläsning med mus eller finger. */
export interface HoverSample {
  depth: number;
  burden: number | null;
  /** Hålpunkten i bilden. */
  hx: number;
  hy: number;
  /** Närmaste ytpunkt i bilden, null om ingen. */
  cx: number | null;
  cy: number | null;
}

export interface ProfileRender {
  svg: string;
  samples: HoverSample[];
  layout: ProfileLayout;
}

/** Råa utbredningar i meter för ett hål: snittfönster och sidledes läge, med marginaler. */
export interface ProfileExtents {
  bearing: number;
  frame: SectionFrame;
  sMin: number;
  sMax: number;
  zMin: number;
  zMax: number;
  latMin: number;
  latMax: number;
}

/** Bildens uppbyggnad: snittfönster, skala och panelen för vyn framifrån. Allt i meter respektive bildpunkter. */
export interface ProfileLayout extends ProfileExtents {
  /** Bildpunkter per meter, lika i båda axlar och gemensam för snitt och vy framifrån. */
  k: number;
  /** Snittets ritområde. */
  ml: number;
  mt: number;
  plotW: number;
  plotH: number;
  padX: number;
  padY: number;
  /** Vyn framifrån: läge och bredd i bildpunkter. latMin/latMax är då det som panelen visar. */
  fx0: number;
  fw: number;
}

/** Det som behövs för att rita väggen framifrån i en given ruta. */
export interface FrontPanelGeom {
  frame: SectionFrame;
  bearing: number;
  fx0: number;
  fw: number;
  latMin: number;
  latMax: number;
  zMin: number;
  zMax: number;
  k: number;
}

/** Fristående vy framifrån: panelens geometri plus bildens mått. */
export interface FrontLayout extends FrontPanelGeom {
  width: number;
  height: number;
  /** Panelens överkant i bildpunkter. */
  top: number;
}

const SURFACE_COLOR = "#b4b4b4";
const HOLE_COLOR = "#141414";
const TICK_COLOR = "#3aa7b8";
const TRACE_COLOR = "#c0392b";
const SCALE_COLOR = "#8a8a8a";

/** Sidledes läge sett framifrån: positivt åt höger när man står framför väggen och tittar mot hålet. */
export function lateralOf(frame: SectionFrame, p: [number, number, number]): number {
  return -projectToSection(frame, p).off;
}

/** Längsta linje som ritas i sin helhet. */
export function lineCap(opts: BurdenOptions, st: ProfileStyle): number {
  if (st.maxLineLength === undefined) return opts.maxBurden + 1.5;
  return st.maxLineLength > 0 ? st.maxLineLength : Infinity;
}

/** Linjens ändpunkt i rummet: ytpunkten, eller en kapad punkt på vägen dit om måttet är längre än taket. */
export function lineEnd(point: Vec3, closest: Vec3, burden: number, cap: number): { end: Vec3; truncated: boolean } {
  if (burden <= cap || burden <= 0) return { end: closest, truncated: false };
  const f = cap / burden;
  return { end: [point[0] + (closest[0] - point[0]) * f, point[1] + (closest[1] - point[1]) * f, point[2] + (closest[2] - point[2]) * f], truncated: true };
}

export function profileExtents(r: HoleResult, opts: BurdenOptions, style: Partial<ProfileStyle> = {}): ProfileExtents {
  const st = { ...DEFAULT_PROFILE_STYLE, ...style };
  const bearing = sectionBearing(r);
  const frame = makeFrame(r.path.collar, bearing);
  const drawn = r.rows.filter((x) => x.cls !== "collar" && (st.showSkipped || x.cls !== "skipped"));
  const cap = lineCap(opts, st);

  let sMin = Infinity;
  let sMax = -Infinity;
  let zMin = Infinity;
  let zMax = r.path.collar[2];
  let latMin = Infinity;
  let latMax = -Infinity;
  const take = (p: [number, number, number]) => {
    const q = projectToSection(frame, p);
    sMin = Math.min(sMin, q.s);
    sMax = Math.max(sMax, q.s);
    zMin = Math.min(zMin, q.z);
    zMax = Math.max(zMax, q.z);
    latMin = Math.min(latMin, -q.off);
    latMax = Math.max(latMax, -q.off);
  };
  for (const p of r.path.points) take(p);
  if (r.ghost) for (const p of r.ghost.points) take(p);
  for (const row of drawn) {
    take(row.point);
    if (row.closest && row.burden !== null) take(lineEnd(row.point, row.closest, row.burden, cap).end);
  }
  if (st.showTrace) {
    for (const f of r.fine) {
      if (!f.closest || f.burden === null || f.depth < opts.startDepth - 1e-9 || f.burden > cap) continue;
      const lat = lateralOf(frame, f.closest);
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
    }
  }
  // s1 är släntsidan där siffrorna står till vänster om ändpunkterna och behöver plats.
  // s0 på hålsidan ger plats åt djupsiffrorna, som ritas inom ritområdet.
  const pad = st.compact ? { s0: 1.6, s1: 1.7, z0: 0.8, z1: 0.8 } : { s0: 2.5, s1: 2.0, z0: 1.5, z1: 2.0 };
  return {
    bearing,
    frame,
    sMin: sMin - pad.s0,
    sMax: sMax + pad.s1,
    zMin: zMin - pad.z0,
    zMax: zMax + pad.z1,
    latMin: Math.min(latMin - 1.0, -2.0),
    latMax: Math.max(latMax + 1.0, 2.0),
  };
}

function margins(st: ProfileStyle) {
  return st.compact ? { ml: 6, mr: 6, mt: 8, mb: 8 } : { ml: 24, mr: 112, mt: 64, mb: 30 };
}

export function profileLayout(r: HoleResult, opts: BurdenOptions, style: Partial<ProfileStyle> = {}): ProfileLayout {
  const st = { ...DEFAULT_PROFILE_STYLE, ...style };
  const W = st.width;
  const H = st.height;
  const E = profileExtents(r, opts, st);
  const { sMin, sMax, zMin, zMax } = E;
  let { latMin, latMax } = E;
  const { ml, mr, mt, mb } = margins(st);
  const gap = st.showFront ? 16 : 0;
  const fwMin = st.showFront ? 150 : 0;
  const fwMax = st.showFront ? Math.round(W * 0.34) : 0;
  const plotH = H - mt - mb;
  const kH = plotH / (zMax - zMin);
  // Snittet får den skala höjden tillåter; bredd som blir över går till vyn framifrån.
  const leftover = W - ml - mr - gap - (sMax - sMin) * kH;
  const fw = st.showFront ? Math.min(fwMax, Math.max(fwMin, leftover)) : 0;
  const plotW = W - ml - mr - gap - fw;
  const k = Math.min(kH, plotW / (sMax - sMin));
  if (st.showFront) {
    // Panelen visar så många meter som dess bredd rymmer i samma skala, centrerat kring spåret.
    const latC = (latMin + latMax) / 2;
    const half = fw / (2 * k);
    latMin = latC - half;
    latMax = latC + half;
  }
  const padX = (plotW - (sMax - sMin) * k) / 2;
  const padY = (plotH - (zMax - zMin) * k) / 2;
  const fx0 = W - 8 - fw;
  return { ...E, latMin, latMax, k, ml, mt, plotW, plotH, padX, padY, fx0, fw };
}

/** Geometri för en fristående vy framifrån som fyller en bild av given storlek. */
export function frontLayout(r: HoleResult, opts: BurdenOptions, style: Partial<ProfileStyle> = {}): FrontLayout {
  const st = { ...DEFAULT_PROFILE_STYLE, ...style };
  const E = profileExtents(r, opts, st);
  const ml = st.compact ? 8 : 14;
  const mr = st.compact ? 8 : 14;
  const mt = st.compact ? 10 : 64;
  const mb = st.compact ? 10 : 26;
  const fw = st.width - ml - mr;
  const availH = st.height - mt - mb;
  const k = Math.min(fw / (E.latMax - E.latMin), availH / (E.zMax - E.zMin));
  const latC = (E.latMin + E.latMax) / 2;
  const half = fw / (2 * k);
  const panelH = (E.zMax - E.zMin) * k;
  const top = mt + (availH - panelH) / 2;
  return {
    frame: E.frame,
    bearing: E.bearing,
    fx0: ml,
    fw,
    latMin: latC - half,
    latMax: latC + half,
    zMin: E.zMin,
    zMax: E.zMax,
    k,
    width: st.width,
    height: st.height,
    top,
  };
}

export function renderProfileSvg(r: HoleResult, surface: Surface, opts: BurdenOptions, style: Partial<ProfileStyle> = {}): string {
  return renderProfile(r, surface, opts, style).svg;
}

function headerLines(r: HoleResult, opts: BurdenOptions, bearing: number, compact: boolean): string[] {
  const incl = holeMeanInclination(r);
  const modeText = opts.mode === "stick" ? `Måttsticka ${fmt(opts.interval, 1)} m, sämsta värde per sticka` : `Punkt var ${fmt(opts.interval, 1)} m`;
  const minText = r.minBurden !== null ? `Minsta försättning ${fmt(r.minBurden, 2)} m på ${fmt(r.minBurdenDepth, 1)} m` : "Ingen yta hittad";
  if (compact) return [holeInfoText(r, bearing, opts.bearingCorrection), minText];
  const corrText = Math.abs(opts.bearingCorrection) > 1e-9 ? [`Bäringskorrektion ${signedDeg(opts.bearingCorrection)}`] : [];
  const own = holeBearing(r) ?? bearing;
  const turned = bearingDifference(own, bearing) > 0.5 ? [`Snitt mot ${fmt(bearing, 0)}°`] : [];
  return [[`Längd ${fmt(r.path.length, 1)} m`, `Bäring ${fmt(own, 0)}°`, `Lutning ${fmt(incl, 0)}° från lod`, ...turned, ...corrText, modeText, minText].join("   ·   ")];
}

/** Vinkel med tecken, t.ex. +5,9°. */
export function signedDeg(v: number): string {
  return `${v < 0 ? "−" : "+"}${fmt(Math.abs(v), 1)}°`;
}

/**
 * Kort beskrivning av hålet för telefonsidans rubrik. Bäringen är hålets egen, korrigerad;
 * snittets bäring anges när snittet vridits mot försättningen, korrektionen när den inte är noll.
 */
export function holeInfoText(r: HoleResult, bearing = sectionBearing(r), correction = 0): string {
  const own = holeBearing(r) ?? bearing;
  let text = `Längd ${fmt(r.path.length, 1)} m · Bäring ${fmt(own, 0)}° · Lutning ${fmt(holeMeanInclination(r), 0)}°`;
  if (bearingDifference(own, bearing) > 0.5) text += ` · Snitt mot ${fmt(bearing, 0)}°`;
  if (Math.abs(correction) > 1e-9) text += ` · Bäringskorr. ${signedDeg(correction)}`;
  return text;
}

function footerText(r: HoleResult, opts: BurdenOptions, compact: boolean): string {
  const bottom = r.path.points[r.path.points.length - 1][2];
  const rule = `Rött &lt; ${fmt(opts.minBurden, 1)} m, blått &gt; ${fmt(opts.maxBurden, 1)} m, från ${fmt(opts.startDepth, 1)} m djup${opts.free3dFromDepth > 0 ? `, fri 3D från ${fmt(opts.free3dFromDepth, 1)} m` : ""}`;
  if (compact) return `Påhugg +${fmt(r.path.collar[2], 1)} · Botten +${fmt(bottom, 1)} · ${rule}`;
  return `Påhugg +${fmt(r.path.collar[2], 2)}   ·   Botten +${fmt(bottom, 2)}   ·   ${rule}`;
}

/**
 * Profilbild för ett hål: lodrätt snitt genom påhugget längs hålets huvudbäring, och till
 * höger väggen sedd framifrån i samma höjdskala. Slänten ritas till vänster i snittet,
 * hålet lutar mot den, djupmarkeringar till höger. Varje försättningslinje går från
 * stickans sämsta punkt till närmaste ytpunkt projicerad in i snittet. Siffran är det
 * verkliga 3D-måttet.
 */
export function renderProfile(r: HoleResult, surface: Surface, opts: BurdenOptions, style: Partial<ProfileStyle> = {}): ProfileRender {
  const st = { ...DEFAULT_PROFILE_STYLE, ...style };
  const { frame, sMin, sMax, zMin, zMax } = profileLayout(r, opts, st);
  return drawProfile(r, sectionSegments(surface, frame, { sMin, sMax, zMin, zMax }), opts, st);
}

/**
 * Snittfönster med marginal runt det bilden behöver, för ytsegment som skickas till telefonen
 * och ritas i en skärmform som inte är känd i förväg.
 */
export function sectionWindowFor(
  r: HoleResult,
  opts: BurdenOptions,
  style: Partial<ProfileStyle> = {},
  margin = 3,
): SectionWindow & { frame: SectionFrame } {
  const E = profileExtents(r, opts, style);
  return { frame: E.frame, sMin: E.sMin - margin, sMax: E.sMax + margin, zMin: E.zMin - margin, zMax: E.zMax + margin };
}

/**
 * Ritar snittet ur färdiga ytsegment ([s0, z0, s1, z1, ...] i snittkoordinater) utan tillgång
 * till modellen. Telefonen använder den för att rita i skärmens egen storlek.
 */
export function drawProfile(r: HoleResult, segs: ArrayLike<number>, opts: BurdenOptions, style: Partial<ProfileStyle> = {}): ProfileRender {
  const st = { ...DEFAULT_PROFILE_STYLE, ...style };
  const W = st.width;
  const H = st.height;
  const L = profileLayout(r, opts, st);
  const { frame, bearing, sMax, zMax, k, ml, mt, plotW, plotH, padX, padY } = L;

  const drawn = r.rows.filter((x) => x.cls !== "collar");
  const hp = r.path.points.map((p) => projectToSection(frame, p));
  const cap = lineCap(opts, st);
  const rp = drawn.map((row) => {
    const le = row.closest && row.burden !== null ? lineEnd(row.point, row.closest, row.burden, cap) : null;
    return {
      row,
      p: projectToSection(frame, row.point),
      q: le ? projectToSection(frame, le.end) : null,
      truncated: le ? le.truncated : false,
    };
  });

  // Slänten till vänster: s växer åt vänster på skärmen
  const X = (s: number) => ml + padX + (sMax - s) * k;
  const Y = (z: number) => mt + padY + (zMax - z) * k;
  const f1 = (v: number) => v.toFixed(1);
  const safeId = r.id.replace(/[^A-Za-z0-9_-]/g, "_");
  const clipId = `plot-${safeId}`;

  /** Enhetsvektor i bilden vinkelrätt mot hålet vid ett djup, pekande åt högersidan (bort från slänten). */
  const perpAt = (depth: number): [number, number] => {
    const { dir } = pointAt(r.path, depth);
    const ds = dir[0] * frame.u[0] + dir[1] * frame.u[1];
    const dz = dir[2];
    let px = dz;
    let py = -ds;
    if (px < 0) {
      px = -px;
      py = -py;
    }
    const len = Math.hypot(px, py) || 1;
    return [px / len, py / len];
  };
  const screenAt = (depth: number): [number, number] => {
    const p = projectToSection(frame, pointAt(r.path, depth).point);
    return [X(p.s), Y(p.z)];
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif" data-hole="${escapeXml(r.id)}">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${ml}" y="${mt}" width="${plotW}" height="${plotH}"/></clipPath></defs>`);

  // Rubrik. På telefon visar sidan själv hålets nummer och värden, så bilden har ingen.
  if (!st.compact) {
    parts.push(`<text x="${ml}" y="26" font-size="20" font-weight="700" fill="#111">Hål ${escapeXml(r.id)}</text>`);
    headerLines(r, opts, bearing, false).forEach((line, i) => {
      parts.push(`<text x="${ml}" y="${46 + i * 17}" font-size="12.5" fill="#444">${escapeXml(line)}</text>`);
    });
  }

  parts.push(`<g clip-path="url(#${clipId})">`);

  // Ytans snitt
  if (segs.length > 0) {
    const d: string[] = [];
    for (let i = 0; i < segs.length; i += 4) {
      d.push(`M${f1(X(segs[i]))} ${f1(Y(segs[i + 1]))}L${f1(X(segs[i + 2]))} ${f1(Y(segs[i + 3]))}`);
    }
    parts.push(`<path d="${d.join("")}" stroke="${SURFACE_COLOR}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
  }

  // Ytspår: närmaste ytpunkt för varje tät provpunkt, från startdjupet och ned
  if (st.showTrace) {
    const pts: string[] = [];
    for (const f of r.fine) {
      if (!f.closest || f.depth < opts.startDepth - 1e-9) continue;
      const q = projectToSection(frame, f.closest);
      pts.push(`${f1(X(q.s))},${f1(Y(q.z))}`);
    }
    if (pts.length > 1) {
      parts.push(`<polyline class="trace" points="${pts.join(" ")}" fill="none" stroke="${TRACE_COLOR}" stroke-width="1.3" stroke-linejoin="round" opacity="0.9"/>`);
    }
  }

  // Stickornas utbredning längs hålet, som band på högersidan
  if (st.showSticks && opts.mode === "stick") {
    for (const x of rp) {
      const row = x.row;
      if (row.stickEnd - row.stickStart < 1e-6) continue;
      if (row.cls === "skipped" && !st.showSkipped) continue;
      const [ax, ay] = screenAt(row.stickStart);
      const [bx, by] = screenAt(row.stickEnd);
      const [px, py] = perpAt((row.stickStart + row.stickEnd) / 2);
      const off = 4.5;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const gap = Math.min(1.5, len / 4);
      const ux = (dx / len) * gap;
      const uy = (dy / len) * gap;
      parts.push(
        `<line class="stick" x1="${f1(ax + px * off + ux)}" y1="${f1(ay + py * off + uy)}" x2="${f1(bx + px * off - ux)}" y2="${f1(by + py * off - uy)}" stroke="${CLASS_COLORS[row.cls]}" stroke-width="5" opacity="0.55"/>`,
      );
    }
  }

  // Mått som slutar i samma ytpunkt bildar ett kluster: en gemensam linje och en gemensam siffra, den minsta.
  const labelItems = rp.filter((x) => x.q && x.row.burden !== null && x.row.cls !== "skipped");
  const clusters: (typeof labelItems)[] = [];
  for (const x of labelItems) {
    const near =
      st.mergeLabelsWithin > 0
        ? clusters.find((cl) => cl.some((y) => distance(y.row.closest!, x.row.closest!) <= st.mergeLabelsWithin))
        : undefined;
    if (near) near.push(x);
    else clusters.push([x]);
  }
  const representative = new Set(clusters.map((cl) => cl.reduce((a, b) => (b.row.burden! < a.row.burden! ? b : a))));

  // Försättningslinjer
  for (const x of rp) {
    if (!x.q || x.row.burden === null) continue;
    const color = CLASS_COLORS[x.row.cls];
    if (x.row.cls === "skipped") {
      if (!st.showSkipped) continue;
      parts.push(
        `<line x1="${f1(X(x.p.s))}" y1="${f1(Y(x.p.z))}" x2="${f1(X(x.q.s))}" y2="${f1(Y(x.q.z))}" stroke="${color}" stroke-width="1.4" stroke-dasharray="4 4"/>`,
      );
      continue;
    }
    // Stickor som mäter till samma ytpunkt som en kortare sticka behåller band och färg men ritar ingen egen linje.
    if (!representative.has(x)) continue;
    const x1 = X(x.p.s);
    const y1 = Y(x.p.z);
    const x2 = X(x.q.s);
    const y2 = Y(x.q.z);
    parts.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`);
    if (x.truncated) {
      // Pilspets: måttet fortsätter utanför bilden
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const a = 7;
      parts.push(
        `<polyline points="${f1(x2 - ux * a - uy * a * 0.6)},${f1(y2 - uy * a + ux * a * 0.6)} ${f1(x2)},${f1(y2)} ${f1(x2 - ux * a + uy * a * 0.6)},${f1(y2 - uy * a - ux * a * 0.6)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else {
      parts.push(`<circle cx="${f1(x2)}" cy="${f1(y2)}" r="2.6" fill="${color}"/>`);
    }
  }

  // Startplanet: yta ovanför den här linjen räknas inte, den hör till förladdningen.
  if (opts.free3dFromDepth <= 1e-9) {
    const sp = pointAt(r.path, opts.startDepth);
    const p0 = projectToSection(frame, sp.point);
    const ds = sp.dir[0] * frame.u[0] + sp.dir[1] * frame.u[1];
    const dz = sp.dir[2];
    // Vinkelrätt mot hålet i snittet; ps > 0 eftersom hålet går nedåt.
    const ps = -dz;
    const pz = ds;
    const tA = (L.sMin - p0.s) / ps;
    const tB = (sMax - p0.s) / ps;
    parts.push(
      `<line x1="${f1(X(p0.s + tA * ps))}" y1="${f1(Y(p0.z + tA * pz))}" x2="${f1(X(p0.s + tB * ps))}" y2="${f1(Y(p0.z + tB * pz))}" stroke="#9a9a9a" stroke-width="1.2" stroke-dasharray="6 5" opacity="0.8"/>`,
    );
  }

  // Hålbanan utan automatisk bäringskorrektion, som jämförelse
  if (r.ghost) {
    const gp = r.ghost.points.map((p) => projectToSection(frame, p));
    parts.push(
      `<polyline points="${gp.map((p) => `${f1(X(p.s))},${f1(Y(p.z))}`).join(" ")}" fill="none" stroke="${HOLE_COLOR}" stroke-width="1.4" stroke-dasharray="4 4" opacity="0.35" stroke-linejoin="round"/>`,
    );
  }

  // Hålet
  parts.push(
    `<polyline points="${hp.map((p) => `${f1(X(p.s))},${f1(Y(p.z))}`).join(" ")}" fill="none" stroke="${HOLE_COLOR}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  );

  // Djupmarkeringar var 0,5 m, siffra varje hel meter, vinkelrätt ut på högersidan
  for (let t = 0.5; t <= r.path.length + 1e-9; t += 0.5) {
    const [x0, y0] = screenAt(t);
    const [px, py] = perpAt(t);
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    const start = 9;
    const end = whole ? 22 : 15;
    parts.push(
      `<line x1="${f1(x0 + px * start)}" y1="${f1(y0 + py * start)}" x2="${f1(x0 + px * end)}" y2="${f1(y0 + py * end)}" stroke="${TICK_COLOR}" stroke-width="2.4" stroke-linecap="round"/>`,
    );
    if (whole) {
      const label = st.compact ? `${t}${t === 1 ? " m" : ""}` : `${fmt(t, 1)} m`;
      parts.push(`<text x="${f1(x0 + px * 29)}" y="${f1(y0 + py * 29 + 4.5)}" font-size="13" fill="${TICK_COLOR}">${label}</text>`);
    }
  }

  // Siffror vid ytan, en per kluster.
  const labels: { x: number; y0: number; y: number; text: string; color: string }[] = [];
  for (const cl of clusters) {
    const best = cl.reduce((a, b) => (b.row.burden! < a.row.burden! ? b : a));
    labels.push({
      x: X(best.q!.s) - (best.truncated ? 10 : 7),
      y0: Y(best.q!.z),
      y: Y(best.q!.z),
      text: fmt(best.row.burden, 2) + (best.truncated ? " ›" : ""),
      color: CLASS_COLORS[best.row.cls],
    });
  }
  labels.sort((a, b) => a.y0 - b.y0);
  const LABEL_H = 13;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y < labels[i - 1].y + LABEL_H) labels[i].y = labels[i - 1].y + LABEL_H;
  }
  for (let i = labels.length - 1; i > 0; i--) {
    const shift = (labels[i].y - labels[i].y0) / 2;
    if (shift > 0 && labels[i - 1].y + LABEL_H <= labels[i].y - shift) labels[i].y -= shift;
  }
  for (const l of labels) {
    if (Math.abs(l.y - l.y0) > 5) {
      parts.push(`<line x1="${f1(l.x + 5)}" y1="${f1(l.y0)}" x2="${f1(l.x + 1)}" y2="${f1(l.y)}" stroke="${l.color}" stroke-width="0.8" opacity="0.7"/>`);
    }
    parts.push(`<text x="${f1(l.x)}" y="${f1(l.y + 4.5)}" font-size="13" font-weight="700" fill="${l.color}" text-anchor="end">${l.text}</text>`);
  }
  parts.push(`</g>`);

  // Vridet snitt: en rundpil med snittets bäring i övre vänstra hörnet, så att det syns i själva bilden.
  const own = holeBearing(r);
  if (own !== null && bearingDifference(own, bearing) > 0.5) {
    const cx = ml + 18;
    const cy = mt + 18;
    const rad = 8;
    const a0 = (-150 * Math.PI) / 180;
    const a1 = (120 * Math.PI) / 180;
    const sx = cx + rad * Math.cos(a0);
    const sy = cy + rad * Math.sin(a0);
    const ex = cx + rad * Math.cos(a1);
    const ey = cy + rad * Math.sin(a1);
    // Tangenten medurs i slutpunkten ger pilspetsens riktning.
    const tx = -Math.sin(a1);
    const ty = Math.cos(a1);
    const nx = -ty;
    const ny = tx;
    const head = 4.5;
    parts.push(
      `<g class="section-turned" fill="none" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
        `<title>Snittet är vridet mot ${fmt(bearing, 0)}°, hålets bäring är ${fmt(own, 0)}°</title>` +
        `<path d="M ${f1(sx)} ${f1(sy)} A ${rad} ${rad} 0 1 1 ${f1(ex)} ${f1(ey)}"/>` +
        `<polyline points="${f1(ex - tx * head + nx * head)},${f1(ey - ty * head + ny * head)} ${f1(ex)},${f1(ey)} ${f1(ex - tx * head - nx * head)},${f1(ey - ty * head - ny * head)}"/>` +
        `<text x="${f1(cx + rad + 6)}" y="${f1(cy + 4)}" font-size="11" fill="#444" stroke="none">Snitt mot ${fmt(bearing, 0)}°</text>` +
        `</g>`,
    );
  }

  // Lager för avläsning med mus eller finger, fylls i av gränssnittet
  parts.push(`<g class="hover-layer" pointer-events="none"></g>`);

  if (!st.compact) parts.push(`<text x="${ml}" y="${H - 10}" font-size="11" fill="#666">${footerText(r, opts, false)}</text>`);

  if (st.showFront) parts.push(renderFrontPanel(r, opts, st.showTrace, L, Y, safeId, st.frontImage));

  parts.push(`</svg>`);

  const samples: HoverSample[] = r.fine.map((f) => {
    const p = projectToSection(frame, f.point);
    const q = f.closest ? projectToSection(frame, f.closest) : null;
    return {
      depth: f.depth,
      burden: f.burden,
      hx: Number(X(p.s).toFixed(1)),
      hy: Number(Y(p.z).toFixed(1)),
      cx: q ? Number(X(q.s).toFixed(1)) : null,
      cy: q ? Number(Y(q.z).toFixed(1)) : null,
    };
  });
  return { svg: parts.join("\n"), samples, layout: L };
}

/** Fristående bild av väggen framifrån, t.ex. för telefon. Bilden (frontImage) ska vara renderad för L:s utbredning. */
export function renderFrontSvg(
  r: HoleResult,
  opts: BurdenOptions,
  style: Partial<ProfileStyle>,
  L: FrontLayout,
  frontImage?: string,
): string {
  const st = { ...DEFAULT_PROFILE_STYLE, ...style };
  const W = L.width;
  const H = L.height;
  const Y = (z: number) => L.top + (L.zMax - z) * L.k;
  const safeId = `front-${r.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif" data-hole="${escapeXml(r.id)}" data-view="front">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (!st.compact) {
    parts.push(`<text x="${L.fx0}" y="26" font-size="20" font-weight="700" fill="#111">Hål ${escapeXml(r.id)}  ·  framifrån</text>`);
    headerLines(r, opts, L.bearing, false).forEach((line, i) => {
      parts.push(`<text x="${L.fx0}" y="${46 + i * 17}" font-size="12.5" fill="#444">${escapeXml(line)}</text>`);
    });
  }
  parts.push(renderFrontPanel(r, opts, st.showTrace, L, Y, safeId, frontImage, false));
  parts.push(`<g class="hover-layer" pointer-events="none"></g>`);
  if (!st.compact) parts.push(`<text x="${L.fx0}" y="${H - 10}" font-size="11" fill="#666">${footerText(r, opts, false)}</text>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Väggen sedd framifrån, i hålets bäringsriktning. Bakgrund: bild ur modellen om den
 * finns. Ovanpå: hålet (bakom väggen, streckat), ytspåret och stickornas ytpunkter.
 * Diskreta meterskalor på kanterna.
 */
function renderFrontPanel(
  r: HoleResult,
  opts: BurdenOptions,
  showTrace: boolean,
  G: FrontPanelGeom,
  Y: (z: number) => number,
  safeId: string,
  frontImage?: string,
  withTitle = true,
): string {
  const { frame, fx0, fw, latMin, latMax, zMin, zMax, k, bearing } = G;
  const FX = (lat: number) => fx0 + (lat - latMin) * k;
  const top = Y(zMax);
  const bottom = Y(zMin);
  const fh = bottom - top;
  const f1 = (v: number) => v.toFixed(1);
  const clipId = `clip-${safeId}`;
  const parts: string[] = [];
  parts.push(`<g font-size="9" fill="${SCALE_COLOR}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${f1(fx0)}" y="${f1(top)}" width="${f1(fw)}" height="${f1(fh)}"/></clipPath></defs>`);
  if (frontImage) {
    parts.push(`<image href="${frontImage}" x="${f1(fx0)}" y="${f1(top)}" width="${f1(fw)}" height="${f1(fh)}" preserveAspectRatio="none"/>`);
  } else {
    parts.push(`<rect x="${f1(fx0)}" y="${f1(top)}" width="${f1(fw)}" height="${f1(fh)}" fill="#f3f1ec"/>`);
  }
  parts.push(`<g clip-path="url(#${clipId})">`);

  // Hålet, bakom väggen
  const hole = r.path.points.map((p) => `${f1(FX(lateralOf(frame, p)))},${f1(Y(p[2]))}`);
  parts.push(`<polyline points="${hole.join(" ")}" fill="none" stroke="${HOLE_COLOR}" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.8"/>`);
  // Hålbanan utan automatisk bäringskorrektion: vridningen syns i sidled, alltså här och inte i snittet.
  if (r.ghost) {
    const ghost = r.ghost.points.map((p) => `${f1(FX(lateralOf(frame, p)))},${f1(Y(p[2]))}`);
    parts.push(`<polyline points="${ghost.join(" ")}" fill="none" stroke="${HOLE_COLOR}" stroke-width="1.4" stroke-dasharray="3 4" opacity="0.4"/>`);
  }

  // Ytspåret
  if (showTrace) {
    const pts: string[] = [];
    for (const f of r.fine) {
      if (!f.closest || f.depth < opts.startDepth - 1e-9) continue;
      pts.push(`${f1(FX(lateralOf(frame, f.closest)))},${f1(Y(f.closest[2]))}`);
    }
    if (pts.length > 1) {
      parts.push(`<polyline class="front-trace" points="${pts.join(" ")}" fill="none" stroke="${TRACE_COLOR}" stroke-width="1.6" stroke-linejoin="round"/>`);
    }
  }

  // Stickornas ytpunkter
  for (const row of r.rows) {
    if (!row.closest || row.cls === "collar" || row.cls === "skipped" || row.burden === null) continue;
    parts.push(
      `<circle cx="${f1(FX(lateralOf(frame, row.closest)))}" cy="${f1(Y(row.closest[2]))}" r="3.2" fill="${CLASS_COLORS[row.cls]}" stroke="#fff" stroke-width="1"/>`,
    );
  }

  // Meterskalor: höjd på båda sidor, sidledes längs nederkanten
  const every = k >= 22 ? 1 : 2;
  for (let z = Math.ceil(zMin); z <= Math.floor(zMax); z++) {
    const y = Y(z);
    const major = z % every === 0;
    const len = major ? 6 : 3;
    parts.push(`<line x1="${f1(fx0)}" y1="${f1(y)}" x2="${f1(fx0 + len)}" y2="${f1(y)}" stroke="${SCALE_COLOR}" stroke-width="1"/>`);
    parts.push(`<line x1="${f1(fx0 + fw - len)}" y1="${f1(y)}" x2="${f1(fx0 + fw)}" y2="${f1(y)}" stroke="${SCALE_COLOR}" stroke-width="1"/>`);
    if (major && y > top + 8 && y < bottom - 12) {
      parts.push(`<text x="${f1(fx0 + 8)}" y="${f1(y + 3)}" stroke="#fff" stroke-width="2.5" paint-order="stroke">+${z}</text>`);
    }
  }
  for (let lat = Math.ceil(latMin); lat <= Math.floor(latMax); lat++) {
    const x = FX(lat);
    const major = lat % every === 0;
    const len = major ? 6 : 3;
    parts.push(`<line x1="${f1(x)}" y1="${f1(bottom - len)}" x2="${f1(x)}" y2="${f1(bottom)}" stroke="${SCALE_COLOR}" stroke-width="1"/>`);
    if (major && x > fx0 + 10 && x < fx0 + fw - 10) {
      parts.push(`<text x="${f1(x)}" y="${f1(bottom - 8)}" text-anchor="middle" stroke="#fff" stroke-width="2.5" paint-order="stroke">${lat > 0 ? "+" : ""}${lat}</text>`);
    }
  }
  parts.push(`</g>`);
  parts.push(`<rect x="${f1(fx0)}" y="${f1(top)}" width="${f1(fw)}" height="${f1(fh)}" fill="none" stroke="#c8c8c8"/>`);
  if (withTitle) {
    parts.push(
      `<text x="${f1(fx0 + fw - 8)}" y="${f1(top + 14)}" font-size="11" fill="#444" text-anchor="end" stroke="#fff" stroke-width="3" paint-order="stroke">Framifrån, bäring ${fmt(bearing, 0)}°</text>`,
    );
  }
  parts.push(`</g>`);
  return parts.join("\n");
}

/** Markering för avläsning: linje från hålpunkt till ytpunkt med mått och djup. */
export function hoverMarkup(s: HoverSample): string {
  const f1 = (v: number) => v.toFixed(1);
  const parts: string[] = [];
  const color = "#6a1b9a";
  if (s.cx !== null && s.cy !== null) {
    parts.push(`<line x1="${f1(s.hx)}" y1="${f1(s.hy)}" x2="${f1(s.cx)}" y2="${f1(s.cy)}" stroke="${color}" stroke-width="2.2" stroke-dasharray="5 3"/>`);
    parts.push(`<circle cx="${f1(s.cx)}" cy="${f1(s.cy)}" r="4" fill="${color}"/>`);
    const mx = (s.hx + s.cx) / 2;
    const my = (s.hy + s.cy) / 2;
    parts.push(
      `<text x="${f1(mx)}" y="${f1(my - 8)}" font-size="15" font-weight="700" fill="${color}" text-anchor="middle" stroke="#fff" stroke-width="4" paint-order="stroke">${fmt(s.burden, 2)} m</text>`,
    );
  }
  parts.push(`<circle cx="${f1(s.hx)}" cy="${f1(s.hy)}" r="5" fill="#fff" stroke="${color}" stroke-width="2.2"/>`);
  parts.push(
    `<text x="${f1(s.hx + 34)}" y="${f1(s.hy - 10)}" font-size="12" fill="${color}" stroke="#fff" stroke-width="3.5" paint-order="stroke">djup ${fmt(s.depth, 2)} m</text>`,
  );
  return parts.join("");
}
