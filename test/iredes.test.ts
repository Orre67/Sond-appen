import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lineGeometry, parseIredes, sniffXml } from "../src/io/iredes";
import { replacedLogEntries, rigReferences, rigStartPoints } from "../src/core/project";
import type { StartPoint } from "../src/io/startpoints";

const base = "C:\\Users\\oscar\\Desktop\\filer till claude\\iredes och quallog";
const has = existsSync(base);
const read = (rel: string) => readFileSync(join(base, rel), "utf8");

describe("sniffXml", () => {
  it("skiljer LandXML, plan och logg", () => {
    expect(sniffXml('<?xml version="1.0"?>\n<LandXML xmlns="x">')).toBe("landxml");
    expect(sniffXml('<?xml version="1.0"?>\n<!-- Rockma -->\n<DRPPlan xmlns:IR="x">')).toBe("iredes-plan");
    expect(sniffXml("<DRPQual DRPQualDownwCompat=\"V 1.0\">")).toBe("iredes-quality");
    expect(sniffXml("<Something/>")).toBe("unknown");
  });
});

describe.skipIf(!has)("IREDES exempelfiler", () => {
  it("Rockma-plan: 115 hål med namn, E N Z vänt från PointY PointX", () => {
    const f = parseIredes(read("rockma/iredes/Gladökvarn260907.xml"), "plan.xml");
    expect(f.kind).toBe("plan");
    expect(f.planName).toBe("Gladökvarn260907");
    expect(f.planId).toBe("5583");
    expect(f.holes).toHaveLength(115);
    const h = f.holes[0];
    expect(h.id).toBe("101");
    expect(h.holeId).toBe("2926345");
    expect(h.unnamed).toBe(false);
    expect(h.start).toEqual([671677.67, 6563313.75, 64.188]);
    expect(h.end).toEqual([671678.97, 6563308.535, 36.537]);
    expect(h.diameter).toBe(89);
    expect(h.type).toBe("EasersHole");
    expect(h.length).toBeCloseTo(Math.hypot(1.3, -5.215, -27.651), 6);
    expect(f.warnings).toEqual([]);
  });

  it("Rockma-logg: samma hålnamn som planen, maskin och tider", () => {
    const f = parseIredes(read("rockma/quallog/DQGladökvarn260907.xml"), "logg.xml");
    expect(f.kind).toBe("quality");
    expect(f.planName).toBe("Gladökvarn260907");
    expect(f.equipment).toBe("Epiroc T35");
    expect(f.holes).toHaveLength(115);
    const h = f.holes.find((x) => x.id === "240")!;
    expect(h.start[2]).toBeCloseTo(60.163, 6);
    expect(h.drilledInRock).not.toBeNull();
    expect(h.startTime).toMatch(/^2026-09/);
    expect(f.warnings).toEqual([]);
  });

  it("Epiroc-logg: 27 hål, namn lika med id", () => {
    const f = parseIredes(read("epiroc/quallog/dq280949.xml"), "dq.xml");
    expect(f.kind).toBe("quality");
    expect(f.equipment).toBe("Epiroc SmartROC T40");
    expect(f.holes).toHaveLength(27);
    expect(f.holes[0].id).toBe("1");
    expect(f.holes[0].start).toEqual([501900.158, 6544431.251, 133.217]);
    expect(f.holes[0].diameter).toBe(94);
  });

  it("Sandvik-logg: utan hålnamn, varnar och tar HoleId", () => {
    const f = parseIredes(read("sandvik/quallog/DRPQuality_Almby260927_26-10-01T07-44.xml"), "dxi.xml");
    expect(f.kind).toBe("quality");
    expect(f.equipment).toBe("Sandvik DXi");
    expect(f.holes).toHaveLength(35);
    expect(f.holes[0].id).toBe("3132402");
    expect(f.holes[0].unnamed).toBe(true);
    expect(f.warnings.some((w) => /hålnamn/.test(w))).toBe(true);
    const big = parseIredes(read("sandvik/quallog/DRPQuality_Almby260921_26-10-01T07-44.xml"), "dxi2.xml");
    expect(big.holes).toHaveLength(272);
  });

  it("plan och logg kopplas per hålnamn", () => {
    const plan = parseIredes(read("rockma/iredes/Gladökvarn260907.xml"), "plan.xml");
    const log = parseIredes(read("rockma/quallog/DQGladökvarn260907.xml"), "logg.xml");
    const refs = rigReferences([plan, log], []);
    expect(refs.size).toBe(115);
    const r = refs.get("240")!;
    expect(r.plan?.id).toBe("240");
    expect(r.quality?.id).toBe("240");
    // Riggens startpunkter: loggens start går före planens.
    const pts = rigStartPoints(refs, []);
    expect(pts).toHaveLength(115);
    const p = pts.find((x) => x.id === "240")!;
    expect(p.e).toBeCloseTo(r.quality!.start[0], 6);
  });
});

