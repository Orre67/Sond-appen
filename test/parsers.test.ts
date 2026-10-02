import { describe, expect, it } from "vitest";
import { parseDm4 } from "../src/io/dm4";
import { parseLandXml } from "../src/io/landxml";
import { parseMtl, parseObj } from "../src/io/obj";
import { normalizeId, parseStartPoints } from "../src/io/startpoints";

describe("startpunkter", () => {
  it("läser kommaseparerad fil med avslutande komma", () => {
    const r = parseStartPoints("1,508349.00,6606556.78,126.57,\n2,508349.47,6606560.50,126.69,\n");
    expect(r.points).toHaveLength(2);
    expect(r.points[0]).toMatchObject({ id: "1", e: 508349.0, n: 6606556.78, z: 126.57 });
    expect(r.swappedEN).toBe(false);
  });

  it("läser semikolon med decimalkomma", () => {
    const r = parseStartPoints("H1;508349,00;6606556,78;126,57\nH2;508349,47;6606560,50;126,69");
    expect(r.separator).toBe(";");
    expect(r.points[1]).toMatchObject({ id: "H2", e: 508349.47, n: 6606560.5, z: 126.69 });
  });

  it("läser tab och mellanslag samt hoppar över rubrikrad", () => {
    const r = parseStartPoints("Id\tE\tN\tZ\n7\t508352.35\t6606578.73\t125.46");
    expect(r.points).toHaveLength(1);
    expect(r.points[0].id).toBe("7");
    const s = parseStartPoints("12   508354.17 6606597.32   125.26");
    expect(s.points[0]).toMatchObject({ id: "12", e: 508354.17 });
  });

  it("byter N E Z till E N Z när ordningen är omvänd", () => {
    const r = parseStartPoints("1,6606556.78,508349.00,126.57\n2,6606560.50,508349.47,126.69");
    expect(r.swappedEN).toBe(true);
    expect(r.points[0].e).toBeCloseTo(508349.0);
    expect(r.points[0].n).toBeCloseTo(6606556.78);
  });

  it("varnar för dubbla id och normaliserar id", () => {
    const r = parseStartPoints("01,1,2,3\n1,4,5,6");
    expect(r.warnings.some((w) => w.includes("flera gånger"))).toBe(true);
    expect(normalizeId(" 007 ")).toBe("7");
    expect(normalizeId("a12")).toBe("A12");
  });
});

describe("dm4", () => {
  const sample = [
    "Profile Number  ,20",
    "Depth in metres?,13.3",
    "Incrm in metres?,2.0",
    "Sonde Data Point,0.0,83.98,13.62,0,0",
    "Sonde Data Point,0.4,87.08,13.86,0,0",
    "Sonde Data Point,2.5,85.74,15.16,0,0",
    "Sonde Data Point,13.3,95.86,20.56,0,0",
    "Profile Number  ,21",
    "Depth in metres?,12.5",
    "Incrm in metres?,2.0",
    "Sonde Data Point,0.0,75.6,11.26,0,0",
    "Sonde Data Point,12.5,64.08,14.98,0,0",
  ].join("\r\n");

  it("läser profiler och stationer", () => {
    const r = parseDm4(sample, "test.dm4");
    expect(r.profiles.map((p) => p.id)).toEqual(["20", "21"]);
    expect(r.profiles[0].totalDepth).toBe(13.3);
    expect(r.profiles[0].increment).toBe(2.0);
    expect(r.profiles[0].stations).toHaveLength(4);
    expect(r.profiles[0].stations[1]).toEqual({ depth: 0.4, bearing: 87.08, inclination: 13.86 });
    expect(r.warnings).toHaveLength(0);
  });

  it("varnar när angivet djup inte stämmer med sista stationen", () => {
    const r = parseDm4("Profile Number ,5\nDepth in metres?,10.0\nSonde Data Point,0.0,90,10,0,0\nSonde Data Point,8.0,90,10,0,0");
    expect(r.warnings.some((w) => w.includes("angivet djup"))).toBe(true);
  });
});

describe("landxml", () => {
  const xml = `<?xml version="1.0"?>
<LandXML version="1.2"><Units><Metric linearUnit="meter"/></Units>
<CoordinateSystem name="SWEREF99 TM + RH2000 height" epsgCode="5845"></CoordinateSystem>
<Surfaces><Surface name="yta"><Definition surfType="TIN"><Pnts>
<P id="1">6606567.1 508356.0 115.5</P>
<P id="2">6606567.2 508357.0 115.7</P>
<P id="3">6606568.1 508356.0 115.8</P>
<P id="4">6606568.2 508357.0 116.0</P>
</Pnts><Faces><F>1 2 3</F><F>2 4 3</F><F i="1">1 3 4</F></Faces></Definition></Surface></Surfaces></LandXML>`;

  it("läser punkter i N E Z och vänder till E N Z", () => {
    const m = parseLandXml(xml);
    expect(m.positions.length).toBe(12);
    expect(m.positions[0]).toBeCloseTo(508356.0);
    expect(m.positions[1]).toBeCloseTo(6606567.1);
    expect(m.positions[2]).toBeCloseTo(115.5);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 1, 3, 2]);
    expect(m.epsg).toBe("5845");
    expect(m.crsName).toContain("SWEREF99");
    expect(m.warnings.some((w) => w.includes("osynliga"))).toBe(true);
  });
});

describe("obj", () => {
  it("läser v, vt och f med polygon", () => {
    const obj = [
      "mtllib test1.mtl",
      "v 10 20 30",
      "v 11 20 30",
      "v 11 21 30",
      "v 10 21 30",
      "vt 0 0",
      "vt 1 0",
      "vt 1 1",
      "vt 0 1",
      "f 1/1 2/2 3/3 4/4",
    ].join("\n");
    const m = parseObj(obj);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(m.uvIndices!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(m.name).toBe("test1");
    expect(m.warnings.some((w) => w.includes("fler än tre hörn"))).toBe(true);
  });

  it("läser texturfil ur MTL", () => {
    expect(parseMtl("newmtl Solid\nKd 1 1 1\n\nnewmtl test1\nmap_Kd test1.jpg\n")).toEqual({ test1: "test1.jpg" });
  });
});
