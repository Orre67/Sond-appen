import { describe, expect, it } from "vitest";
import { computeHole, DEFAULT_OPTIONS, type HoleResult } from "../src/geom/burden";
import { buildHolePath } from "../src/geom/hole";
import { closestOnPath, pairRows } from "../src/geom/rows";
import { Surface } from "../src/geom/surface";
import type { MeshData } from "../src/io/mesh";
import { drawProfile, holeInfoText, profileExtents } from "../src/view/profile";

/** Hålresultat utan yta: bara banan, för parning. */
function hole(id: string, e: number, n: number, inclination: number, length = 12, bearing = 90): HoleResult {
  const path = buildHolePath(
    { id, collar: [e, n, 0], stations: [{ depth: 0, bearing, inclination }, { depth: length, bearing, inclination }] },
    { method: "average", bearingCorrection: 0 },
  );
  return { id, path, rows: [], fine: [], minBurden: null, minBurdenDepth: null };
}

/** Pall med krönet vid x = faceX: plan ovanpå, lodrät stuff ned till -20, plan botten. */
function bench(faceX: number): Surface {
  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (q: [number, number, number][]) => {
    const base = positions.length / 3;
    for (const p of q) positions.push(...p);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([[-50, -50, 0], [faceX, -50, 0], [faceX, 50, 0], [-50, 50, 0]]);
  quad([[faceX, -50, 0], [faceX, 50, 0], [faceX, 50, -20], [faceX, -50, -20]]);
  quad([[faceX, -50, -20], [faceX, 50, -20], [60, 50, -20], [60, -50, -20]]);
  const mesh: MeshData = { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), source: "obj", warnings: [] };
  return Surface.fromMesh(mesh);
}

const stickOpts = { ...DEFAULT_OPTIONS, interval: 1, mode: "stick" as const, fineStep: 0.1, startDepth: 1, minBurden: 1.5, maxBurden: 3.5 };
const vertical = (len: number) => [{ depth: 0, bearing: 90, inclination: 0 }, { depth: len, bearing: 90, inclination: 0 }];

