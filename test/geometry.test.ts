import { describe, expect, it } from "vitest";
import { computeHole } from "../src/geom/burden";
import { buildHolePath, directionFromBearingInclination, pointAt, sampleDepths } from "../src/geom/hole";
import { Surface } from "../src/geom/surface";
import type { MeshData } from "../src/io/mesh";

const SIN14 = Math.sin((14 * Math.PI) / 180);
const COS14 = Math.cos((14 * Math.PI) / 180);

/** Bygger en mesh av rektanglar, var och en given som fyra hörn i E N Z. */
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

/** Horisontell överyta z=0 för x<=0 (bakom hålet) samt lodrät slänt x=2 ned till z=-20. */
const topBehind: [number, number, number][] = [[-50, -50, 0], [2, -50, 0], [2, 50, 0], [-50, 50, 0]];
const wall: [number, number, number][] = [[2, -50, 0], [2, 50, 0], [2, 50, -20], [2, -50, -20]];
const floor: [number, number, number][] = [[2, -50, -20], [2, 50, -20], [60, 50, -20], [60, -50, -20]];

describe("hålbana", () => {
  it("riktningsvektor från bäring och lutning", () => {
    const d = directionFromBearingInclination(90, 14);
    expect(d[0]).toBeCloseTo(SIN14, 9);
    expect(d[1]).toBeCloseTo(0, 9);
    expect(d[2]).toBeCloseTo(-COS14, 9);
    const n = directionFromBearingInclination(0, 0);
    expect(n).toEqual([0, 0, -1]);
  });

  it("rakt hål med två lika stationer", () => {
    const p = buildHolePath({ id: "a", collar: [100, 200, 50], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 10, bearing: 90, inclination: 14 },
    ] });
    const end = p.points[1];
    expect(end[0]).toBeCloseTo(100 + 10 * SIN14, 9);
    expect(end[1]).toBeCloseTo(200, 9);
    expect(end[2]).toBeCloseTo(50 - 10 * COS14, 9);
    expect(p.length).toBe(10);
  });

  it("medelvinkel mot tangent", () => {
    const stations = [
      { depth: 0, bearing: 90, inclination: 10 },
      { depth: 10, bearing: 90, inclination: 20 },
    ];
    const avg = buildHolePath({ id: "a", collar: [0, 0, 0], stations }, { method: "average" });
    const tan = buildHolePath({ id: "a", collar: [0, 0, 0], stations }, { method: "tangent" });
    expect(tan.points[1][0]).toBeCloseTo(10 * Math.sin((10 * Math.PI) / 180), 9);
    // Medelvinkel ger riktningen 15 grader från lod.
    expect(avg.points[1][0]).toBeCloseTo(10 * Math.sin((15 * Math.PI) / 180), 9);
  });

  it("medelvärde av bäring 359 och 1 blir 0, inte 180", () => {
    const p = buildHolePath({ id: "a", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 359, inclination: 20 },
      { depth: 10, bearing: 1, inclination: 20 },
    ] });
    expect(p.points[1][0]).toBeCloseTo(0, 6);
    expect(p.points[1][1]).toBeGreaterThan(3);
  });

  it("bäringskorrektion vrider hålet", () => {
    const p = buildHolePath({ id: "a", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 0, inclination: 30 },
      { depth: 10, bearing: 0, inclination: 30 },
    ] }, { bearingCorrection: 90 });
    expect(p.points[1][0]).toBeCloseTo(5, 9);
    expect(p.points[1][1]).toBeCloseTo(0, 9);
  });

  it("första station över 0 m ger rak start, pointAt interpolerar", () => {
    const p = buildHolePath({ id: "a", collar: [0, 0, 0], stations: [
      { depth: 2, bearing: 90, inclination: 0 },
      { depth: 6, bearing: 90, inclination: 0 },
    ] });
    expect(p.depths).toEqual([0, 2, 6]);
    const { point } = pointAt(p, 3);
    expect(point[2]).toBeCloseTo(-3, 9);
    const s = sampleDepths(p, 2.5);
    expect(s.map((x) => x.depth)).toEqual([0, 2, 2.5, 5, 6]);
    expect(s.find((x) => x.depth === 6)!.isBottom).toBe(true);
    expect(s.find((x) => x.depth === 2)!.isStation).toBe(true);
  });
});

