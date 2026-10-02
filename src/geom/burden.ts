import { buildHolePath, pointAt, sampleDepths, type HoleInput, type HolePath, type PathMethod } from "./hole";
import type { Surface } from "./surface";
import { bearingOf, elevationOf, sub, type Vec3 } from "./vec";

export type SamplingMode = "stick" | "point";

export interface BurdenOptions {
  /** Måttstickans längd (läge "stick") eller avståndet mellan punkter (läge "point"), meter. */
  interval: number;
  /** "stick": sämsta värdet inom varje sticka. "point": värdet i själva punkten. */
  mode: SamplingMode;
  /** Internt söksteg längs hålet, meter. Styr även ytspårets upplösning. */
  fineStep: number;
  method: PathMethod;
  bearingCorrection: number;
  /** Under detta värde blir punkten röd. */
  minBurden: number;
  /** Över detta värde blir punkten blå. */
  maxBurden: number;
  /** Hur långt bakom det vinkelräta planet (mot påhugget) yta ändå får räknas, meter. */
  backTolerance: number;
  /** Startdjup: stickor och punkter ovanför detta klassas som "skipped" och räknas inte in i minsta försättning. */
  startDepth: number;
}

export const DEFAULT_OPTIONS: BurdenOptions = {
  interval: 1.0,
  mode: "stick",
  fineStep: 0.05,
  method: "average",
  bearingCorrection: 0,
  minBurden: 1.5,
  maxBurden: 3.5,
  backTolerance: 0.05,
  startDepth: 1.0,
};

export type BurdenClass = "collar" | "skipped" | "low" | "ok" | "high" | "none";

/** En tät provpunkt längs hålet, underlag för stickminimum, ytspår och avläsning. */
export interface FineSample {
  depth: number;
  point: Vec3;
  dir: Vec3;
  burden: number | null;
  closest: Vec3 | null;
}

export interface BurdenRow {
  /** Djup där värdet gäller: stickans sämsta punkt, eller själva punkten i punktläge. */
  depth: number;
  /** Stickans utbredning längs hålet. I punktläge är båda lika med depth. */
  stickStart: number;
  stickEnd: number;
  isInterval: boolean;
  isStation: boolean;
  isBottom: boolean;
  /** Provpunktens läge i E N Z. */
  point: Vec3;
  /** Hålets riktning vid punkten. */
  dir: Vec3;
  /** Försättning enligt regeln "mät aldrig bakåt". null om ingen yta hittades. */
  burden: number | null;
  closest: Vec3 | null;
  /** Bäring och höjdvinkel från provpunkten till närmaste ytpunkt. */
  bearingTo: number | null;
  elevationTo: number | null;
  /** Fritt minsta 3D-avstånd utan riktningsregel, för tabellen. */
  free3d: number | null;
  freeClosest: Vec3 | null;
  cls: BurdenClass;
}

export interface HoleResult {
  id: string;
  path: HolePath;
  /** Visningsrader: påhugg följt av en rad per sticka eller punkt. */
  rows: BurdenRow[];
  /** Täta provpunkter från påhugg till botten. */
  fine: FineSample[];
  /** Minsta försättning bland stickor/punkter under startdjupet. */
  minBurden: number | null;
  minBurdenDepth: number | null;
}

function classOf(burden: number | null, skipped: boolean, opts: BurdenOptions): BurdenClass {
  if (skipped) return "skipped";
  if (burden === null) return "none";
  if (burden < opts.minBurden) return "low";
  if (burden > opts.maxBurden) return "high";
  return "ok";
}

/** Stickgränser längs hålet: startdjupet är alltid en gräns, stickorna läggs ut åt båda hållen från det. */
export function stickBoundaries(length: number, interval: number, startDepth: number): number[] {
  if (!(interval > 0)) throw new Error("Måttstickan måste vara längre än 0.");
  const set = new Set<number>([0, length]);
  const first = startDepth - Math.floor(startDepth / interval + 1e-9) * interval;
  for (let b = first; b < length - 1e-6; b += interval) if (b > 1e-9) set.add(Number(b.toFixed(6)));
  return [...set].sort((a, b) => a - b);
}

