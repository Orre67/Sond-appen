import { describe, expect, it } from "vitest";
import {
  autoBearingCorrection,
  describeCorrection,
  gridConvergence,
  latLonToTm,
  looksLikeSwerefTm,
  magneticDeclination,
  tmToLatLon,
} from "../src/geom/geodesy";

describe("SWEREF 99 TM", () => {
  it("mittmeridianen ligger på E 500 000", () => {
    const p = tmToLatLon(500000, 6600000);
    expect(p.lon).toBeCloseTo(15, 9);
    expect(latLonToTm(p.lat, 15).e).toBeCloseTo(500000, 6);
  });

  it("fram och tillbaka över hela landet", () => {
    for (const lat of [55.4, 59.33, 60.07, 65.8, 69.0]) {
      for (const lon of [11.2, 15, 18.07, 24.1]) {
        const { e, n } = latLonToTm(lat, lon);
        const q = tmToLatLon(e, n);
        expect(q.lat, `lat ${lat} lon ${lon}`).toBeCloseTo(lat, 8);
        expect(q.lon, `lat ${lat} lon ${lon}`).toBeCloseTo(lon, 8);
      }
    }
  });

  it("Stockholm hamnar ungefär rätt", () => {
    const p = tmToLatLon(674000, 6581000);
    expect(p.lat).toBeCloseTo(59.33, 1);
    expect(p.lon).toBeCloseTo(18.07, 1);
  });

  it("känner igen TM på värdena", () => {
    expect(looksLikeSwerefTm(508350, 6606560)).toBe(true);
    expect(looksLikeSwerefTm(148500, 6612000)).toBe(false);
    expect(looksLikeSwerefTm(1000, 2000)).toBe(false);
  });
});

describe("meridiankonvergens", () => {
  it("är noll på mittmeridianen och växer österut", () => {
    expect(gridConvergence(60, 15)).toBeCloseTo(0, 9);
    expect(gridConvergence(59.33, 18.07)).toBeCloseTo(2.64, 1);
    expect(gridConvergence(60.07, 15.92)).toBeCloseTo(0.8, 1);
    expect(gridConvergence(57.7, 11.97)).toBeLessThan(-2);
  });
});

describe("missvisning WMM2025", () => {
  it("stämmer med NOAA:s testvärden", () => {
    const y2025 = new Date(2025, 0, 1);
    expect(magneticDeclination(80, 0, y2025).declination).toBeCloseTo(1.28, 1);
    expect(magneticDeclination(0, 120, y2025).declination).toBeCloseTo(-0.16, 1);
    expect(magneticDeclination(-80, 240, y2025).declination).toBeCloseTo(68.78, 1);
    const y2027 = new Date(2027, 6, 2);
    expect(magneticDeclination(80, 0, y2027).declination).toBeCloseTo(2.59, 1);
    expect(magneticDeclination(-80, 240, y2027).declination).toBeCloseTo(68.49, 1);
    expect(magneticDeclination(80, 0, y2025).model).toMatch(/2025/);
  });

  it("klarar datum utanför modellen genom närmaste modell", () => {
    expect(Number.isFinite(magneticDeclination(60, 15, new Date(2022, 5, 1)).declination)).toBe(true);
    expect(Number.isFinite(magneticDeclination(60, 15, new Date(2031, 5, 1)).declination)).toBe(true);
  });
});

describe("automatisk bäringskorrektion", () => {
  it("Norberg: omkring +6 grader", () => {
    const c = autoBearingCorrection(551300, 6660000, new Date(2026, 9, 1))!;
    expect(c).not.toBeNull();
    expect(c.lat).toBeCloseTo(60.07, 1);
    expect(c.lon).toBeCloseTo(15.92, 1);
    expect(c.convergence).toBeCloseTo(0.8, 1);
    expect(c.declination).toBeGreaterThan(5);
    expect(c.declination).toBeLessThan(9);
    expect(c.correction).toBeCloseTo(c.declination - c.convergence, 9);
    expect(describeCorrection(c)).toMatch(/^missvisning \+\d,\d° \(WMM-2025, 2026-10-01\) − konvergens \+0,8° \(SWEREF 99 TM\) = \+\d,\d°$/);
  });

  it("ger null för lokala koordinater", () => {
    expect(autoBearingCorrection(1000, 2000, new Date())).toBeNull();
  });
});
