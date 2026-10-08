import { describe, expect, it } from "vitest";
import { computeHole, DEFAULT_OPTIONS } from "../src/geom/burden";
import { burdenBearing, holeBearing, holeMeanInclination, makeFrame, projectToSection, sectionBearing, sectionSegments } from "../src/geom/section";
import { Surface } from "../src/geom/surface";
import type { MeshData } from "../src/io/mesh";
import { checkCollars } from "../src/core/check";
import { renderPlanSvg } from "../src/view/plan";
import { drawProfile, frontLayout, holeInfoText, hoverMarkup, profileLayout, renderFrontSvg, renderProfile, renderProfileSvg, sectionWindowFor } from "../src/view/profile";

const SIN14 = Math.sin((14 * Math.PI) / 180);

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
const floor: [number, number, number][] = [[2, -50, -20], [2, 50, -20], [60, 50, -20], [60, -50, -20]];

describe("snitt", () => {
  const surface = Surface.fromMesh(quads(top, wall, floor));

  it("varnar när påhuggen inte ligger på ytan", () => {
    const st = [{ depth: 0, bearing: 90, inclination: 0 }, { depth: 5, bearing: 90, inclination: 0 }];
    expect(checkCollars(surface, [{ id: "1", collar: [0, 0, 0.2], stations: st }])).toEqual([]);
    const one = checkCollars(surface, [
      { id: "1", collar: [0, 0, 0], stations: st },
      { id: "2", collar: [0, 0, 3], stations: st },
    ]);
    expect(one).toEqual(["Hål 2: påhugget ligger 3,0 m från ytmodellen."]);
    const lost = checkCollars(surface, [
      { id: "1", collar: [0, 0, 50], stations: st },
      { id: "2", collar: [0, 10, 50], stations: st },
    ]);
    expect(lost).toHaveLength(3);
    expect(lost[0]).toContain("2 av 2 påhugg ligger mer än 10 m från ytmodellen");
  });

  it("projektion i snittet", () => {
    const f = makeFrame([0, 0, 0], 90);
    const p = projectToSection(f, [3, 1, -2]);
    expect(p.s).toBeCloseTo(3, 9);
    expect(p.off).toBeCloseTo(-1, 9);
    expect(p.z).toBe(-2);
  });

  it("skärning med lodrätt plan ger överyta, vägg och golv", () => {
    const f = makeFrame([0, 0, 0], 90);
    const segs = sectionSegments(surface, f, { sMin: -5, sMax: 10, zMin: -25, zMax: 2 });
    expect(segs.length).toBeGreaterThan(0);
    let sawTop = false;
    let sawWall = false;
    let sawFloor = false;
    for (let i = 0; i < segs.length; i += 4) {
      const [s0, z0, s1, z1] = [segs[i], segs[i + 1], segs[i + 2], segs[i + 3]];
      if (Math.abs(z0) < 1e-6 && Math.abs(z1) < 1e-6) sawTop = true;
      if (Math.abs(s0 - 2) < 1e-6 && Math.abs(s1 - 2) < 1e-6) sawWall = true;
      if (Math.abs(z0 + 20) < 1e-6 && Math.abs(z1 + 20) < 1e-6) sawFloor = true;
      expect(s0).toBeGreaterThanOrEqual(-5 - 1e-6);
    }
    expect(sawTop && sawWall && sawFloor).toBe(true);
  });

  it("huvudbäring och lutning", () => {
    const r = computeHole(surface, { id: "x", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 10, bearing: 90, inclination: 14 },
    ] }, { interval: 1, mode: "point" });
    expect(sectionBearing(r)).toBeCloseTo(90, 6);
    expect(holeMeanInclination(r)).toBeCloseTo(14, 6);
    const v = computeHole(surface, { id: "v", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 0, inclination: 0 },
      { depth: 10, bearing: 0, inclination: 0 },
    ] }, { interval: 1, mode: "point" });
    // Lodrätt hål: bäringen tas från mätningarnas riktning, dvs mot väggen i öster.
    expect(sectionBearing(v)).toBeCloseTo(90, 6);
  });

  it("profilbild och översikt ger giltig SVG med rätt siffror", () => {
    const r = computeHole(surface, { id: "20", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 6, bearing: 90, inclination: 14 },
    ] }, { interval: 1, mode: "point", minBurden: 1.0, maxBurden: 3.5, startDepth: 1 });
    const opts = { ...DEFAULT_OPTIONS, interval: 1, mode: "point" as const, minBurden: 1.0, maxBurden: 3.5, startDepth: 1 };
    const svg = renderProfileSvg(r, surface, opts);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Hål 20");
    // Försättningen vid 3 m: 2 - 3 sin14 = 1,27
    expect(svg).toContain(">1,27<");
    expect(svg).toContain("Framifrån");
    expect(svg).toContain('class="front-trace"');
    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThan(5);

    // Stickläge: ytspår och stickband finns med, och avläsningspunkterna täcker hela hålet
    const stickOpts = { ...opts, mode: "stick" as const, fineStep: 0.1 };
    const rs = computeHole(surface, { id: "20", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 6, bearing: 90, inclination: 14 },
    ] }, stickOpts);
    const rendered = renderProfile(rs, surface, stickOpts);
    expect(rendered.svg).toContain('class="trace"');
    expect((rendered.svg.match(/class="stick"/g) ?? []).length).toBe(6);
    expect(rendered.svg).toContain('class="hover-layer"');
    expect(rendered.samples).toHaveLength(61);
    expect(rendered.samples[0].depth).toBe(0);
    expect(rendered.samples[60].burden).toBeCloseTo(2 - 6 * SIN14, 4);
    expect(hoverMarkup(rendered.samples[30])).toContain("djup 3,00 m");

    // Kompakt stående format utan vyn framifrån, och fristående vy framifrån, för telefon
    const mobile = renderProfile(rs, surface, stickOpts, { width: 420, height: 700, compact: true, showFront: false });
    expect(mobile.svg).toContain('width="420" height="700"');
    expect(mobile.svg).not.toContain("Framifrån");
    expect(mobile.svg).not.toContain("Hål 20");
    expect(mobile.svg).not.toContain("Påhugg +");

    // Telefonen ritar ur färdiga ytsegment utan modellen och får samma bild
    const win = sectionWindowFor(rs, stickOpts, { compact: true, showFront: false }, 0);
    const phone = drawProfile(rs, Array.from(sectionSegments(surface, win.frame, win)), stickOpts, { width: 420, height: 700, compact: true, showFront: false });
    expect(phone.svg).toBe(mobile.svg);
    expect(phone.samples).toEqual(mobile.samples);
    const wide = drawProfile(rs, Array.from(sectionSegments(surface, win.frame, win)), stickOpts, { width: 900, height: 500, compact: true, showFront: false });
    expect(wide.svg).toContain('width="900" height="500"');
    expect(wide.samples).toHaveLength(61);
    const FL = frontLayout(rs, stickOpts, { width: 420, height: 700, compact: true });
    expect(FL.fw).toBe(420 - 16);
    expect(FL.latMax - FL.latMin).toBeCloseTo(FL.fw / FL.k, 6);
    const front = renderFrontSvg(rs, stickOpts, { compact: true }, FL);
    expect(front).toContain('data-view="front"');
    expect(front).toContain('class="front-trace"');
    expect(front).toContain('class="hover-layer"');

    // Siffror slås ihop när måtten slutar i samma ytpunkt: en vägg som börjar först på 3 m djup
    // gör att punkterna på 1 och 2 m båda mäter mot väggens överkant.
    const shortWall: [number, number, number][] = [[2, -50, -3], [2, 50, -3], [2, 50, -20], [2, -50, -20]];
    const edgeSurface = Surface.fromMesh(quads(top, shortWall, floor));
    const edgeOpts = { ...opts, mode: "point" as const, interval: 1, startDepth: 1 };
    const re = computeHole(edgeSurface, { id: "e", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 0 },
      { depth: 2, bearing: 90, inclination: 0 },
    ] }, edgeOpts);
    expect(re.rows[1].burden).toBeCloseTo(Math.hypot(2, 2), 5);
    expect(re.rows[2].burden).toBeCloseTo(Math.hypot(2, 1), 5);
    const labelRe = /font-weight="700" fill="#[0-9a-f]{6}" text-anchor="end">([^<]+)</g;
    const merged = [...renderProfileSvg(re, edgeSurface, edgeOpts).matchAll(labelRe)].map((m) => m[1]);
    expect(merged).toEqual(["2,24"]);
    const all = [...renderProfileSvg(re, edgeSurface, edgeOpts, { mergeLabelsWithin: 0 }).matchAll(labelRe)].map((m) => m[1]);
    expect(all.sort()).toEqual(["2,24", "2,83"]);
    // En linje per ytpunkt: båda måtten slutar i väggens överkant, så bara det kortaste ritar linje.
    const lineRe = /<line x1="[^"]+" y1="[^"]+" x2="[^"]+" y2="[^"]+" stroke="#[0-9a-f]{6}" stroke-width="2.6" stroke-linecap="round"\/>/g;
    expect([...renderProfileSvg(re, edgeSurface, edgeOpts).matchAll(lineRe)]).toHaveLength(1);
    expect([...renderProfileSvg(re, edgeSurface, edgeOpts, { mergeLabelsWithin: 0 }).matchAll(lineRe)]).toHaveLength(2);

    const plan = renderPlanSvg([r], opts, surface.bounds, null, "20");
    expect(plan).toContain('data-id="20"');
    expect(plan).toContain("10 m");
  });
});

