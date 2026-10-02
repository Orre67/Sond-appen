/**
 * Inläsning av hålens startpunkter (påhugg) från textfil eller inklistrad text.
 * Format per rad: id, E, N, Z med valfri separator (komma, semikolon, tab eller mellanslag).
 * Decimalkomma hanteras när separatorn inte är komma.
 */
export interface StartPoint {
  id: string;
  e: number;
  n: number;
  z: number;
  line: number;
}

export interface StartPointParse {
  points: StartPoint[];
  warnings: string[];
  separator: string;
  swappedEN: boolean;
}

const SEPARATORS = ["\t", ";", ",", " "] as const;

function splitLine(line: string, sep: string): string[] {
  const parts = sep === " " ? line.split(/\s+/) : line.split(sep).map((s) => s.trim());
  return parts.filter((s) => s.length > 0);
}

function toNumber(token: string, sep: string): number {
  let t = token.trim();
  if (sep !== "," && t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return NaN;
  return Number(t);
}

const looksLikeSwerefN = (v: number) => v >= 6_100_000 && v <= 7_700_000;
const looksLikeSwerefE = (v: number) => v >= 180_000 && v <= 900_000;

export function parseStartPoints(text: string): StartPointParse {
  const warnings: string[] = [];
  const lines: { text: string; no: number }[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const t = l.trim();
    if (t.length === 0 || t.startsWith("#") || t.startsWith("//")) return;
    lines.push({ text: t, no: i + 1 });
  });
  if (lines.length === 0) {
    return { points: [], warnings: ["Ingen data att läsa."], separator: ",", swappedEN: false };
  }

  // Välj den separator som ger flest rader med tre numeriska koordinater sist på raden.
  let bestSep: string = ",";
  let bestScore = -1;
  for (const sep of SEPARATORS) {
    let score = 0;
    for (const { text: l } of lines) {
      const p = splitLine(l, sep);
      if (p.length >= 3) {
        const nums = p.slice(-3).map((t) => toNumber(t, sep));
        if (nums.every((n) => Number.isFinite(n))) score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSep = sep;
    }
  }
  if (bestScore === 0) {
    return {
      points: [],
      warnings: ["Hittade inga rader med tre koordinater."],
      separator: bestSep,
      swappedEN: false,
    };
  }

  const points: StartPoint[] = [];
  let autoId = 0;
  for (const { text: l, no } of lines) {
    const p = splitLine(l, bestSep);
    if (p.length < 3) {
      warnings.push(`Rad ${no}: för få fält, hoppas över.`);
      continue;
    }
    // De tre sista numeriska fälten är E N Z, fälten före dem är id.
    const numeric: number[] = [];
    let idx = p.length;
    while (idx > 0 && numeric.length < 3) {
      const n = toNumber(p[idx - 1], bestSep);
      if (!Number.isFinite(n)) break;
      numeric.unshift(n);
      idx--;
    }
    if (numeric.length < 3) {
      if (points.length === 0) continue; // troligen en rubrikrad
      warnings.push(`Rad ${no}: kunde inte tolka koordinaterna, hoppas över.`);
      continue;
    }
    const idTokens = p.slice(0, idx);
    let id: string;
    if (idTokens.length > 0) id = idTokens.join(" ");
    else {
      autoId++;
      id = String(autoId);
      warnings.push(`Rad ${no}: saknar hål-ID, fick löpnummer ${id}.`);
    }
    points.push({ id, e: numeric[0], n: numeric[1], z: numeric[2], line: no });
  }

  // Känn igen ordningen N E Z för SWEREF 99 TM och byt till E N Z.
  let swappedEN = false;
  const nSwapped = points.filter((pt) => looksLikeSwerefN(pt.e) && looksLikeSwerefE(pt.n)).length;
  const nNormal = points.filter((pt) => looksLikeSwerefE(pt.e) && looksLikeSwerefN(pt.n)).length;
  if (points.length > 0 && nSwapped > nNormal && nSwapped === points.length) {
    for (const pt of points) {
      const e = pt.n;
      pt.n = pt.e;
      pt.e = e;
    }
    swappedEN = true;
    warnings.push("Koordinaterna såg ut att ligga i ordningen N, E, Z och har bytts till E, N, Z.");
  }

  const seen = new Map<string, number>();
  for (const pt of points) {
    const k = normalizeId(pt.id);
    const first = seen.get(k);
    if (first !== undefined) warnings.push(`Hål-ID ${pt.id} förekommer flera gånger (rad ${first} och ${pt.line}).`);
    else seen.set(k, pt.line);
  }

  return { points, warnings, separator: bestSep, swappedEN };
}

/** Gör hål-ID jämförbara: trimmar, tar bort inledande nollor och använder versaler. */
export function normalizeId(id: string): string {
  const t = id.trim().toUpperCase();
  const m = /^0*(\d+)$/.exec(t);
  return m ? m[1] : t;
}