export function computeHole(surface: Surface, hole: HoleInput, options: Partial<BurdenOptions> = {}): HoleResult {
  const opts: BurdenOptions = { ...DEFAULT_OPTIONS, ...options };
  const path = buildHolePath(hole, { method: opts.method, bearingCorrection: opts.bearingCorrection });

  // Täta provpunkter
  const fine: FineSample[] = [];
  const step = Math.max(0.01, opts.fineStep);
  const n = Math.floor(path.length / step + 1e-9);
  const fineDepths: number[] = [];
  for (let i = 0; i <= n; i++) fineDepths.push(i * step);
  if (path.length - fineDepths[fineDepths.length - 1] > 1e-6) fineDepths.push(path.length);
  for (const d of fineDepths) {
    const { point, dir } = pointAt(path, d);
    const hit = surface.closestPoint(point, { normal: dir, tolerance: opts.backTolerance });
    fine.push({ depth: d, point, dir, burden: hit ? hit.distance : null, closest: hit ? hit.point : null });
  }

  const rows: BurdenRow[] = [];
  const makeRow = (
    depth: number,
    stickStart: number,
    stickEnd: number,
    point: Vec3,
    dir: Vec3,
    burden: number | null,
    closest: Vec3 | null,
    cls: BurdenClass,
    isBottom: boolean,
  ): BurdenRow => {
    const free = surface.closestPoint(point);
    let bearingTo: number | null = null;
    let elevationTo: number | null = null;
    if (closest) {
      const v = sub(closest, point);
      bearingTo = bearingOf(v[0], v[1]);
      elevationTo = elevationOf(v);
    }
    return {
      depth, stickStart, stickEnd, isInterval: true, isStation: false, isBottom, point, dir, burden, closest,
      bearingTo, elevationTo, free3d: free ? free.distance : null, freeClosest: free ? free.point : null, cls,
    };
  };

  // Påhugget
  const c0 = fine[0];
  rows.push(makeRow(0, 0, 0, c0.point, c0.dir, c0.burden, c0.closest, "collar", false));

  if (opts.mode === "point") {
    for (const s of sampleDepths(path, opts.interval, false)) {
      if (s.depth <= 1e-9) continue;
      const { point, dir } = pointAt(path, s.depth);
      const hit = surface.closestPoint(point, { normal: dir, tolerance: opts.backTolerance });
      const skipped = s.depth < opts.startDepth - 1e-9;
      rows.push(makeRow(s.depth, s.depth, s.depth, point, dir, hit ? hit.distance : null, hit ? hit.point : null, classOf(hit ? hit.distance : null, skipped, opts), s.isBottom));
    }
  } else {
    const bounds = stickBoundaries(path.length, opts.interval, opts.startDepth);
    for (let k = 0; k + 1 < bounds.length; k++) {
      const a = bounds[k];
      const b = bounds[k + 1];
      // Punkter inom bakåttoleransen från påhugget hoppas över, där släpper planet in själva påhuggsytan.
      let best: FineSample | null = null;
      for (const f of fine) {
        if (f.depth < a - 1e-9 || f.depth <= opts.backTolerance + 1e-9) continue;
        if (f.depth > b + 1e-9) break;
        if (f.burden === null) continue;
        if (!best || f.burden < best.burden!) best = f;
      }
      const skipped = b <= opts.startDepth + 1e-9;
      const isBottom = b >= path.length - 1e-9;
      if (best) rows.push(makeRow(best.depth, a, b, best.point, best.dir, best.burden, best.closest, classOf(best.burden, skipped, opts), isBottom));
      else {
        const { point, dir } = pointAt(path, a);
        rows.push(makeRow(a, a, b, point, dir, null, null, classOf(null, skipped, opts), isBottom));
      }
    }
  }

  let minBurden: number | null = null;
  let minBurdenDepth: number | null = null;
  for (const row of rows) {
    if (row.burden === null || row.cls === "collar" || row.cls === "skipped") continue;
    if (minBurden === null || row.burden < minBurden) {
      minBurden = row.burden;
      minBurdenDepth = row.depth;
    }
  }
  return { id: hole.id, path, rows, fine, minBurden, minBurdenDepth };
}