describe("yta och närmaste punkt", () => {
  const surface = Surface.fromMesh(quads(topBehind, wall, floor));

  it("fritt avstånd från punkt under överytan", () => {
    const hit = surface.closestPoint([-1, 0, -0.5])!;
    expect(hit.distance).toBeCloseTo(0.5, 6);
    expect(hit.point[2]).toBeCloseTo(0, 6);
  });

  it("halvrum utesluter överytan bakom planet", () => {
    // Lodrätt hål vid x=0, punkt 0,5 m ned: överytan ligger på påhuggssidan, kvar är slänten på 2 m.
    const hit = surface.closestPoint([0, 0, -0.5], { normal: [0, 0, -1], tolerance: 0.05 })!;
    expect(hit.distance).toBeCloseTo(2.0, 6);
    expect(hit.point[0]).toBeCloseTo(2, 6);
  });

  it("returnerar null när inget ligger i halvrummet", () => {
    const only = Surface.fromMesh(quads(topBehind));
    expect(only.closestPoint([0, 0, -1], { normal: [0, 0, -1], tolerance: 0.05 })).toBeNull();
  });

  it("klippt triangel: närmaste punkt hamnar på plansnittet", () => {
    // Enbart en bred överyta, punkt under den, normal lutar så att en del av ytan ligger i halvrummet.
    const topWide: [number, number, number][] = [[-50, -50, 0], [50, -50, 0], [50, 50, 0], [-50, 50, 0]];
    const only = Surface.fromMesh(quads(topWide));
    const n: [number, number, number] = [SIN14, 0, -COS14];
    const p: [number, number, number] = [0, 0, -0.5];
    const hit = only.closestPoint(p, { normal: n, tolerance: 0 })!;
    // Planet genom p med normal n skär z=0 vid x = 0,5 cos14 / sin14 + 0.
    const xCut = (0.5 * COS14) / SIN14;
    expect(hit.point[0]).toBeCloseTo(xCut, 4);
    expect(hit.point[2]).toBeCloseTo(0, 6);
    expect(hit.distance).toBeCloseTo(Math.hypot(xCut, 0.5), 4);
  });
});

describe("försättning", () => {
  const surface = Surface.fromMesh(quads(topBehind, wall, floor));

  it("lodrätt hål: försättning 2,0 m hela vägen, fritt 3D-min går mot överytan överst", () => {
    const r = computeHole(surface, { id: "v", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 10, bearing: 90, inclination: 0 },
    ] }, { interval: 1, mode: "point", minBurden: 1.5, maxBurden: 3.5 });
    expect(r.rows).toHaveLength(11);
    expect(r.rows[0].cls).toBe("collar");
    for (const row of r.rows.slice(1)) {
      expect(row.burden).toBeCloseTo(2.0, 6);
      expect(row.cls).toBe("ok");
      expect(row.bearingTo).toBeCloseTo(90, 6);
      expect(row.elevationTo).toBeCloseTo(0, 6);
    }
    expect(r.rows[1].free3d).toBeCloseTo(1.0, 6);
    expect(r.rows[5].free3d).toBeCloseTo(2.0, 6);
    expect(r.minBurden).toBeCloseTo(2.0, 6);
  });

  it("lutande hål mot slänten: försättning minskar med djupet och blir röd", () => {
    const r = computeHole(surface, { id: "l", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 6, bearing: 90, inclination: 14 },
    ] }, { interval: 1, mode: "point", minBurden: 1.0, maxBurden: 3.5 });
    for (const row of r.rows.slice(1)) {
      expect(row.burden).toBeCloseTo(2 - row.depth * SIN14, 5);
    }
    expect(r.rows[6].cls).toBe("low");
    expect(r.rows[1].cls).toBe("ok");
  });

  it("punkter ovanför startdjupet klassas för sig och räknas inte in i minimum", () => {
    const r = computeHole(surface, { id: "f", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 6, bearing: 90, inclination: 14 },
    ] }, { interval: 1, mode: "point", minBurden: 1.9, maxBurden: 3.5, startDepth: 2 });
    expect(r.rows[1].cls).toBe("skipped");
    expect(r.rows[2].cls).toBe("low");
    expect(r.minBurdenDepth).toBe(6);
    expect(r.minBurden).toBeCloseTo(2 - 6 * SIN14, 5);
  });

  it("stickläge: sämsta värdet i varje sticka, med stickans utbredning", () => {
    // Lutande hål mot väggen: måttet minskar med djupet, så stickans minimum ligger i dess djupaste ände.
    const r = computeHole(surface, { id: "s", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 6, bearing: 90, inclination: 14 },
    ] }, { interval: 1, mode: "stick", fineStep: 0.05, startDepth: 1, minBurden: 1.0, maxBurden: 3.5 });
    expect(r.rows[0].cls).toBe("collar");
    const sticks = r.rows.slice(1);
    expect(sticks.map((s) => [s.stickStart, s.stickEnd])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]);
    expect(sticks[0].cls).toBe("skipped");
    for (const s of sticks.slice(1)) {
      expect(s.depth).toBeCloseTo(s.stickEnd, 6);
      expect(s.burden).toBeCloseTo(2 - s.stickEnd * SIN14, 5);
    }
    expect(sticks[sticks.length - 1].isBottom).toBe(true);
    expect(r.minBurdenDepth).toBeCloseTo(6, 6);
    expect(r.fine.length).toBe(121);
    expect(r.fine[0].depth).toBe(0);
    expect(r.fine[120].depth).toBeCloseTo(6, 9);
  });

  it("stickläge: startdjup som inte är en multipel av stickan ger gräns vid startdjupet", () => {
    const r = computeHole(surface, { id: "s2", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 4.2, bearing: 90, inclination: 0 },
    ] }, { interval: 1, mode: "stick", startDepth: 1.5 });
    const sticks = r.rows.slice(1);
    expect(sticks.map((s) => [s.stickStart, s.stickEnd])).toEqual([[0, 0.5], [0.5, 1.5], [1.5, 2.5], [2.5, 3.5], [3.5, 4.2]]);
    expect(sticks[1].cls).toBe("skipped");
    expect(sticks[2].cls).not.toBe("skipped");
    // Under startdjupet gäller väggen rakt fram. Ovanför ligger provpunkterna över startplanet och mäter snett ned till väggen under det.
    for (const s of sticks) {
      if (s.cls === "skipped") expect(s.burden!).toBeGreaterThanOrEqual(2 - 1e-9);
      else expect(s.burden).toBeCloseTo(2, 6);
    }
  });

  it("stort värde blir blått", () => {
    const r = computeHole(surface, { id: "h", collar: [-3, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 4, bearing: 90, inclination: 0 },
    ] }, { interval: 2, mode: "point", minBurden: 1.0, maxBurden: 3.5 });
    expect(r.rows[1].burden).toBeCloseTo(5, 6);
    expect(r.rows[1].cls).toBe("high");
  });
});

