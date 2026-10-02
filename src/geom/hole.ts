import type { SondeStation } from "../io/dm4";
import { add, lerp, normalize, scale, toRad, type Vec3 } from "./vec";

export type PathMethod = "average" | "tangent";

export interface HoleInput {
  id: string;
  /** Påhugg i E N Z. */
  collar: Vec3;
  stations: SondeStation[];
}

export interface PathOptions {
  /** "average" = medelvinkelmetoden (standard), "tangent" = tangentmetoden. */
  method?: PathMethod;
  /** Korrektion som läggs till alla bäringar, i grader. */
  bearingCorrection?: number;
}

export interface HolePath {
  id: string;
  collar: Vec3;
  /** Djup längs hålet vid varje brytpunkt, börjar på 0. */
  depths: number[];
  /** Läge i E N Z vid varje brytpunkt. */
  points: Vec3[];
  /** Enhetsriktning (nedåt i hålet) för segmentet mellan brytpunkt k och k+1. */
  segDirs: Vec3[];
  /** Total längd längs hålet. */
  length: number;
}

/** Riktningsvektor i E N Z från bäring (medurs från norr) och lutning från lodlinjen, båda i grader. */
export function directionFromBearingInclination(bearingDeg: number, inclinationDeg: number): Vec3 {
  const a = toRad(bearingDeg);
  const i = toRad(inclinationDeg);
  return [Math.sin(i) * Math.sin(a), Math.sin(i) * Math.cos(a), -Math.cos(i)];
}

/** Bygger hålets bana från påhugg och sonderingsstationer. */
export function buildHolePath(input: HoleInput, opts: PathOptions = {}): HolePath {
  const method = opts.method ?? "average";
  const corr = opts.bearingCorrection ?? 0;

  let st = [...input.stations].sort((a, b) => a.depth - b.depth);
  st = st.filter((s, i) => i === 0 || s.depth - st[i - 1].depth > 1e-9);
  if (st.length === 0) throw new Error(`Hål ${input.id}: inga mätpunkter.`);
  if (st[0].depth > 1e-9) {
    st = [{ depth: 0, bearing: st[0].bearing, inclination: st[0].inclination }, ...st];
  }
  if (st.length < 2) throw new Error(`Hål ${input.id}: minst två mätpunkter behövs.`);

  const dirs = st.map((s) => directionFromBearingInclination(s.bearing + corr, s.inclination));
  const points: Vec3[] = [[...input.collar] as Vec3];
  const depths: number[] = [st[0].depth];
  const segDirs: Vec3[] = [];
  for (let k = 0; k + 1 < st.length; k++) {
    const L = st[k + 1].depth - st[k].depth;
    const d = method === "tangent" ? dirs[k] : normalize(add(dirs[k], dirs[k + 1]));
    segDirs.push(d);
    points.push(add(points[k], scale(d, L)));
    depths.push(st[k + 1].depth);
  }
  return { id: input.id, collar: input.collar, depths, points, segDirs, length: depths[depths.length - 1] };
}

/** Läge och lokal riktning på ett visst djup längs hålet. */
export function pointAt(path: HolePath, depth: number): { point: Vec3; dir: Vec3 } {
  const d = Math.min(Math.max(depth, 0), path.length);
  let k = 0;
  while (k + 2 < path.depths.length && d > path.depths[k + 1]) k++;
  const span = path.depths[k + 1] - path.depths[k];
  const t = span > 0 ? (d - path.depths[k]) / span : 0;
  return { point: lerp(path.points[k], path.points[k + 1], t), dir: path.segDirs[k] };
}

export interface SampleDepth {
  depth: number;
  isInterval: boolean;
  isStation: boolean;
  isBottom: boolean;
}

/** Provdjup längs hålet: jämnt mått från påhugget, valfritt även stationerna, alltid botten. */
export function sampleDepths(path: HolePath, interval: number, includeStations = true): SampleDepth[] {
  if (!(interval > 0)) throw new Error("Måttet mellan provpunkter måste vara större än 0.");
  const map = new Map<number, SampleDepth>();
  const key = (d: number) => Math.round(d * 1000);
  const put = (d: number, patch: Partial<SampleDepth>) => {
    const k = key(d);
    const cur = map.get(k) ?? { depth: d, isInterval: false, isStation: false, isBottom: false };
    map.set(k, { ...cur, ...patch });
  };
  const nSteps = Math.floor(path.length / interval + 1e-9);
  for (let i = 0; i <= nSteps; i++) put(i * interval, { isInterval: true });
  if (includeStations) for (const d of path.depths) put(d, { isStation: true });
  put(path.length, { isBottom: true });
  return [...map.values()].sort((a, b) => a.depth - b.depth);
}
