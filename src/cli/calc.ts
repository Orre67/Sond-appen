/**
 * Kommandoradsverktyg för steg 1: läser yta, startpunkter och DM4-filer,
 * räknar försättning och skriver tabell samt CSV.
 *
 *   npm run calc -- --surface yta.obj --points start.txt --dm4 a.dm4 b.dm4 [--interval 0.5] [--min 1.5] [--max 3.5] [--hole 20] [--out out/forsattning.csv]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { toCsv } from "../core/csv";
import { toDxf } from "../core/dxf";
import { checkCollars } from "../core/check";
import { linkHoles, rigReferences, rigStartPoints } from "../core/project";
import { renderProfileSvg } from "../view/profile";
import { computeHole, DEFAULT_OPTIONS, type BurdenOptions } from "../geom/burden";
import { autoBearingCorrection, describeCorrection } from "../geom/geodesy";
import { buildHolePath } from "../geom/hole";
import { dateFromFileName } from "../core/catalog";
import { Surface } from "../geom/surface";
import { parseDm4, type SondeProfile } from "../io/dm4";
import { parseLandXml } from "../io/landxml";
import type { MeshData } from "../io/mesh";
import { parseObj } from "../io/obj";
import { normalizeId, parseStartPoints } from "../io/startpoints";
import { parseIredes, type IredesFile } from "../io/iredes";

interface Args {
  surface?: string;
  points?: string;
  dm4: string[];
  /** IREDES-filer från riggen: borrplan och kvalitetslogg. */
  rig: string[];
  hole?: string;
  out: string;
  svgDir?: string;
  dxf?: string;
  holes?: string[];
  opts: Partial<BurdenOptions>;
  /** Automatisk bäringskorrektion ur ytmodellens läge och sonderingsdatumet. */
  auto: boolean;
  date?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dm4: [], rig: [], out: "out/forsattning.csv", opts: {}, auto: false };
  let i = 0;
  const next = () => argv[++i];
  for (; i < argv.length; i++) {
    const k = argv[i];
    switch (k) {
      case "--surface":
        a.surface = next();
        break;
      case "--points":
        a.points = next();
        break;
      case "--dm4":
        while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) a.dm4.push(argv[++i]);
        break;
      case "--rig":
        while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) a.rig.push(argv[++i]);
        break;
      case "--hole":
        a.hole = next();
        break;
      case "--out":
        a.out = next();
        break;
      case "--svg":
        a.svgDir = next();
        break;
      case "--dxf":
        a.dxf = next();
        break;
      case "--holes":
        a.holes = next().split(",").map((x) => x.trim()).filter(Boolean);
        break;
      case "--interval":
        a.opts.interval = Number(next());
        break;
      case "--min":
        a.opts.minBurden = Number(next());
        break;
      case "--max":
        a.opts.maxBurden = Number(next());
        break;
      case "--correction":
        a.opts.bearingCorrection = Number(next());
        break;
      case "--start":
        a.opts.startDepth = Number(next());
        break;
      case "--method":
        a.opts.method = next() === "tangent" ? "tangent" : "average";
        break;
      case "--mode":
        a.opts.mode = next() === "point" ? "point" : "stick";
        break;
      case "--fine":
        a.opts.fineStep = Number(next());
        break;
      case "--free":
        a.opts.free3dFromDepth = Number(next());
        break;
      case "--crest":
        a.opts.crestMargin = Number(next());
        break;
      case "--auto":
        a.auto = true;
        break;
      case "--date":
        a.date = next();
        break;
      default:
        throw new Error(`Okänt argument: ${k}`);
    }
  }
  return a;
}

export function loadSurfaceFile(path: string): MeshData {
  const ext = extname(path).toLowerCase();
  const text = readFileSync(path, "utf8");
  if (ext === ".obj") return parseObj(text);
  if (ext === ".xml" || ext === ".landxml") return parseLandXml(text);
  throw new Error(`Okänt ytformat: ${ext}`);
}

