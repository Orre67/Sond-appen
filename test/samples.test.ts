/**
 * Tester mot de riktiga exempelfilerna från Torphyttan. Hoppas över om mappen saknas.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { linkHoles } from "../src/core/project";
import { computeHole } from "../src/geom/burden";
import { Surface } from "../src/geom/surface";
import { parseDm4, type SondeProfile } from "../src/io/dm4";
import { parseLandXml } from "../src/io/landxml";
import { parseObj } from "../src/io/obj";
import { parseStartPoints } from "../src/io/startpoints";

const base = "C:\\Users\\oscar\\Desktop\\filer till claude\\sond appen";
const has = existsSync(base);

describe.skipIf(!has)("Torphyttan exempelfiler", () => {
  const objText = () => readFileSync(join(base, "obj", "test1.obj"), "utf8");
  const xmlText = () => readFileSync(join(base, "xml", "test1.xml"), "utf8");

  it("OBJ och LandXML ger samma modell", () => {
    const obj = parseObj(objText());
    const xml = parseLandXml(xmlText());
    expect(obj.positions.length / 3).toBe(283129);
    expect(obj.indices.length / 3).toBe(562239);
    expect(xml.positions.length / 3).toBe(283129);
    expect(xml.indices.length / 3).toBe(562239);
    expect(xml.epsg).toBe("5845");
    for (let i = 0; i < 9; i++) expect(xml.positions[i]).toBeCloseTo(obj.positions[i], 5);
    expect(Array.from(xml.indices.slice(0, 9))).toEqual(Array.from(obj.indices.slice(0, 9)));
    expect(obj.uvs).toBeDefined();
    expect(obj.uvs!.length / 2).toBe(348454);
  });

  it("alla påhugg ligger på ytan och hål 20 får rimlig försättning", () => {
    const surface = Surface.fromMesh(parseObj(objText()));
    const sp = parseStartPoints(readFileSync(join(base, "hålens startpunkter", "2026-10-01-Torphyttan.txt"), "utf8"));
    expect(sp.points).toHaveLength(27);
    const profiles: SondeProfile[] = [];
    const dmDir = join(base, "sond data dm4");
    for (const f of readdirSync(dmDir)) profiles.push(...parseDm4(readFileSync(join(dmDir, f), "utf8"), f).profiles);
    expect(profiles).toHaveLength(24);
    const link = linkHoles(sp.points, profiles);
    expect(link.holes).toHaveLength(24);
    expect(link.unmatchedPoints.map((p) => p.id)).toEqual(["100", "200", "300"]);

    for (const h of link.holes) {
      const d = surface.closestPoint(h.collar)!.distance;
      expect(d, `påhugg ${h.id}`).toBeLessThan(0.15);
    }

    const h20 = link.holes.find((h) => h.id === "20")!;
    const r = computeHole(surface, h20, { interval: 0.5, mode: "point" });
    const at = (d: number) => r.rows.find((x) => Math.abs(x.depth - d) < 1e-6)!;
    // Jämfört med den fristående kontrollen i Python (närmaste hörnpunkt, dvs en övre gräns).
    expect(at(4).burden!).toBeGreaterThan(2.4);
    expect(at(4).burden!).toBeLessThanOrEqual(2.75);
    // Krönspärren håller överytan borta vid 0,5 m, där det fria minimum är själva påhuggsytan.
    expect(at(0.5).burden!).toBeGreaterThan(at(0.5).free3d!);
    // Fri 3D: vid 2,5 m är slänten strax under krönet närmast, klart under 1,8 m.
    expect(at(2.5).burden!).toBeLessThan(1.8);
    expect(at(2.5).free3d!).toBeLessThan(1.8);
    for (const row of r.rows.slice(1)) expect(row.burden!).toBeGreaterThanOrEqual(row.free3d! - 1e-9);
    // Den äldre planregeln (fri 3D först bortom hålets längd) mäter vågrätt och ger över 2 m där.
    const plane = computeHole(surface, h20, { interval: 0.5, mode: "point", free3dFromDepth: 100 });
    expect(plane.rows.find((x) => Math.abs(x.depth - 2.5) < 1e-6)!.burden!).toBeGreaterThan(2.0);
    // Stickläge ger aldrig ett större minimum än punktläget
    const s = computeHole(surface, h20, { interval: 1, mode: "stick", fineStep: 0.05 });
    expect(s.minBurden!).toBeLessThanOrEqual(r.minBurden! + 1e-9);
    expect(s.rows.filter((x) => x.cls !== "collar").length).toBe(14);
    const bottom = r.path.points[r.path.points.length - 1];
    expect(bottom[0] - h20.collar[0]).toBeCloseTo(4.08, 1);
    expect(bottom[2] - h20.collar[2]).toBeCloseTo(-12.64, 1);
  });
});