describe("riggreferenser", () => {
  const hole = (id: string, e: number, n: number, unnamed = false) => ({
    id, holeId: id, unnamed, start: [e, n, 50] as [number, number, number], end: [e, n, 30] as [number, number, number],
    length: 20, drilledInRock: null, diameter: null, type: null, startTime: null, endTime: null, status: null,
  });
  const file = (kind: "plan" | "quality", holes: ReturnType<typeof hole>[]) => ({
    kind, source: kind, planId: null, planName: null, created: null, equipment: null, holes, warnings: [],
  });

  it("logg utan namn matchas på läge mot planen eller startpunkterna inom en meter", () => {
    const plan = file("plan", [hole("12", 100, 200), hole("13", 103, 200)]);
    const log = file("quality", [hole("900001", 100.3, 200.2, true), hole("900002", 110, 200, true)]);
    const points: StartPoint[] = [{ id: "14", e: 110.2, n: 200.1, z: 50, line: 1 }];
    const refs = rigReferences([plan, log], points);
    expect(refs.get("12")?.quality?.holeId).toBe("900001");
    expect(refs.get("14")?.quality?.holeId).toBe("900002");
    expect(refs.get("13")?.quality).toBeUndefined();
    // Startpunkter från riggen: bara hål som saknas i startpunktsfilen.
    const extra = rigStartPoints(refs, points);
    expect(extra.map((p) => p.id).sort()).toEqual(["12", "13"]);
  });

  it("senare fil med samma hålnamn vinner", () => {
    const a = file("quality", [hole("5", 0, 0)]);
    const b = file("quality", [hole("5", 1, 1)]);
    const refs = rigReferences([a, b], []);
    expect(refs.get("5")?.quality?.start[0]).toBe(1);
  });
});

describe("lineGeometry", () => {
  it("bäring, lutning och längd ur en rak linje", () => {
    const g = lineGeometry([0, 0, 10], [Math.sin(Math.PI / 6) * 5, Math.cos(Math.PI / 6) * 5, 10 - 5 / Math.tan((15 * Math.PI) / 180)]);
    expect(g.bearing).toBeCloseTo(30, 6);
    expect(g.inclination).toBeCloseTo(15, 6);
    const v = lineGeometry([0, 0, 10], [0, 0, 0]);
    expect(v.inclination).toBeCloseTo(0, 6);
    expect(v.length).toBeCloseTo(10, 6);
  });
});

describe("ersatta loggningar", () => {
  const hole = (id: string, holeId: string, endTime: string | null) => ({
    id, holeId, unnamed: false, start: [100, 200, 50] as [number, number, number], end: [100, 200, 30] as [number, number, number],
    length: 20, drilledInRock: null, diameter: null, type: null, startTime: null, endTime, status: null,
  });
  const file = (source: string, holes: ReturnType<typeof hole>[]) => ({
    kind: "quality" as const, source, planId: null, planName: null, created: null, equipment: null, holes, warnings: [],
  });

  it("den senast borrade loggningen gäller även när den står först i filen", () => {
    const log = file("logg.xml", [hole("12", "B", "2026-09-23T15:32:32+02:00"), hole("12", "A", "2026-09-07T14:20:01+02:00"), hole("13", "C", null)]);
    const refs = rigReferences([log], []);
    expect(refs.get("12")?.quality?.holeId).toBe("B");
    const replaced = replacedLogEntries([log]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ id: "12", holeId: "A", keptHoleId: "B", source: "logg.xml" });
    expect(replaced[0].time).toBe("2026-09-07T14:20:01+02:00");
  });

  it("utan tider gäller filordningen", () => {
    const log = file("logg.xml", [hole("5", "X", null), hole("5", "Y", null)]);
    expect(rigReferences([log], []).get("5")?.quality?.holeId).toBe("Y");
    expect(replacedLogEntries([log])[0].holeId).toBe("X");
  });
});
