import type { MeshData } from "./mesh";

/**
 * Inläsning av LandXML-ytor (TIN). Punkter i LandXML står i ordningen N E Z,
 * här vänds de till E N Z. Parsning sker med reguljära uttryck i stället för
 * DOM så att filer på 50 till 100 MB går att läsa utan att minnet tar slut.
 */
export function parseLandXml(text: string): MeshData {
  const warnings: string[] = [];

  // Enheter
  let factor = 1;
  const unitMatch = /<(Metric|Imperial)\b[^>]*linearUnit="([^"]+)"/i.exec(text);
  if (unitMatch) {
    const unit = unitMatch[2].toLowerCase();
    if (unit === "foot" || unit === "feet") factor = 0.3048;
    else if (unit === "ussurveyfoot") factor = 1200 / 3937;
    else if (unit !== "meter" && unit !== "metre") warnings.push(`Okänd längdenhet "${unitMatch[2]}", antar meter.`);
    if (factor !== 1) warnings.push(`Filen är i ${unitMatch[2]}, koordinaterna har räknats om till meter.`);
  }

  const crs = /<CoordinateSystem\b([^>]*)>/i.exec(text);
  let crsName: string | undefined;
  let epsg: string | undefined;
  if (crs) {
    crsName = /\bname="([^"]*)"/.exec(crs[1])?.[1];
    epsg = /\bepsgCode="([^"]*)"/.exec(crs[1])?.[1];
  }

  // Hitta alla <Surface>-block och välj det med flest trianglar.
  const surfaces: { name: string; start: number; end: number }[] = [];
  let pos = 0;
  for (;;) {
    const s = text.indexOf("<Surface", pos);
    if (s < 0) break;
    const tagEnd = text.indexOf(">", s);
    const e = text.indexOf("</Surface>", tagEnd);
    if (e < 0) break;
    const nameMatch = /\bname="([^"]*)"/.exec(text.slice(s, tagEnd + 1));
    surfaces.push({ name: nameMatch?.[1] ?? "", start: tagEnd + 1, end: e });
    pos = e + 10;
  }
  if (surfaces.length === 0) throw new Error("Hittade ingen <Surface> i LandXML-filen.");

  let best: ReturnType<typeof parseSurface> | null = null;
  let bestName = "";
  for (const s of surfaces) {
    const parsed = parseSurface(text.slice(s.start, s.end), factor, warnings);
    if (!best || parsed.indices.length > best.indices.length) {
      best = parsed;
      bestName = s.name;
    }
  }
  if (surfaces.length > 1) {
    warnings.push(`Filen innehåller ${surfaces.length} ytor, den med flest trianglar ("${bestName}") används.`);
  }
  if (!best || best.indices.length === 0) throw new Error("Ytan i LandXML-filen saknar trianglar.");

  return {
    positions: best.positions,
    indices: best.indices,
    name: bestName,
    crsName,
    epsg,
    source: "landxml",
    warnings,
  };
}

function parseSurface(block: string, factor: number, warnings: string[]) {
  const ids: number[] = [];
  const coords: number[] = [];
  const pRe = /<P\b[^>]*\bid="(\d+)"[^>]*>([^<]+)<\/P>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(block)) !== null) {
    const parts = m[2].trim().split(/\s+/);
    if (parts.length < 3) continue;
    const n = Number(parts[0]);
    const e = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(n) || !Number.isFinite(e) || !Number.isFinite(z)) continue;
    ids.push(Number(m[1]));
    coords.push(e * factor, n * factor, z * factor);
  }
  const positions = Float64Array.from(coords);

  // Översättning från punkt-id till index. Oftast är id 1..n i ordning.
  let contiguous = true;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== i + 1) {
      contiguous = false;
      break;
    }
  }
  let lookup: Map<number, number> | null = null;
  if (!contiguous) {
    lookup = new Map();
    ids.forEach((id, i) => lookup!.set(id, i));
  }
  const indexOf = (id: number): number => (contiguous ? id - 1 : (lookup!.get(id) ?? -1));

  const tri: number[] = [];
  let skippedInvisible = 0;
  let skippedBad = 0;
  const fRe = /<F\b([^>]*)>([^<]+)<\/F>/g;
  while ((m = fRe.exec(block)) !== null) {
    if (m[1] && /\bi="1"/.test(m[1])) {
      skippedInvisible++;
      continue;
    }
    const parts = m[2].trim().split(/\s+/);
    if (parts.length < 3) {
      skippedBad++;
      continue;
    }
    const a = indexOf(Number(parts[0]));
    const b = indexOf(Number(parts[1]));
    const c = indexOf(Number(parts[2]));
    if (a < 0 || b < 0 || c < 0 || a >= ids.length || b >= ids.length || c >= ids.length) {
      skippedBad++;
      continue;
    }
    tri.push(a, b, c);
  }
  if (skippedInvisible > 0) warnings.push(`${skippedInvisible} osynliga trianglar (i="1") hoppades över.`);
  if (skippedBad > 0) warnings.push(`${skippedBad} trianglar med ogiltiga punktreferenser hoppades över.`);
  return { positions, indices: Uint32Array.from(tri) };
}
