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

/** Ett halvrum i lokala koordinater: yta med q · n >= offset räknas. */
interface Plane {
  n: Vector3;
  absN: Vector3;
  offset: number;
}

const MAX_PLANES = 6;
const MAX_VERTS = 3 + MAX_PLANES;

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
   * Närmaste punkt på ytan från p. Med ett eller flera halvrum räknas bara yta som ligger
   * på rätt sida av alla planen genom p (med given normal), med viss tolerans.
   */
  closestPoint(p: Vec3, constraints?: HalfSpace | HalfSpace[]): ClosestHit | null {
    const pl = this.toLocal(p);
    const list = constraints === undefined ? [] : Array.isArray(constraints) ? constraints : [constraints];
    if (list.length > MAX_PLANES) throw new Error(`Högst ${MAX_PLANES} halvrum åt gången.`);
    const planes: Plane[] = list.map((h) => {
      const n = new Vector3(...h.normal).normalize();
      return { n, absN: new Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)), offset: pl.dot(n) - h.tolerance };
    });

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
        if (planes.length) {
          box.getCenter(center);
          box.getSize(half).multiplyScalar(0.5);
          for (const pn of planes) if (center.dot(pn.n) + half.dot(pn.absN) < pn.offset) return false;
        }
        return true;
      },
      intersectsTriangle: (tri: ExtendedTriangle, triIndex: number) => {
        let d: number;
        if (planes.length === 0) {
          tri.closestPointToPoint(pl, tmp);
          d = tmp.distanceTo(pl);
        } else {
          d = closestOnClippedTriangle(tri, planes, pl, tmp);
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

const _polyA: Vector3[] = Array.from({ length: MAX_VERTS }, () => new Vector3());
const _polyB: Vector3[] = Array.from({ length: MAX_VERTS }, () => new Vector3());
const _side = new Float64Array(MAX_VERTS);
const _tri = new Triangle();
const _line = new Line3();
const _tmp = new Vector3();

/**
 * Närmaste punkt på den del av triangeln som ligger innanför alla planen.
 * Returnerar Infinity om ingen del av triangeln gör det.
 */
function closestOnClippedTriangle(tri: Triangle, planes: Plane[], p: Vector3, target: Vector3): number {
  let inside = true;
  for (const pn of planes) {
    const sa = tri.a.dot(pn.n) - pn.offset;
    const sb = tri.b.dot(pn.n) - pn.offset;
    const sc = tri.c.dot(pn.n) - pn.offset;
    if (sa < 0 && sb < 0 && sc < 0) return Infinity;
    if (sa < 0 || sb < 0 || sc < 0) inside = false;
  }
  if (inside) {
    tri.closestPointToPoint(p, target);
    return target.distanceTo(p);
  }

  // Sutherland-Hodgman mot ett plan i taget; varje plan kan ge högst ett hörn till.
  let src = _polyA;
  let dst = _polyB;
  src[0].copy(tri.a);
  src[1].copy(tri.b);
  src[2].copy(tri.c);
  let count = 3;
  for (const pn of planes) {
    for (let i = 0; i < count; i++) _side[i] = src[i].dot(pn.n) - pn.offset;
    let out = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const s0 = _side[i];
      const s1 = _side[j];
      if (s0 >= 0) dst[out++].copy(src[i]);
      if (s0 >= 0 !== s1 >= 0) dst[out++].copy(src[i]).lerp(src[j], s0 / (s0 - s1));
    }
    if (out === 0) return Infinity;
    count = out;
    const swap = src;
    src = dst;
    dst = swap;
  }

  if (count === 1) {
    target.copy(src[0]);
    return target.distanceTo(p);
  }
  let bestSq = Infinity;
  for (let i = 1; i + 1 < count; i++) {
    _tri.set(src[0], src[i], src[i + 1]);
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
    const a = src[i];
    const b = src[(i + 1) % count];
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
