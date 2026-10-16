import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, type HoleResult } from "../src/geom/burden";
import type { Bounds } from "../src/io/mesh";
import { blastBearingFromLine, holesViewBox, nearestNeighbourMedian, planFrame, renderPlanSvg, rotatedExtent } from "../src/view/plan";

const bounds: Bounds = { min: [100, 200, 0], max: [140, 220, 10] };

describe("översikt", () => {
  it("norr uppåt utan skjutriktning", () => {
    const F = planFrame(bounds, null, 0);
    expect(F.w).toBeCloseTo(40);
    expect(F.h).toBeCloseTo(20);
    const nw = F.toScreen(100, 220);
    expect(nw[0]).toBeCloseTo(0);
    expect(nw[1]).toBeCloseTo(0);
    const [e, n] = F.toWorld(40, 20);
    expect(e).toBeCloseTo(140);
    expect(n).toBeCloseTo(200);
  });

  it("vrider kartan så att skjutriktningen pekar uppåt", () => {
    const F = planFrame(bounds, 90, 0);
    expect(F.w).toBeCloseTo(20);
    expect(F.h).toBeCloseTo(40);
    const east = F.toScreen(140, 210);
    const west = F.toScreen(100, 210);
    expect(east[1]).toBeLessThan(west[1]);
    expect(east[0]).toBeCloseTo(west[0]);
    const [x, y] = F.toScreen(123.4, 205.6);
    const [e, n] = F.toWorld(x, y);
    expect(e).toBeCloseTo(123.4);
    expect(n).toBeCloseTo(205.6);
  });

  it("ramen följer modellens punkter i den vridna vyn", () => {
    // Punkter längs en linje i riktning 45°: med skjutriktning 45° uppåt blir ramen en smal remsa
    const pos: number[] = [];
    for (let t = 0; t <= 40; t += 2) pos.push(100 + t, 200 + t, 5);
    const ext = rotatedExtent(pos, bounds, 45);
    const F = planFrame(bounds, 45, 0, ext);
    expect(F.w).toBeCloseTo(0, 5);
    expect(F.h).toBeCloseTo(40 * Math.SQRT2, 5);
    // Utan punkter används rektangelns hörn
    const empty = rotatedExtent([], bounds, 45);
    expect(planFrame(bounds, 45, 0, empty).w).toBeCloseTo(60 / Math.SQRT2, 5);
  });

  it("skjutriktning ur en linje dragen från höger till vänster", () => {
    expect(blastBearingFromLine(10, 0, 0, 0)).toBe(0);
    expect(blastBearingFromLine(0, 0, 0, 10)).toBe(90);
    expect(blastBearingFromLine(0, 10, 0, 0)).toBe(270);
    expect(blastBearingFromLine(0, 0, -7, 7)).toBe(45);
  });

  it("ritar startpunkter utan hål, utan originalnamn och utan pilar eller skalstock", () => {
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, {
      bearing: 45,
      points: [
        { id: null, sourceId: "101", e: 120, n: 210 },
        { id: "7", sourceId: "107", e: 121, n: 211 },
      ],
      numbering: true,
    });
    expect(svg).toContain('class="plan-point" data-source="101"');
    expect(svg).not.toContain("(101)");
    expect(svg).not.toContain("(107)");
    expect(svg).not.toContain("Skjutriktning");
    expect(svg).not.toContain("10 m");
    expect(svg).not.toContain("stroke-dasharray=\"3.00 2.00\"");
    expect(svg).toContain('data-bearing="45"');
    expect(svg).toContain('id="plan-overlay"');
    expect(svg).toContain('class="collar"');
    // Skrivbordet ritar i meter, telefonen i skärmpixlar gånger meter per pixel
    expect(svg).toContain('font-size="0.65"');
    const phone = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: [{ id: "7", sourceId: "7", e: 120, n: 210 }], pixelScale: 0.2 });
    // Numret inuti ringen: 11 × 0,95 bildpunkter
    expect(phone).toContain('font-size="2.09"');
    // Ett ensamt hål har gott om plats: ring med numret inuti, radie 11 bildpunkter
    expect(phone).toContain('r="2.20"');
    expect(phone).toContain('class="ring-id"');
    // Hålspåret ritas svagt grått i ett lager under markörerna, sett uppifrån
    const hole = { id: "5", path: { collar: [120, 210, 10], points: [[120, 210, 10], [121, 212, 0]] } } as unknown as HoleResult;
    const withHole = renderPlanSvg([hole], DEFAULT_OPTIONS, bounds, null, null, {});
    expect(withHole).toContain(`<polyline class="trace"`);
    expect(withHole).toContain(`stroke="#ffffff"`);
    expect(withHole.indexOf(`<g class="traces">`)).toBeLessThan(withHole.indexOf(`class="plan-hole"`));
    // Tätt på telefonen: inget spår
    const dense = renderPlanSvg([hole], DEFAULT_OPTIONS, bounds, null, null, { points: [{ id: "6", sourceId: "6", e: 121, n: 210 }, { id: "7", sourceId: "7", e: 122, n: 210 }], pixelScale: 0.2 });
    expect(dense).not.toContain(`<polyline class="trace"`);
  });
});

