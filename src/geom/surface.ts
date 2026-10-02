import { Box3, BufferAttribute, BufferGeometry, Line3, Triangle, Vector3 } from "three";
import { MeshBVH, type ExtendedTriangle } from "three-mesh-bvh";
import type { Bounds, MeshData } from "../io/mesh";
import { meshBounds } from "../io/mesh";
import type { Vec3 } from "./vec";

export interface HalfSpace {
  /** Enhetsnormal. Bara yta med (q - p) · normal >= -tolerance räknas. */
  normal: Vec3;
  tolerance: number;
}

export interface ClosestHit {
  /** Närmaste punkt på ytan i E N Z. */
  point: Vec3;
  distance: number;
  faceIndex: number;
}

/**
 * Ytmodell med sökindex (BVH). Koordinaterna flyttas till ett lokalt origo
 * innan de lagras i float32, annars tappar SWEREF-koordinater runt 0,8 m i precision.
 */
export class Surface {
  readonly origin: Vec3;
  readonly bounds: Bounds;
  readonly geometry: BufferGeometry;
  readonly bvh: MeshBVH;
  readonly triangleCount: number;

  private constructor(origin: Vec3, bounds: Bounds, geometry: BufferGeometry, bvh: MeshBVH) {
    this.origin = origin;
    this.bounds = bounds;
    this.geometry = geometry;
    this.bvh = bvh;
    this.triangleCount = (geometry.index?.count ?? 0) / 3;
  }

  static fromMesh(mesh: MeshData): Surface {
    const bounds = meshBounds(mesh);
    const origin: Vec3 = [
      Math.floor((bounds.min[0] + bounds.max[0]) / 2),
      Math.floor((bounds.min[1] + bounds.max[1]) / 2),
      Math.floor((bounds.min[2] + bounds.max[2]) / 2),
    ];
    const local = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      local[i] = mesh.positions[i] - origin[0];
      local[i + 1] = mesh.positions[i + 1] - origin[1];
      local[i + 2] = mesh.positions[i + 2] - origin[2];
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(local, 3));
    geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
    const bvh = new MeshBVH(geometry);
    return new Surface(origin, bounds, geometry, bvh);
  }

  toLocal(p: Vec3): Vector3 {
    return new Vector3(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]);
  }

  toWorld(v: Vector3): Vec3 {
    return [v.x + this.origin[0], v.y + this.origin[1], v.z + this.origin[2]];
  }

  /**
   * Närmaste punkt på ytan från p. Med halvrum räknas bara yta på den sida av
   * planet genom p (med given normal) som normalen pekar mot, med viss tolerans.
   */
  closestPoint(p: Vec3, halfSpace?: HalfSpace): ClosestHit | null {
    const pl = this.toLocal(p);
    const n = halfSpace ? new Vector3(...halfSpace.normal).normalize() : null;
    const offset = n ? pl.dot(n) - halfSpace!.tolerance : 0;
    const absN = n ? new Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) : null;

    let best = Infinity;
    const bestPoint = new Vector3();
    let bestFace = -1;
    const tmp = new Vector3();
    const center = new Vector3();
    const half = new Vector3();

    this.bvh.shapecast({
      boundsTraverseOrder: (box: Box3) => box.distanceToPoint(pl),
      intersectsBounds: (box: Box3, _isLeaf: boolean, score: number | undefined) => {
        const d = score ?? box.distanceToPoint(pl);
        if (d >= best) return false;
        if (n && absN) {
          box.getCenter(center);
          box.getSize(half).multiplyScalar(0.5);
          const reach = half.dot(absN);
          if (center.dot(n) + reach < offset) return false;
        }
        return true;
      },
      intersectsTriangle: (tri: ExtendedTriangle, triIndex: number) => {
        let d: number;
        if (!n) {
          tri.closestPointToPoint(pl, tmp);
          d = tmp.distanceTo(pl);
        } else {
          d = closestOnClippedTriangle(tri, n, offset, pl, tmp);
        }
        if (d < best) {
          best = d;
          bestPoint.copy(tmp);
          bestFace = triIndex;
        }
        return false;
      },
    });

    if (!Number.isFinite(best)) return null;
    return { point: this.toWorld(bestPoint), distance: best, faceIndex: bestFace };
  }
}

const _poly: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const _tri = new Triangle();
const _line = new Line3();
const _tmp = new Vector3();

/**
 * Närmaste punkt på den del av triangeln som uppfyller q · n >= offset.
 * Returnerar Infinity om ingen del av triangeln ligger i halvrummet.
 */
function closestOnClippedTriangle(tri: Triangle, n: Vector3, offset: number, p: Vector3, target: Vector3): number {
  const sa = tri.a.dot(n) - offset;
  const sb = tri.b.dot(n) - offset;
  const sc = tri.c.dot(n) - offset;
  if (sa >= 0 && sb >= 0 && sc >= 0) {
    tri.closestPointToPoint(p, target);
    return target.distanceTo(p);
  }
  if (sa < 0 && sb < 0 && sc < 0) return Infinity;

  // Sutherland-Hodgman mot ett plan ger högst fyra hörn.
  const verts = [tri.a, tri.b, tri.c];
  const sides = [sa, sb, sc];
  let count = 0;
  for (let i = 0; i < 3; i++) {
    const cur = verts[i];
    const nxt = verts[(i + 1) % 3];
    const s0 = sides[i];
    const s1 = sides[(i + 1) % 3];
    if (s0 >= 0) _poly[count++].copy(cur);
    if (s0 >= 0 !== s1 >= 0) {
      const t = s0 / (s0 - s1);
      _poly[count++].copy(cur).lerp(nxt, t);
    }
  }
  if (count === 0) return Infinity;

  let bestSq = Infinity;
  if (count === 1) {
    target.copy(_poly[0]);
    return target.distanceTo(p);
  }
  for (let i = 1; i + 1 < count; i++) {
    _tri.set(_poly[0], _poly[i], _poly[i + 1]);
    if (_tri.getArea() > 1e-14) {
      _tri.closestPointToPoint(p, _tmp);
      const d = _tmp.distanceToSquared(p);
      if (d < bestSq) {
        bestSq = d;
        target.copy(_tmp);
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const a = _poly[i];
    const b = _poly[(i + 1) % count];
    if (a.distanceToSquared(b) < 1e-20) {
      const d = a.distanceToSquared(p);
      if (d < bestSq) {
        bestSq = d;
        target.copy(a);
      }
      continue;
    }
    _line.set(a, b);
    _line.closestPointToPoint(p, true, _tmp);
    const d = _tmp.distanceToSquared(p);
    if (d < bestSq) {
      bestSq = d;
      target.copy(_tmp);
    }
  }
  return Math.sqrt(bestSq);
}
