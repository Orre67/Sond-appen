import type { Vec3 } from "../geom/vec";

/**
 * Inläsning av IREDES-filer från borriggar: borrplan (DRPPlan) och kvalitetslogg (DRPQual).
 * Båda har en lista av <Hole> med start- och slutpunkt. IREDES skriver PointX = northing,
 * PointY = easting, PointZ = höjd; här vänds de till E N Z. Planen är det som skulle borras,
 * loggen är vad riggen själv registrerade som borrat. Parsning med reguljära uttryck som för
 * LandXML, så att den fungerar i webbläsare, worker och Node utan DOM.
 */

export type IredesKind = "plan" | "quality";

export interface IredesHole {
  /** Hålets namn som det används i plan, logg och sondering: HoleName, annars HoleId. */
  id: string;
  holeId: string;
  /** Sant när HoleName saknades och HoleId fick bli namn (Sandvik). */
  unnamed: boolean;
  start: Vec3;
  end: Vec3;
  /** Rak längd från start till slut, meter. */
  length: number;
  /** Borrad längd i berg enligt loggen, när den finns. */
  drilledInRock: number | null;
  diameter: number | null;
  type: string | null;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
}

export interface IredesFile {
  kind: IredesKind;
  source: string;
  planId: string | null;
  planName: string | null;
  created: string | null;
  /** Tillverkare och maskintyp ur loggens huvud, t.ex. "Epiroc SmartROC T40". */
  equipment: string | null;
  holes: IredesHole[];
  warnings: string[];
}

/** Avgör vad en XML-fil är på de första tecknen: LandXML-yta, IREDES-plan eller IREDES-kvalitetslogg. */
export function sniffXml(head: string): "landxml" | "iredes-plan" | "iredes-quality" | "unknown" {
  if (/<LandXML\b/i.test(head)) return "landxml";
  if (/<DRPPlan\b/.test(head)) return "iredes-plan";
  if (/<DRPQual\b/.test(head)) return "iredes-quality";
  return "unknown";
}

function tagText(block: string, tag: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z]+:)?${tag}\\b[^>]*>([^<]*)</(?:[A-Za-z]+:)?${tag}>`);
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function tagNumber(block: string, tag: string): number | null {
  const t = tagText(block, tag);
  if (t === null || t === "") return null;
  const v = Number(t.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** En punkt ur <StartPoint>/<EndPoint>: PointX northing, PointY easting, PointZ höjd. */
function pointIn(block: string, tag: string): Vec3 | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(block);
  if (!m) return null;
  const x = tagNumber(m[1], "PointX");
  const y = tagNumber(m[1], "PointY");
  const z = tagNumber(m[1], "PointZ");
  if (x === null || y === null || z === null) return null;
  return [y, x, z];
}

export function parseIredes(text: string, source = ""): IredesFile {
  const warnings: string[] = [];
  const head = text.slice(0, 4096);
  const sniffed = sniffXml(head);
  if (sniffed !== "iredes-plan" && sniffed !== "iredes-quality") throw new Error("Filen är varken en IREDES-borrplan (DRPPlan) eller kvalitetslogg (DRPQual).");
  const kind: IredesKind = sniffed === "iredes-plan" ? "plan" : "quality";

  const manufacturer = tagText(head, "EqpManufact");
  const type = tagText(head, "EqpType");
  const equipment = manufacturer || type ? [manufacturer, type].filter(Boolean).join(" ") : null;
  const planId = tagText(head, kind === "plan" ? "PlanId" : "PlanIdRef");
  const planName = tagText(head, kind === "plan" ? "PlanName" : "PlanNameRef");
  const created = tagText(head, "FileCreateDate");

  const holes: IredesHole[] = [];
  const seen = new Map<string, number>();
  // I loggen ligger tider, borrad längd och status i <HoleQualityData> bredvid <Hole>, så hela det blocket läses per hål.
  const re = /<HoleQualityData\b/.test(text) ? /<HoleQualityData\b[^>]*>([\s\S]*?)<\/HoleQualityData>/g : /<Hole\b[^>]*>([\s\S]*?)<\/Hole>/g;
  let m: RegExpExecArray | null;
  let skipped = 0;
  while ((m = re.exec(text)) !== null) {
    const block = m[1];
    const holeId = tagText(block, "HoleId") ?? "";
    const name = tagText(block, "HoleName");
    const id = name && name.length > 0 ? name : holeId;
    const start = pointIn(block, "StartPoint");
    const end = pointIn(block, "EndPoint");
    if (!id || !start || !end) {
      skipped++;
      continue;
    }
    const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    holes.push({
      id,
      holeId,
      unnamed: !name,
      start,
      end,
      length,
      drilledInRock: tagNumber(block, "DrilledInRock"),
      diameter: tagNumber(block, "DrillBitDia"),
      type: tagText(block, "TypeOfHole"),
      startTime: tagText(block, "StartHoleTime"),
      endTime: tagText(block, "EndHoleTime"),
      status: tagText(block, "Hstatus"),
    });
  }
  if (skipped > 0) warnings.push(`${skipped} hål saknade namn eller koordinater och hoppades över.`);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (dupes.length > 0) warnings.push(`Hål som förekommer flera gånger: ${dupes.slice(0, 10).join(", ")}${dupes.length > 10 ? " …" : ""}. Det sista används.`);
  if (holes.length > 0 && holes.every((h) => h.unnamed)) warnings.push("Filen saknar hålnamn (HoleName). Hålen matchas mot plan och startpunkter på läge i stället för nummer.");
  if (holes.length === 0) warnings.push("Inga hål hittades i filen.");

  const coarse = holes.filter((h) => !(h.start[0] > 1000 && h.start[1] > 1000));
  if (holes.length > 0 && coarse.length === holes.length) warnings.push("Koordinaterna ser ut att vara lokala (små tal), inte SWEREF 99. Lägen matchar då inte ytmodellen.");

  return { kind, source, planId, planName, created, equipment, holes, warnings };
}

/** Bäring (grader medurs från norr), lutning från lodlinjen (grader) och längd för en rak linje start till slut. */
export function lineGeometry(start: Vec3, end: Vec3): { bearing: number; inclination: number; length: number } {
  const dE = end[0] - start[0];
  const dN = end[1] - start[1];
  const dZ = end[2] - start[2];
  const h = Math.hypot(dE, dN);
  let bearing = (Math.atan2(dE, dN) * 180) / Math.PI;
  if (bearing < 0) bearing += 360;
  const inclination = (Math.atan2(h, -dZ) * 180) / Math.PI;
  return { bearing: h > 1e-6 ? bearing : 0, inclination, length: Math.hypot(h, dZ) };
}
