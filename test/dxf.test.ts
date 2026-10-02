import { describe, expect, it } from "vitest";
import { toDxf } from "../src/core/dxf";
import { computeHole } from "../src/geom/burden";
import { Surface } from "../src/geom/surface";
import type { MeshData } from "../src/io/mesh";

function quads(...q: [number, number, number][][]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [a, b, c, d] of q) {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), source: "obj", warnings: [] };
}

const top: [number, number, number][] = [[-50, -50, 0], [2, -50, 0], [2, 50, 0], [-50, 50, 0]];
const wall: [number, number, number][] = [[2, -50, 0], [2, 50, 0], [2, 50, -20], [2, -50, -20]];

/** Enkel DXF-läsare för testet: grupperar kod/värde-par per entitet. */
function parseEntities(dxf: string): { type: string; groups: Record<string, string[]> }[] {
  const lines = dxf.split(/\r?\n/);
  const start = lines.indexOf("ENTITIES");
  const out: { type: string; groups: Record<string, string[]> }[] = [];
  let cur: { type: string; groups: Record<string, string[]> } | null = null;
  for (let i = start + 1; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1].trim();
    if (code === "0") {
      if (value === "ENDSEC") break;
      cur = { type: value, groups: {} };
      out.push(cur);
    } else if (cur) {
      (cur.groups[code] ??= []).push(value);
    }
  }
  return out;
}

describe("dxf", () => {
  const surface = Surface.fromMesh(quads(top, wall));
  const r = computeHole(surface, { id: "7", collar: [500000, 6600000, 100].map((v, i) => (i === 2 ? 0 : v - (i === 0 ? 500000 : 6600000))) as [number, number, number], stations: [
    { depth: 0, bearing: 90, inclination: 0 },
    { depth: 4, bearing: 90, inclination: 0 },
  ] }, { interval: 1, mode: "point", startDepth: 1, minBurden: 1, maxBurden: 3 });

  it("skriver lager, punkter, polylinjer och linjer per hål", () => {
    const dxf = toDxf([r], { includeTrace: false });
    expect(dxf).toContain("H7_YTPUNKTER");
    expect(dxf).toContain("H7_MATT");
    expect(dxf).toContain("H7_HAL");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    const ents = parseEntities(dxf);
    // Mätta punkter: djup 1, 2, 3, 4 (0 är påhugg, inget hoppas över under startdjup 1)
    expect(ents.filter((e) => e.type === "POINT")).toHaveLength(4);
    expect(ents.filter((e) => e.type === "LINE")).toHaveLength(4);
    expect(ents.filter((e) => e.type === "POLYLINE")).toHaveLength(2);
    const vertices = ents.filter((e) => e.type === "VERTEX");
    expect(vertices).toHaveLength(4 + 2);
    // Ytpunkterna ligger på väggen x = 2 och linjerna börjar i hålet x = 0
    const surfaceVerts = vertices.filter((v) => v.groups["8"][0] === "H7_YTPUNKTER");
    for (const v of surfaceVerts) expect(Number(v.groups["10"][0])).toBeCloseTo(2, 3);
    const lines = ents.filter((e) => e.type === "LINE");
    for (const l of lines) {
      expect(Number(l.groups["10"][0])).toBeCloseTo(0, 3);
      expect(Number(l.groups["11"][0])).toBeCloseTo(2, 3);
      expect(l.groups["62"][0]).toBe("3");
    }
  });

  it("ytspåret blir en polylinje genom de täta punkternas ytpunkter", () => {
    const dxf = toDxf([r], { includeBurdenLines: false, includeHolePath: false, includePoints: false, startDepth: 1 });
    const ents = parseEntities(dxf);
    const polys = ents.filter((e) => e.type === "POLYLINE");
    expect(polys.map((p) => p.groups["8"][0])).toEqual(["H7_YTPUNKTER", "H7_SPAR"]);
    const traceVerts = ents.filter((e) => e.type === "VERTEX" && e.groups["8"][0] === "H7_SPAR");
    // Täta punkter från 1,0 till 4,0 m med 0,05 m steg
    expect(traceVerts).toHaveLength(61);
  });

  it("kan begränsas till valda hål och utesluta delar", () => {
    const dxf = toDxf([r], { holeIds: ["99"] });
    expect(parseEntities(dxf)).toHaveLength(0);
    const only = toDxf([r], { includeBurdenLines: false, includeHolePath: false, includePoints: false, includeTrace: false });
    const ents = parseEntities(only);
    expect(ents.filter((e) => e.type === "POLYLINE")).toHaveLength(1);
    expect(ents.filter((e) => e.type === "LINE")).toHaveLength(0);
  });
});
