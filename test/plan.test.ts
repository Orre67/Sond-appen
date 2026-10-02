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

  it("ritar startpunkter utan hål och skjutriktningspil", () => {
    const svg = renderPlanSvg([], DEFAULT_OPTIONS, bounds, null, null, {
      bearing: 45,
      points: [
        { id: null, sourceId: "101", e: 120, n: 210 },
        { id: "7", sourceId: "107", e: 121, n: 211 },
      ],
      numbering: true,
    });
    expect(svg).toContain('class="plan-point" data-source="101"');
    expect(svg).toContain("(101)");
    expect(svg).toContain("(107)");
    expect(svg).toContain("Skjutriktning 45°");
    expect(svg).toContain('data-bearing="45"');
    expect(svg).toContain('id="plan-overlay"');
  });
});
