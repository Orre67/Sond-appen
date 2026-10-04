import { describe, expect, it } from "vitest";
import { pan, zoomAround, type ViewBox } from "../src/view/panzoom";

const fit: ViewBox = { x: 0, y: 0, w: 100, h: 50 };

describe("dra och zooma", () => {
  it("zoomar kring en punkt som ligger stilla", () => {
    const v = zoomAround(fit, 25, 10, 0.5, fit);
    expect(v.w).toBeCloseTo(50);
    expect(v.h).toBeCloseTo(25);
    // Punktens relativa läge i rutan är oförändrat
    expect((25 - v.x) / v.w).toBeCloseTo(25 / 100);
    expect((10 - v.y) / v.h).toBeCloseTo(10 / 50);
  });

  it("begränsar zoomen", () => {
    const inMost = zoomAround(fit, 50, 25, 1e-6, fit);
    expect(inMost.w).toBeCloseTo(100 / 60);
    const outMost = zoomAround(fit, 50, 25, 1e6, fit);
    expect(outMost.w).toBeCloseTo(200);
    expect(outMost.h).toBeCloseTo(100);
  });

  it("flyttar utan att ändra storlek", () => {
    const v = pan({ x: 10, y: 5, w: 40, h: 20 }, -3, 2);
    expect(v).toEqual({ x: 7, y: 7, w: 40, h: 20 });
  });
});
