import { Box3, Vector3 } from "three";
import type { ExtendedTriangle } from "three-mesh-bvh";
import type { HoleResult } from "./burden";
import type { Surface } from "./surface";
import { bearingOf, sub, toRad, type Vec3 } from "./vec";

/** Ett lodrätt snittplan genom en punkt, orienterat efter en bäring. */
export interface SectionFrame {
  origin: Vec3;
  bearing: number;
  /** Horisontell enhetsvektor längs bäringen (E, N, 0). */
  u: Vec3;
  /** Horisontell normal till planet. */
  n: Vec3;
}

export function makeFrame(origin: Vec3, bearingDeg: number): SectionFrame {
  const b = toRad(bearingDeg);
  return { origin, bearing: bearingDeg, u: [Math.sin(b), Math.cos(b), 0], n: [Math.cos(b), -Math.sin(b), 0] };
}

/** Projektion av en punkt i snittet: s längs bäringen, z absolut höjd, off sidledes avstånd från planet. */
export function projectToSection(f: SectionFrame, p: Vec3): { s: number; z: number; off: number } {
  const d = sub(p, f.origin);
  return { s: d[0] * f.u[0] + d[1] * f.u[1], z: p[2], off: d[0] * f.n[0] + d[1] * f.n[1] };
}

export interface SectionWindow {
  sMin: number;
  sMax: number;
  zMin: number;
  zMax: number;
}

/**
 * Ytmodellens skärning med snittplanet inom ett fönster. Returnerar segment
 * som [s0, z0, s1, z1, ...] i snittkoordinater (z är absolut höjd).
 */
export function sectionSegments(surface: Surface, f: SectionFrame, win: SectionWindow): Float64Array {
  const o = surface.toLocal(f.origin);
  const n = new Vector3(f.n[0], f.n[1], 0);
  const u = new Vector3(f.u[0], f.u[1], 0);
  const absNx = Math.abs(n.x);
  const absNy = Math.abs(n.y);
  const absUx = Math.abs(u.x);
  const absUy = Math.abs(u.y);
  const zOff = surface.origin[2];
  const out: number[] = [];
  const center = new Vector3();
  const half = new Vector3();
  const pts = [new Vector3(), new Vector3()];
  const d = [0, 0, 0];
  const inWin = (s: number, z: number) => s >= win.sMin && s <= win.sMax && z >= win.zMin && z <= win.zMax;

  surface.bvh.shapecast({
    intersectsBounds: (box: Box3) => {
      box.getCenter(center);
      box.getSize(half).multiplyScalar(0.5);
      const dc = (center.x - o.x) * n.x + (center.y - o.y) * n.y;
      if (Math.abs(dc) > half.x * absNx + half.y * absNy) return false;
      const sc = (center.x - o.x) * u.x + (center.y - o.y) * u.y;
      const reachU = half.x * absUx + half.y * absUy;
      if (sc + reachU < win.sMin || sc - reachU > win.sMax) return false;
      const zc = center.z + zOff;
      if (zc + half.z < win.zMin || zc - half.z > win.zMax) return false;
      return true;
    },
    intersectsTriangle: (tri: ExtendedTriangle) => {
      const v = [tri.a, tri.b, tri.c];
      for (let i = 0; i < 3; i++) d[i] = (v[i].x - o.x) * n.x + (v[i].y - o.y) * n.y;
      let k = 0;
      for (let i = 0; i < 3 && k < 2; i++) {
        const j = (i + 1) % 3;
        if (d[i] >= 0 !== d[j] >= 0) {
          const t = d[i] / (d[i] - d[j]);
          pts[k++].copy(v[i]).lerp(v[j], t);
        }
      }
      if (k === 2) {
        const s0 = (pts[0].x - o.x) * u.x + (pts[0].y - o.y) * u.y;
        const z0 = pts[0].z + zOff;
        const s1 = (pts[1].x - o.x) * u.x + (pts[1].y - o.y) * u.y;
        const z1 = pts[1].z + zOff;
        if (inWin(s0, z0) || inWin(s1, z1)) out.push(s0, z0, s1, z1);
      }
      return false;
    },
  });
  return Float64Array.from(out);
}

/** Hålets huvudbäring: från påhugg till botten, eller mätningarnas medelriktning för lodräta hål. */
export function holeMeanBearing(r: HoleResult): number {
  const path = r.path;
  const bottom = path.points[path.points.length - 1];
  const dE = bottom[0] - path.collar[0];
  const dN = bottom[1] - path.collar[1];
  if (Math.hypot(dE, dN) > 0.3) return bearingOf(dE, dN);
  let x = 0;
  let y = 0;
  for (const row of r.rows) {
    if (!row.closest || row.cls === "collar" || row.cls === "skipped") continue;
    const v = sub(row.closest, row.point);
    const h = Math.hypot(v[0], v[1]);
    if (h > 1e-6) {
      x += v[0] / h;
      y += v[1] / h;
    }
  }
  if (Math.hypot(x, y) > 1e-6) return bearingOf(x, y);
  return 0;
}

/** Hålets medellutning från lodlinjen i grader, från påhugg till botten. */
export function holeMeanInclination(r: HoleResult): number {
  const path = r.path;
  const bottom = path.points[path.points.length - 1];
  const h = Math.hypot(bottom[0] - path.collar[0], bottom[1] - path.collar[1]);
  const v = path.collar[2] - bottom[2];
  return (Math.atan2(h, v) * 180) / Math.PI;
}