describe("fri 3D under gränsen", () => {
  it("två halvrum samtidigt klipper triangeln mot båda planen", () => {
    const s = Surface.fromMesh(quads(wall));
    const hit = s.closestPoint([0, 0, -5], [
      { normal: [0, 0, -1], tolerance: -2 }, // q.z <= -7
      { normal: [0, 1, 0], tolerance: -1 }, // q.y >= 1
    ]);
    expect(hit).not.toBeNull();
    expect(hit!.point[0]).toBeCloseTo(2, 6);
    expect(hit!.point[1]).toBeCloseTo(1, 6);
    expect(hit!.point[2]).toBeCloseTo(-7, 6);
    expect(hit!.distance).toBeCloseTo(3, 6);
  });

  it("hål som borrats förbi slänfoten mäter till foten i stället för att springa ut längs marken", () => {
    const surface = Surface.fromMesh(quads(topBehind, wall, floor));
    const hole = { id: "fot", collar: [0, 0, 0] as [number, number, number], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 24, bearing: 90, inclination: 0 },
    ] };
    const r = computeHole(surface, hole, { interval: 1, mode: "point", minBurden: 1.0, maxBurden: 3.5 });
    const at = (d: number) => r.rows.find((x) => Math.abs(x.depth - d) < 1e-6)!;
    expect(at(19).burden).toBeCloseTo(2, 6);
    // 2 m under foten: närmaste yta är fotens kant (2, 0, -20), snett uppåt.
    expect(at(22).burden).toBeCloseTo(Math.sqrt(8), 6);
    expect(at(22).elevationTo).toBeGreaterThan(0);
    expect(at(24).burden).toBeCloseTo(Math.sqrt(20), 6);
    // Med gränsen bortom hålets längd gäller planregeln hela vägen och hittar ingenting under foten.
    const old = computeHole(surface, hole, { interval: 1, mode: "point", free3dFromDepth: 100 });
    expect(old.rows.find((x) => x.depth === 22)!.burden).toBeNull();
  });

  it("hålrum i slänten hittas även från provpunkter under det", () => {
    // Slänten x=2 med ett hålrum 9,5-10,5 m under krönet som går 1,5 m in i berget (till x=0,5).
    const upper: [number, number, number][] = [[2, -50, 0], [2, 50, 0], [2, 50, -9.5], [2, -50, -9.5]];
    const roof: [number, number, number][] = [[2, -50, -9.5], [2, 50, -9.5], [0.5, 50, -9.5], [0.5, -50, -9.5]];
    const back: [number, number, number][] = [[0.5, -50, -9.5], [0.5, 50, -9.5], [0.5, 50, -10.5], [0.5, -50, -10.5]];
    const sole: [number, number, number][] = [[0.5, -50, -10.5], [0.5, 50, -10.5], [2, 50, -10.5], [2, -50, -10.5]];
    const lower: [number, number, number][] = [[2, -50, -10.5], [2, 50, -10.5], [2, 50, -20], [2, -50, -20]];
    const surface = Surface.fromMesh(quads(topBehind, upper, roof, back, sole, lower, floor));
    const r = computeHole(surface, { id: "rum", collar: [-1, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 15, bearing: 90, inclination: 0 },
    ] }, { interval: 0.5, mode: "point", minBurden: 1.0, maxBurden: 3.5 });
    const at = (d: number) => r.rows.find((x) => Math.abs(x.depth - d) < 1e-6)!;
    expect(at(10).burden).toBeCloseTo(1.5, 6);
    expect(at(8.5).burden).toBeCloseTo(Math.hypot(1.5, 1), 6);
    expect(at(11.5).burden).toBeCloseTo(Math.hypot(1.5, 1), 6);
    expect(at(14).burden).toBeCloseTo(3, 6);
  });

  it("krönspärren hindrar att överytan blir försättning när försättningen är större än djupet", () => {
    const surface = Surface.fromMesh(quads(topBehind, wall, floor));
    const r = computeHole(surface, { id: "krön", collar: [-3, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 8, bearing: 90, inclination: 0 },
    ] }, { interval: 1, mode: "point", minBurden: 1.0, maxBurden: 3.5 });
    for (const row of r.rows.slice(1)) {
      expect(row.burden).toBeCloseTo(5, 6);
      expect(row.cls).toBe("high");
    }
    expect(r.rows.find((x) => x.depth === 4)!.free3d).toBeCloseTo(4, 6);
  });
});