describe("täthet på telefonen", () => {
  const row = (ids: string[], spacing: number) => ids.map((id, i) => ({ id, sourceId: id, e: 110 + i * spacing, n: 210 }));
  const rig = { plan: [{ id: "1", e0: 110, n0: 210, e1: 112, n1: 215 }], quality: [] };
  it("tätt: bara prickar, inga siffror och inga rigglinjer", () => {
    // 2 m mellan hålen, 0,2 m per bildpunkt: 10 bildpunkter
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: row(["1", "2", "3"], 2), pixelScale: 0.2, rigLines: rig });
    expect(svg).toContain('r="0.50"');
    expect(svg).not.toMatch(/<text[^>]*>[123]</);
    // 3 m: 15 bildpunkter är fortfarande prickar
    expect(renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: row(["1", "2", "3"], 3), pixelScale: 0.2 })).toContain('r="0.50"');
    expect(svg).not.toContain("plan-rig-line");
  });
  it("lagom: små ringar med numret inuti, utan rigglinjer", () => {
    // 5 m mellan hålen: 25 bildpunkter. Ringen får radien 25 × 0,42 = 10,5 bildpunkter.
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: row(["1", "2", "3"], 5), pixelScale: 0.2, rigLines: rig });
    expect((svg.match(/class="ring-id"/g) ?? []).length).toBe(3);
    expect(svg).toContain('r="2.10"');
    expect(svg).not.toContain("plan-rig-line");
    // 4 m: 20 bildpunkter ger radien 8,4
    const tight = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: row(["1", "2", "3"], 4), pixelScale: 0.2 });
    expect(tight).toContain('r="1.68"');
    expect((tight.match(/class="ring-id"/g) ?? []).length).toBe(3);
  });
  it("glest: ringar med numret inuti och rigglinjer", () => {
    // 10 m mellan hålen: 50 bildpunkter
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: row(["1", "2", "3"], 10), pixelScale: 0.2, rigLines: rig });
    expect((svg.match(/class="ring-id"/g) ?? []).length).toBe(3);
    expect(svg).toContain('r="2.20"');
    expect(svg).toContain("plan-rig-line");
  });
  it("skrivbordet påverkas inte av tätheten", () => {
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, { points: row(["1", "2", "3"], 1) });
    expect((svg.match(/font-size="0.65"/g) ?? []).length).toBe(3);
    expect(svg).toContain('r="0.32"');
  });
  it("medianen av närmaste grannavstånd och startvyn på hålen", () => {
    expect(nearestNeighbourMedian([])).toBe(Infinity);
    expect(nearestNeighbourMedian([{ e: 0, n: 0 }])).toBe(Infinity);
    expect(nearestNeighbourMedian([{ e: 0, n: 0 }, { e: 2, n: 0 }, { e: 12, n: 0 }])).toBe(2);
    const F = planFrame(bounds, null, 0);
    const v = holesViewBox(F, [{ e: 110, n: 205 }, { e: 120, n: 215 }])!;
    // Hålen spänner 10 × 10 m; marginalen blir 4 m
    expect(v.w).toBeCloseTo(18, 6);
    expect(v.h).toBeCloseTo(18, 6);
    expect(v.x).toBeCloseTo(6, 6);
    expect(holesViewBox(F, [])).toBeNull();
  });
});

describe("översikt utan ytmodell", () => {
  it("riggens linjer ritas och modellramen kan stängas av", () => {
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, {
      modelFrame: false,
      points: [{ id: "12", sourceId: "12", e: 110, n: 205 }],
      rigLines: {
        plan: [{ id: "12", e0: 110, n0: 205, e1: 112, n1: 215 }],
        quality: [{ id: "12", e0: 110.2, n0: 205.1, e1: 112.4, n1: 215.3 }],
      },
    });
    expect(svg).toContain('class="plan-rig-line plan"');
    expect(svg).toContain('class="plan-rig-line quality"');
    expect(svg).not.toContain('stroke-dasharray="0.6 0.4"');
    const framed = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, {});
    expect(framed).toContain('stroke-dasharray="0.6 0.4"');
  });
});

describe("hål på samma plats", () => {
  it("staplar siffrorna, sätter ×n och ringar in markerad punkt", () => {
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, {
      points: [
        { id: "29", sourceId: "29", e: 120, n: 210 },
        { id: "66", sourceId: "66", e: 120.1, n: 210.05 },
        { id: "7", sourceId: "7", e: 130, n: 210 },
      ],
      selectedSource: "7",
    });
    expect(svg).toContain(">×2<");
    expect((svg.match(/>×2</g) ?? []).length).toBe(1);
    const ys = [...svg.matchAll(/<text x="[^"]+" y="([^"]+)" font-size="0.65"[^>]*>(29|66)</g)].map((m) => [m[2], Number(m[1])] as const);
    expect(ys).toHaveLength(2);
    const y29 = ys.find((x) => x[0] === "29")![1];
    const y66 = ys.find((x) => x[0] === "66")![1];
    expect(Math.abs(y29 - y66)).toBeGreaterThan(0.5);
    // Markerad punkt får en ring, de andra inte.
    expect((svg.match(/r="0\.70"/g) ?? []).length).toBe(1);
  });
});