describe("raden framför", () => {
  it("närmaste punkt på en bana, och om den är banans slut", () => {
    const h = hole("a", 0, 0, 0, 10);
    const c = closestOnPath(h.path, [3, 0, -4]);
    expect(c.point[2]).toBeCloseTo(-4, 6);
    expect(c.distance).toBeCloseTo(3, 6);
    expect(c.atBottom).toBe(false);
    // Utanför banans ändar klamras till närmaste ändpunkt; nedanför botten markeras det
    expect(closestOnPath(h.path, [0, 0, 5]).distance).toBeCloseTo(5, 6);
    expect(closestOnPath(h.path, [0, 0, 5]).atBottom).toBe(false);
    expect(closestOnPath(h.path, [0, 0, -15]).distance).toBeCloseTo(5, 6);
    expect(closestOnPath(h.path, [0, 0, -15]).atBottom).toBe(true);
    // Strax under slutet, inom en meter, räknas slutpunkten fortfarande
    expect(closestOnPath(h.path, [0, 0, -10.8]).atBottom).toBe(false);
    expect(closestOnPath(h.path, [0, 0, -11.2]).atBottom).toBe(true);
  });

  it("varje hål får hålet rakt framför sig, första raden inget", () => {
    // Stuffen österut. Rad 1 vid E=0, rad 2 tre meter bakom, rad 3 sex meter bakom.
    const a = hole("1", 0, 0, 14);
    const b = hole("2", -3, 0, 14);
    const c = hole("3", -6, 0, 14);
    pairRows([a, b, c], 90, DEFAULT_OPTIONS);
    expect(a.front).toBeUndefined();
    expect(b.front?.id).toBe("1");
    expect(c.front?.id).toBe("2");
  });

  it("hål åt sidan eller bakom räknas inte som raden framför, och för långt bort inte heller", () => {
    const a = hole("1", 0, 0, 14);
    const behind = hole("b", -3, 0, 14);
    const side = hole("s", 2, 4, 14); // 63° åt sidan från rakt framåt
    const far = hole("x", 20, 0, 14);
    pairRows([a, behind, side, far], 90, DEFAULT_OPTIONS);
    expect(a.front).toBeUndefined();
    expect(behind.front?.id).toBe("1");
  });

  it("utan skjutriktning används hålets egen riktning mot stuffen", () => {
    const a = hole("1", 0, 0, 14); // lutar österut
    const b = hole("2", -3, 0, 14);
    pairRows([a, b], null, DEFAULT_OPTIONS);
    expect(b.front?.id).toBe("1");
    expect(a.front).toBeUndefined();
  });

  it("stickorna mäter mot hålet framför när det är kortare än till ytan, och minsta försättning räknas om", () => {
    // Stuffen vid x=5: rad 1 vid x=0 har 5 m till stuffen, rad 2 vid x=-3 har 8 m till stuffen men 3 m till rad 1
    const surface = bench(5);
    const front = computeHole(surface, { id: "1", collar: [0, 0, 0], stations: vertical(10) }, stickOpts);
    const back = computeHole(surface, { id: "101", collar: [-3, 0, 0], stations: vertical(10) }, stickOpts);
    const surfaceMin = back.minBurden;
    expect(surfaceMin).toBeGreaterThan(7);
    pairRows([front, back], 90, stickOpts);
    expect(back.front?.id).toBe("1");
    expect(front.front).toBeUndefined();
    const measured = back.rows.filter((row) => row.cls !== "collar" && row.cls !== "skipped");
    expect(measured.length).toBeGreaterThan(5);
    for (const row of measured) {
      expect(row.toHole).toBe(true);
      expect(row.burden).toBeCloseTo(3, 2);
      expect(row.cls).toBe("ok");
      expect(row.surfaceBurden).toBeGreaterThan(7);
    }
    expect(back.minBurden).toBeCloseTo(3, 2);
    // Rad 1 mäter mot stuffen som förut
    for (const row of front.rows) expect(row.toHole).toBeUndefined();
    expect(front.minBurden).toBeCloseTo(5, 1);
    expect(holeInfoText(back)).toContain("Hål 1 framför");
    expect(holeInfoText(front)).not.toContain("framför");
    // Bilden ritar hålet framför grått med nummer, och fönstret rymmer det
    const alone = profileExtents(front, stickOpts);
    const E = profileExtents(back, stickOpts);
    expect(E.sMax).toBeGreaterThan(alone.sMin + 2.5);
    const svg = drawProfile(back, [], stickOpts, { showFront: false }).svg;
    expect(svg).toContain('class="front"');
    expect(svg).toContain('class="front-id"');
    expect(svg).toContain('class="own-id"');
    expect(svg).toContain('>101<');
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain(">1<");
    expect(drawProfile(front, [], stickOpts, { showFront: false }).svg).not.toContain('class="front"');
    // Ny parning utan hål framför återställer ytans värden
    pairRows([back], 90, stickOpts);
    expect(back.front).toBeUndefined();
    for (const row of back.rows) expect(row.toHole).toBeUndefined();
    expect(back.minBurden).toBeCloseTo(surfaceMin!, 6);
  });

  it("under hålet framförs sonderade slut mäter stickorna mot stuffen igen, inte mot slutpunkten", () => {
    const surface = bench(5);
    const front = computeHole(surface, { id: "16", collar: [0, 0, 0], stations: vertical(5) }, stickOpts);
    const back = computeHole(surface, { id: "53", collar: [-3, 0, 0], stations: vertical(12) }, stickOpts);
    pairRows([front, back], 90, stickOpts);
    expect(back.front?.id).toBe("16");
    const above = back.rows.filter((row) => row.cls !== "collar" && row.cls !== "skipped" && row.stickEnd <= 5 + 1e-9);
    const below = back.rows.filter((row) => row.cls !== "collar" && row.cls !== "skipped" && row.stickStart > 6 + 1e-6);
    // Inom en meter under hålet framförs slut mäts ändå mot dess slutpunkt, därunder mot stuffen
    expect(above.length).toBeGreaterThan(2);
    expect(below.length).toBeGreaterThan(4);
    for (const row of above) {
      expect(row.toHole).toBe(true);
      expect(row.burden).toBeCloseTo(3, 2);
    }
    for (const row of below) {
      expect(row.toHole).toBeUndefined();
      expect(row.burden).toBeCloseTo(8, 1);
    }
  });
});
