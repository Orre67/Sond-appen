import type { HoleResult } from "../geom/burden";
import { fmt } from "../view/format";

export function rowType(row: { stickStart: number; stickEnd: number; isBottom: boolean; cls: string }): string {
  if (row.cls === "collar") return "påhugg";
  const base = row.stickEnd - row.stickStart > 1e-9 ? "sticka" : "punkt";
  return row.isBottom ? `${base}, botten` : base;
}

/** CSV med semikolon och decimalkomma, för svensk Excel. */
export function toCsv(results: HoleResult[]): string {
  const head = [
    "Hål", "Djup [m]", "Sticka från [m]", "Sticka till [m]", "Typ", "E", "N", "Z", "Försättning [m]", "Klass",
    "Bäring till yta [°]", "Höjdvinkel till yta [°]", "Närmaste E", "Närmaste N", "Närmaste Z", "Fritt 3D-min [m]",
  ];
  const lines = [head.join(";")];
  for (const r of results) {
    for (const row of r.rows) {
      lines.push(
        [
          r.id, fmt(row.depth), fmt(row.stickStart), fmt(row.stickEnd), rowType(row),
          fmt(row.point[0]), fmt(row.point[1]), fmt(row.point[2]), fmt(row.burden), row.cls,
          fmt(row.bearingTo, 0), fmt(row.elevationTo, 0),
          fmt(row.closest ? row.closest[0] : null), fmt(row.closest ? row.closest[1] : null), fmt(row.closest ? row.closest[2] : null),
          fmt(row.free3d),
        ].join(";"),
      );
    }
  }
  return lines.join("\n");
}
