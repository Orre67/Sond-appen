import { describe, expect, it } from "vitest";
import { applyRenames, assignNumber, clearNumbers, highestNumber, nextFree, numberUnnumbered, type Renames } from "../src/core/numbering";
import type { StartPoint } from "../src/io/startpoints";

const pts = (...ids: string[]): StartPoint[] => ids.map((id, i) => ({ id, e: i, n: 0, z: 0, line: i + 1 }));

describe("omnumrering", () => {
  it("klick för klick från 1, upptagna nummer hoppas över", () => {
    const points = pts("101", "102", "103", "3");
    const renames: Renames = new Map();
    expect(assignNumber(renames, points, "101", 1)).toBe(1);
    expect(assignNumber(renames, points, "102", 2)).toBe(2);
    // 3 är upptaget av en punkt som behåller sitt nummer, nästa lediga är 4
    expect(assignNumber(renames, points, "103", 3)).toBe(4);
    const a = applyRenames(points, renames);
    expect(a.numbered.map((p) => p.id)).toEqual(["1", "2", "4", "3"]);
    expect(a.numbered[0].sourceId).toBe("101");
    expect(a.unnumbered).toHaveLength(0);
  });

  it("nollställ tar bort alla nummer, numrera onumrerade fortsätter från sista numret i filens ordning", () => {
    const points = pts("101", "102", "103", "104", "105");
    const renames: Renames = new Map();
    clearNumbers(renames, points);
    expect(applyRenames(points, renames).unnumbered).toHaveLength(5);
    assignNumber(renames, points, "103", 1);
    assignNumber(renames, points, "104", 2);
    expect(highestNumber(applyRenames(points, renames).numbered)).toBe(2);
    expect(numberUnnumbered(renames, points)).toBe(3);
    const a = applyRenames(points, renames);
    expect(a.unnumbered).toHaveLength(0);
    expect(a.numbered.map((p) => [p.sourceId, p.id])).toEqual([
      ["101", "3"],
      ["102", "4"],
      ["103", "1"],
      ["104", "2"],
      ["105", "5"],
    ]);
  });

  it("nästa lediga nummer räknar inte den punkt som ska få numret", () => {
    const points = pts("1", "2", "3");
    const { numbered } = applyRenames(points, new Map());
    expect(nextFree(1, numbered, "1")).toBe(1);
    expect(nextFree(1, numbered)).toBe(4);
    expect(nextFree(2.4, numbered, "2")).toBe(2);
  });
});