describe("snittets riktning", () => {
  const top: [number, number, number][] = [[-50, -50, 0], [2, -50, 0], [2, 50, 0], [-50, 50, 0]];
  const wall: [number, number, number][] = [[2, -50, 0], [2, 50, 0], [2, 50, -20], [2, -50, -20]];
  const floor: [number, number, number][] = [[2, -50, -20], [2, 50, -20], [60, 50, -20], [60, -50, -20]];
  const s = Surface.fromMesh(quads(top, wall, floor));

  it("följer hålet när försättningen pekar ungefär dit hålet lutar", () => {
    const ne = computeHole(s, { id: "ne", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 60, inclination: 14 },
      { depth: 10, bearing: 60, inclination: 14 },
    ] }, { interval: 1, mode: "point" });
    expect(holeBearing(ne)).toBeCloseTo(60, 6);
    expect(burdenBearing(ne)).toBeCloseTo(90, 3);
    expect(sectionBearing(ne)).toBeCloseTo(60, 6);
    expect(holeInfoText(ne)).toContain("Bäring 60°");
    expect(holeInfoText(ne)).not.toContain("Snitt mot");
    expect(renderProfileSvg(ne, s, { ...DEFAULT_OPTIONS, interval: 1, mode: "point" })).not.toContain('class="section-turned"');
  });

  it("vrids mot försättningen när den pekar mer än 45° åt ett annat håll, och rubriken säger det", () => {
    const north = computeHole(s, { id: "n", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 0, inclination: 14 },
      { depth: 10, bearing: 0, inclination: 14 },
    ] }, { interval: 1, mode: "point" });
    expect(holeBearing(north)).toBeCloseTo(0, 6);
    expect(burdenBearing(north)).toBeCloseTo(90, 3);
    expect(sectionBearing(north)).toBeCloseTo(90, 3);
    expect(holeInfoText(north)).toContain("Bäring 0°");
    expect(holeInfoText(north)).toContain("Snitt mot 90°");
    // I det vridna snittet pekar måtten åt slänthållet, inte längs hålet.
    const svg = renderProfileSvg(north, s, { ...DEFAULT_OPTIONS, interval: 1, mode: "point" });
    expect(svg).toContain("Snitt mot 90°");
    // Rundpilen i bildens hörn visar att snittet är vridet.
    expect(svg).toContain('class="section-turned"');
  });
});