describe("startplanet", () => {
  // Slänten x=2, men de översta 0,8 m står en klack ut till x=1: krönkanten nära hålets topp.
  const ledgeTop: [number, number, number][] = [[1, -50, 0], [1, 50, 0], [1, 50, -0.8], [1, -50, -0.8]];
  const ledgeSole: [number, number, number][] = [[1, -50, -0.8], [1, 50, -0.8], [2, 50, -0.8], [2, -50, -0.8]];
  const wallBelow: [number, number, number][] = [[2, -50, -0.8], [2, 50, -0.8], [2, 50, -20], [2, -50, -20]];
  const topToLedge: [number, number, number][] = [[-50, -50, 0], [1, -50, 0], [1, 50, 0], [-50, 50, 0]];
  const surface = Surface.fromMesh(quads(topToLedge, ledgeTop, ledgeSole, wallBelow, floor));
  const hole = { id: "klack", collar: [0, 0, 0] as [number, number, number], stations: [
    { depth: 0, bearing: 90, inclination: 0 },
    { depth: 6, bearing: 90, inclination: 0 },
  ] };

  it("yta ovanför planet på startdjupet räknas inte, så klacken försvinner och slänten under gäller", () => {
    const r = computeHole(surface, hole, { interval: 1, mode: "point", startDepth: 1, minBurden: 1.0, maxBurden: 3.5 });
    const at = (d: number) => r.rows.find((x) => Math.abs(x.depth - d) < 1e-6)!;
    // Utan startplanet vore klackens underkant (1, 0, -0.8) närmast från 2 m: 1,56 m.
    expect(at(2).free3d).toBeCloseTo(Math.hypot(1, 1.2), 6);
    expect(at(2).burden).toBeCloseTo(2, 6);
    expect(at(1).burden).toBeCloseTo(2, 6);
    expect(at(5).burden).toBeCloseTo(2, 6);
  });

  it("med startdjupet ovanför klacken räknas den", () => {
    const r = computeHole(surface, hole, { interval: 1, mode: "point", startDepth: 0.3, crestMargin: 0.2, minBurden: 1.0, maxBurden: 3.5 });
    const at = (d: number) => r.rows.find((x) => Math.abs(x.depth - d) < 1e-6)!;
    expect(at(2).burden).toBeCloseTo(Math.hypot(1, 1.2), 6);
  });

  it("planet lutar med hålet: för ett hål mot slänten stiger det mot slänten", () => {
    // Hål 14° mot slänten: planet på 1 m stiger med tan 14° per meter mot slänten, så klackens
    // underkant på z = -0,8 hamnar under planet ungefär 0,9 m ut och räknas igen.
    const r = computeHole(surface, { id: "lut", collar: [-1, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 6, bearing: 90, inclination: 14 },
    ] }, { interval: 1, mode: "point", startDepth: 1, minBurden: 1.0, maxBurden: 3.5 });
    const at = (d: number) => r.rows.find((x) => Math.abs(x.depth - d) < 1e-6)!;
    const row = at(2);
    expect(row.closest![0]).toBeCloseTo(1, 6);
    expect(row.closest![2]).toBeCloseTo(-0.8, 6);
    expect(row.burden!).toBeLessThan(at(2).free3d! + 1e-9);
  });
});
