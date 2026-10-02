import type { BurdenClass, BurdenRow, HoleResult } from "../geom/burden";
import type { Vec3 } from "../geom/vec";

/**
 * DXF-export (ASCII, R12) för kontroll i Metashape eller CAD.
 *
 * Per hål skapas lagren
 *   H<id>_YTPUNKTER  punkterna på ytan som måtten räknats från, samt en 3D-polylinje genom dem i djupordning
 *   H<id>_MATT       en linje per mätning från provpunkten i hålet till ytpunkten, färgad efter klass
 *   H<id>_SPAR       ytspåret: närmaste ytpunkt för varje tät provpunkt, som 3D-polylinje
 *   H<id>_HAL        hålbanan från påhugg till botten
 *
 * Koordinaterna skrivs i samma system som indata (E, N, höjd) med millimeterupplösning.
 */
export interface DxfOptions {
  includeBurdenLines: boolean;
  includeHolePath: boolean;
  includePoints: boolean;
  includeTrace: boolean;
  /** Ta med stickor/punkter ovanför startdjupet. */
  includeSkipped: boolean;
  /** Startdjup, används för att klippa ytspåret. */
  startDepth: number;
  /** Begränsa till dessa hål-ID, annars alla. */
  holeIds?: string[];
}

export const DEFAULT_DXF_OPTIONS: DxfOptions = {
  includeBurdenLines: true,
  includeHolePath: true,
  includePoints: true,
  includeTrace: true,
  includeSkipped: false,
  startDepth: 0,
};

/** AutoCAD-färgindex per klass. */
const ACI: Record<BurdenClass, number> = { collar: 8, skipped: 8, low: 1, ok: 3, high: 5, none: 8 };
const ACI_SURFACE = 6; // magenta, syns bra mot berg
const ACI_TRACE = 1; // röd
const ACI_HOLE = 7; // svart/vit

export function toDxf(results: HoleResult[], options: Partial<DxfOptions> = {}): string {
  const opts = { ...DEFAULT_DXF_OPTIONS, ...options };
  const list = opts.holeIds ? results.filter((r) => opts.holeIds!.includes(r.id)) : results;
  const layers: { name: string; color: number }[] = [];
  const ent: string[] = [];
  const f = (v: number) => v.toFixed(3);

  const line = (layer: string, color: number, a: Vec3, b: Vec3) => {
    ent.push("0", "LINE", "8", layer, "62", String(color), "10", f(a[0]), "20", f(a[1]), "30", f(a[2]), "11", f(b[0]), "21", f(b[1]), "31", f(b[2]));
  };
  const point = (layer: string, color: number, p: Vec3) => {
    ent.push("0", "POINT", "8", layer, "62", String(color), "10", f(p[0]), "20", f(p[1]), "30", f(p[2]));
  };
  const polyline = (layer: string, color: number, pts: Vec3[]) => {
    if (pts.length < 2) return;
    ent.push("0", "POLYLINE", "8", layer, "62", String(color), "66", "1", "70", "8", "10", "0.0", "20", "0.0", "30", "0.0");
    for (const p of pts) ent.push("0", "VERTEX", "8", layer, "10", f(p[0]), "20", f(p[1]), "30", f(p[2]), "70", "32");
    ent.push("0", "SEQEND", "8", layer);
  };

  for (const r of list) {
    const base = `H${sanitizeLayer(r.id)}`;
    const rows = r.rows.filter((row) => rowIsMeasured(row, opts.includeSkipped));

    const surfaceLayer = `${base}_YTPUNKTER`;
    layers.push({ name: surfaceLayer, color: ACI_SURFACE });
    const surfacePts = rows.map((row) => row.closest!).filter(Boolean);
    if (opts.includePoints) for (const p of surfacePts) point(surfaceLayer, ACI_SURFACE, p);
    polyline(surfaceLayer, ACI_SURFACE, surfacePts);

    if (opts.includeBurdenLines) {
      const burdenLayer = `${base}_MATT`;
      layers.push({ name: burdenLayer, color: ACI.ok });
      for (const row of rows) line(burdenLayer, ACI[row.cls], row.point, row.closest!);
    }

    if (opts.includeTrace) {
      const traceLayer = `${base}_SPAR`;
      layers.push({ name: traceLayer, color: ACI_TRACE });
      const pts = r.fine.filter((s) => s.closest && s.depth >= opts.startDepth - 1e-9).map((s) => s.closest!);
      polyline(traceLayer, ACI_TRACE, pts);
    }

    if (opts.includeHolePath) {
      const holeLayer = `${base}_HAL`;
      layers.push({ name: holeLayer, color: ACI_HOLE });
      polyline(holeLayer, ACI_HOLE, r.path.points);
    }
  }

  const out: string[] = [];
  out.push("0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "6", "0", "ENDSEC");
  out.push("0", "SECTION", "2", "TABLES");
  out.push("0", "TABLE", "2", "LTYPE", "70", "1", "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0", "0", "ENDTAB");
  out.push("0", "TABLE", "2", "LAYER", "70", String(layers.length + 1));
  out.push("0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS");
  for (const l of layers) out.push("0", "LAYER", "2", l.name, "70", "0", "62", String(l.color), "6", "CONTINUOUS");
  out.push("0", "ENDTAB", "0", "ENDSEC");
  out.push("0", "SECTION", "2", "ENTITIES", ...ent, "0", "ENDSEC", "0", "EOF");
  return out.join("\r\n") + "\r\n";
}

function rowIsMeasured(row: BurdenRow, includeSkipped: boolean): boolean {
  if (!row.closest || row.burden === null) return false;
  if (row.cls === "collar") return false;
  if (row.cls === "skipped" && !includeSkipped) return false;
  return true;
}

function sanitizeLayer(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24) || "X";
}