describe("riggens linjer i profilen", () => {
  const top: [number, number, number][] = [[-50, -50, 0], [2, -50, 0], [2, 50, 0], [-50, 50, 0]];
  const wall: [number, number, number][] = [[2, -50, 0], [2, 50, 0], [2, 50, -20], [2, -50, -20]];
  const floor: [number, number, number][] = [[2, -50, -20], [2, 50, -20], [60, 50, -20], [60, -50, -20]];
  const s = Surface.fromMesh(quads(top, wall, floor));

  it("plan och logg ritas bakom hålet i snitt och framifrån, och rubriken anger riggens värden", () => {
    const opts = { ...DEFAULT_OPTIONS, interval: 1, mode: "point" as const };
    const r = computeHole(s, { id: "r", collar: [0, 0, 0], stations: [
      { depth: 0, bearing: 90, inclination: 14 },
      { depth: 10, bearing: 90, inclination: 14 },
    ] }, opts);
    r.reference = {
      plan: { start: [0, 0, 0], end: [2.5, 0, -9.7] },
      quality: { start: [0.1, 0.05, 0.02], end: [2.3, 0.4, -9.6] },
    };
    const svg = renderProfileSvg(r, s, opts);
    expect(svg).toContain('class="rig-plan"');
    expect(svg).toContain('class="rig-quality"');
    expect(svg).toMatch(/Rigg \d+,\d m, \d+°, \d+°/);
    // Bildramen tar med riggens linjer.
    const E = profileLayout(r, opts);
    expect(E.sMax).toBeGreaterThanOrEqual(2.5);
    const front = renderFrontSvg(r, opts, {}, frontLayout(r, opts));
    expect(front).toContain('class="rig-quality"');
    // Utan referens ritas inget.
    delete r.reference;
    expect(renderProfileSvg(r, s, opts)).not.toContain("rig-");
  });
});
