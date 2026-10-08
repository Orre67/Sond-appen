import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../src/geom/burden";
import type { Bounds } from "../src/io/mesh";
import { blastBearingFromLine, planFrame, renderPlanSvg, rotatedExtent } from "../src/view/plan";

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
    expect(phone).toContain('font-size="2.20"');
    expect(phone).toContain('r="0.80"');
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
