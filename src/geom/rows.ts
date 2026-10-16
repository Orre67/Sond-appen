import { classOf, type BurdenOptions, type HoleResult } from "./burden";
import type { HolePath } from "./hole";
import { burdenBearing, holeBearing } from "./section";
import { distance, dot, lerp, sub, toRad, type Vec3 } from "./vec";

/** Hålet i raden framför: det som ett hål i en bakre rad mäter sin försättning mot när det ligger närmare än stuffen. */
export interface HoleFront {
  id: string;
  path: HolePath;
}

/** Hål längre bort än så här från varandra, i plan, räknas inte som raden framför. */
export const ROW_MAX_DISTANCE = 12;

/** Så långt under hålets slut, meter längs hålet, som slutpunkten ändå får mätas mot: hål som slutar på nästan samma djup. */
export const BOTTOM_TOLERANCE = 1.0;

/**
 * Närmaste punkt på en bruten linje från en punkt, och avståndet dit, i 3D. atBottom är sant när
 * punkten är banans sista och p ligger mer än BOTTOM_TOLERANCE bortom slutet, dvs. när hålet
 * slutar tydligt innan det kommer i höjd med p.
 */
export function closestOnPath(path: HolePath, p: Vec3): { point: Vec3; distance: number; atBottom: boolean } {
  let best: Vec3 = path.points[0];
  let bd = distance(p, best);
  let atBottom = path.points.length === 1;
  for (let k = 0; k + 1 < path.points.length; k++) {
    const a = path.points[k];
    const b = path.points[k + 1];
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const tRaw = len2 > 0 ? dot(sub(p, a), ab) / len2 : 0;
    const t = Math.min(1, Math.max(0, tRaw));
    const q = lerp(a, b, t);
    const d = distance(p, q);
    if (d < bd) {
      bd = d;
      best = q;
      // Bortom sista segmentets slut med mer än toleransen: hålet slutar innan det kommer i höjd med p
      atBottom = k + 2 === path.points.length && (tRaw - 1) * Math.sqrt(len2) > BOTTOM_TOLERANCE;
    }
  }
  return { point: best, distance: bd, atBottom };
}

/** Riktningen mot stuffen för ett hål: skjutriktningen när den finns, annars försättningens riktning, annars hålets bäring. */
export function faceBearing(r: HoleResult, blastBearing: number | null): number | null {
  if (blastBearing !== null) return blastBearing;
  return burdenBearing(r) ?? holeBearing(r);
}

/** Närmaste hål i en riktning i plan, inom 45° från den, högst maxDistance bort. */
function nearestInDirection(r: HoleResult, results: HoleResult[], dirE: number, dirN: number, maxDistance: number): HoleResult | null {
  let best: HoleResult | null = null;
  let bestD = Infinity;
  for (const o of results) {
    if (o === r) continue;
    const dE = o.path.collar[0] - r.path.collar[0];
    const dN = o.path.collar[1] - r.path.collar[1];
    const along = dE * dirE + dN * dirN;
    const side = Math.abs(dE * dirN - dN * dirE);
    if (along < 0.3 || side > along) continue;
    const d = Math.hypot(dE, dN);
    if (d <= maxDistance && d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/**
 * Parar varje hål med hålet i raden framför: närmaste hål inom 45° från rakt framåt, sett mot stuffen,
 * i skjutriktningen när den finns. Hål med ett hål framför mäter sedan sin försättning mot det hålet
 * där det ligger närmare än stuffen: stickans värde blir det kortaste avståndet till hålet framför,
 * ytans värde sparas i surfaceBurden, och minsta försättning räknas om. Första raden har inget hål
 * framför. Resultatet skrivs in som r.front och i r.rows; en ny parning börjar från ytans värden.
 */
export function pairRows(results: HoleResult[], blastBearing: number | null, opts: BurdenOptions, maxDistance = ROW_MAX_DISTANCE): void {
  for (const r of results) {
    delete r.front;
    restoreSurfaceBurden(r, opts);
  }
  for (const r of results) {
    const bearing = faceBearing(r, blastBearing);
    if (bearing === null) continue;
    const front = nearestInDirection(r, results, Math.sin(toRad(bearing)), Math.cos(toRad(bearing)), maxDistance);
    if (!front) continue;
    r.front = { id: front.id, path: front.path };
    measureToFront(r, front, opts);
  }
}

/** Tar tillbaka ytans försättning i raderna och provpunkterna, inför en ny parning. */
function restoreSurfaceBurden(r: HoleResult, opts: BurdenOptions): void {
  let changed = false;
  for (const row of r.rows) {
    if (row.toHole) {
      row.burden = row.surfaceBurden ?? null;
      row.closest = row.surfaceClosest ?? null;
      row.cls = classOf(row.burden, false, opts);
      delete row.toHole;
      delete row.surfaceBurden;
      delete row.surfaceClosest;
      changed = true;
    }
  }
  if (changed) updateMinBurden(r);
}

/**
 * Stickans värde blir avståndet till hålet framför när det är kortare än till ytan: det kortaste
 * 3D-avståndet från stickans täta provpunkter till hålet framförs bana. Under hålet framförs slut,
 * till exempel där dess sondering stoppat, finns inget att mäta mot: där gäller ytan igen.
 */
function measureToFront(r: HoleResult, front: HoleResult, opts: BurdenOptions): void {
  let changed = false;
  for (const row of r.rows) {
    if (row.cls === "collar" || row.cls === "skipped") continue;
    let best: { point: Vec3; distance: number } | null = null;
    const samples = r.fine.filter((f) => f.depth >= row.stickStart - 1e-9 && f.depth <= row.stickEnd + 1e-9);
    for (const f of samples.length ? samples : [{ point: row.point }]) {
      const c = closestOnPath(front.path, f.point);
      if (c.atBottom) continue;
      if (!best || c.distance < best.distance) best = c;
    }
    if (!best) continue;
    if (row.burden !== null && best.distance >= row.burden) continue;
    row.surfaceBurden = row.burden;
    row.surfaceClosest = row.closest;
    row.burden = best.distance;
    row.closest = best.point;
    row.cls = classOf(best.distance, false, opts);
    row.toHole = true;
    changed = true;
  }
  if (changed) updateMinBurden(r);
}

/** Minsta försättning bland stickor under startdjupet, som i computeHole. */
function updateMinBurden(r: HoleResult): void {
  let minBurden: number | null = null;
  let minBurdenDepth: number | null = null;
  for (const row of r.rows) {
    if (row.cls === "collar" || row.cls === "skipped" || row.burden === null) continue;
    if (minBurden === null || row.burden < minBurden) {
      minBurden = row.burden;
      minBurdenDepth = row.depth;
    }
  }
  r.minBurden = minBurden;
  r.minBurdenDepth = minBurdenDepth;
}