const f2 = (v: number | null) => (v === null ? "" : v.toFixed(2));
const sv = (v: number | null, d = 2) => (v === null ? "" : v.toFixed(d).replace(".", ","));

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.surface || !args.points || args.dm4.length === 0) {
    console.error("Användning: --surface <fil> --points <fil> --dm4 <fil...> [--rig plan.xml logg.xml --interval 0.5 --min 1.5 --max 3.5 --start 1 --mode stick|point --fine 0.05 --correction 0 --auto --date 2026-10-01 --method average|tangent --hole 20 --out fil.csv --svg out/profiler --dxf out/kontroll.dxf --holes 19,20]");
    process.exit(1);
  }
  const t0 = performance.now();
  const mesh = loadSurfaceFile(args.surface);
  const t1 = performance.now();
  const surface = Surface.fromMesh(mesh);
  const t2 = performance.now();
  console.log(`Yta: ${basename(args.surface)} (${mesh.source}) ${surface.triangleCount} trianglar, inläst ${(t1 - t0).toFixed(0)} ms, index ${(t2 - t1).toFixed(0)} ms`);
  console.log(`  E ${f2(surface.bounds.min[0])}..${f2(surface.bounds.max[0])}  N ${f2(surface.bounds.min[1])}..${f2(surface.bounds.max[1])}  Z ${f2(surface.bounds.min[2])}..${f2(surface.bounds.max[2])}`);
  if (mesh.crsName) console.log(`  Koordinatsystem: ${mesh.crsName}${mesh.epsg ? ` (EPSG ${mesh.epsg})` : ""}`);
  for (const w of mesh.warnings) console.log(`  Varning: ${w}`);

  const sp = parseStartPoints(readFileSync(args.points, "utf8"));
  console.log(`Startpunkter: ${sp.points.length} st, separator ${JSON.stringify(sp.separator)}${sp.note ? `, ${sp.note}` : ""}`);
  for (const w of sp.warnings) console.log(`  Varning: ${w}`);

  const profiles: SondeProfile[] = [];
  for (const f of args.dm4) {
    const r = parseDm4(readFileSync(f, "utf8"), basename(f));
    profiles.push(...r.profiles);
    for (const w of r.warnings) console.log(`  Varning: ${w}`);
  }
  console.log(`Sondering: ${profiles.length} profiler från ${args.dm4.length} fil(er)`);

  const rigFiles: IredesFile[] = args.rig.map((f) => parseIredes(readFileSync(f, "utf8"), basename(f)));
  for (const f of rigFiles) {
    console.log(`Rigg: ${f.source} ${f.kind === "plan" ? "borrplan" : "kvalitetslogg"}, ${f.holes.length} hål${f.equipment ? `, ${f.equipment}` : ""}`);
    for (const w of f.warnings) console.log(`  Varning: ${w}`);
  }
  const rigRefs = rigReferences(rigFiles, sp.points);
  const link = linkHoles([...sp.points, ...rigStartPoints(rigRefs, sp.points)], profiles);
  for (const w of link.warnings) console.log(`  Varning: ${w}`);
  if (link.unmatchedPoints.length) console.log(`  Startpunkter utan sondering: ${link.unmatchedPoints.map((p) => p.id).join(", ")}`);
  if (link.unmatchedProfiles.length) console.log(`  Sondering utan startpunkt: ${link.unmatchedProfiles.map((p) => p.id).join(", ")}`);
  for (const w of checkCollars(surface, link.holes)) console.log(`  Varning: ${w}`);

  const opts = { ...DEFAULT_OPTIONS, ...args.opts };
  let autoCorrection = 0;
  if (args.auto) {
    const dateText = args.date ?? args.dm4.map((f) => dateFromFileName(basename(f))).find((d): d is string => !!d);
    const parts = dateText ? dateText.split("-").map(Number) : [];
    const date = parts.length === 3 && parts.every(Number.isFinite) ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date();
    const b = surface.bounds;
    const auto = autoBearingCorrection((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, date);
    if (!auto) console.log("Auto: ytmodellens koordinater är inte SWEREF 99 TM, ingen automatisk bäringskorrektion.");
    else {
      autoCorrection = auto.correction;
      opts.bearingCorrection += auto.correction;
      console.log(`Auto bäringskorrektion: ${describeCorrection(auto)} (lat ${auto.lat.toFixed(4)}, lon ${auto.lon.toFixed(4)})`);
    }
  }
  console.log(`\nInställningar: mått ${opts.interval} m, min ${opts.minBurden} m, max ${opts.maxBurden} m, startdjup ${opts.startDepth} m, ${opts.free3dFromDepth > 0 ? `fri 3D från ${opts.free3dFromDepth} m` : "fri 3D hela vägen"} (krönmarginal ${opts.crestMargin} m), metod ${opts.method}, bäringskorrektion ${opts.bearingCorrection.toFixed(2)}°`);

  const t3 = performance.now();
  const results = link.holes.map((h) => {
    const r = computeHole(surface, h, opts);
    const ref = rigRefs.get(normalizeId(h.id));
    if (ref && (ref.plan || ref.quality)) {
      r.reference = {
        plan: ref.plan ? { start: ref.plan.start, end: ref.plan.end } : undefined,
        quality: ref.quality ? { start: ref.quality.start, end: ref.quality.end } : undefined,
      };
    }
    if (Math.abs(autoCorrection) > 1e-9) r.ghost = buildHolePath(h, { method: opts.method, bearingCorrection: opts.bearingCorrection - autoCorrection });
    return r;
  });
  const t4 = performance.now();
  console.log(`Beräknade ${results.length} hål på ${(t4 - t3).toFixed(0)} ms\n`);

  console.log("Hål   Längd   Botten dZ   Minsta försättning   Röda   Blå");
  for (const r of results) {
    const low = r.rows.filter((x) => x.cls === "low").length;
    const high = r.rows.filter((x) => x.cls === "high").length;
    const bottom = r.path.points[r.path.points.length - 1];
    console.log(
      `${r.id.padStart(3)}   ${r.path.length.toFixed(1).padStart(5)}   ${(bottom[2] - r.path.collar[2]).toFixed(2).padStart(7)}      ${f2(r.minBurden).padStart(5)} @ ${r.minBurdenDepth?.toFixed(1).padStart(4)} m     ${String(low).padStart(3)}   ${String(high).padStart(3)}`,
    );
  }

  const show = args.hole ? results.find((r) => r.id === args.hole) : results[0];
  if (show) {
    console.log(`\nHål ${show.id}: djup, försättning, klass, bäring/höjdvinkel till yta, fritt 3D-min`);
    for (const row of show.rows) {
      const tag = row.stickEnd - row.stickStart > 1e-9 ? `${row.stickStart.toFixed(1)}-${row.stickEnd.toFixed(1)}`.padStart(9) : "".padStart(9);
      console.log(
        `${tag} ${row.depth.toFixed(2).padStart(6)}  ${f2(row.burden).padStart(5)}  ${row.cls.padEnd(6)}  ${sv(row.bearingTo, 0).padStart(4)}° ${sv(row.elevationTo, 0).padStart(4)}°   ${f2(row.free3d).padStart(5)}`,
      );
    }
  }

  const exportSet = args.holes ? results.filter((r) => args.holes!.includes(r.id)) : results;
  if (args.svgDir) {
    if (!existsSync(args.svgDir)) mkdirSync(args.svgDir, { recursive: true });
    const t5 = performance.now();
    for (const r of exportSet) writeFileSync(`${args.svgDir}/hal-${r.id}.svg`, renderProfileSvg(r, surface, opts), "utf8");
    console.log(`
${exportSet.length} profilbilder skrivna till ${args.svgDir} på ${(performance.now() - t5).toFixed(0)} ms`);
  }
  if (args.dxf) {
    const d = dirname(args.dxf);
    if (d && !existsSync(d)) mkdirSync(d, { recursive: true });
    writeFileSync(args.dxf, toDxf(exportSet, { startDepth: opts.startDepth }), "utf8");
    console.log(`DXF med ${exportSet.length} hål skriven: ${args.dxf}`);
  }

  const dir = dirname(args.out);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(args.out, "﻿" + toCsv(results), "utf8");
  console.log(`\nCSV skriven: ${args.out}`);
}

main();
