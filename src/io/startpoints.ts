/**
 * Inläsning av hålens startpunkter (påhugg) från textfil eller inklistrad text.
 *
 * Varje rad ska innehålla hål-id och E, N, Z. Separatorn (tab, semikolon, komma eller mellanslag)
 * och decimaltecknet känns igen automatiskt. Koordinaterna hittas på sina värden, inte på sin
 * plats: tre tal i följd där två ligger i SWEREF 99 TM:s intervall, i ordningen E N Z eller N E Z.
 * Resten av raden (projekt, tider, borrdjup, punktkoder som HOLE) ignoreras. Utan SWEREF-värden
 * tas de tre sista talen på raden som E N Z, och då varnas det om raden har fler kolumner.
 */
export interface StartPoint {
  id: string;
  e: number;
  n: number;
  z: number;
  line: number;
}

/** Hur koordinaterna hittades: på värden i ordningen E N Z eller N E Z, eller som de tre sista talen. */
export type CoordinateOrder = "ENZ" | "NEZ" | "last";

export interface CoordinateColumns {
  /** Kolumnnummer (1-baserade) i filen för E, N och Z, från första lästa raden. */
  e: number;
  n: number;
  z: number;
  order: CoordinateOrder;
  /** Antal kolumner på raden. */
  total: number;
}

export interface StartPointParse {
  points: StartPoint[];
  warnings: string[];
  separator: string;
  swappedEN: boolean;
  columns: CoordinateColumns | null;
  /** Kort beskrivning för fillistan, tom för en ren id, E, N, Z-fil. */
  note: string;
}

const SEPARATORS = ["\t", ";", ",", " "] as const;

/** Delar en rad. För andra separatorer än mellanslag behålls tomma fält så att kolumnnumren stämmer. */
function splitLine(line: string, sep: string): string[] {
  if (sep === " ") return line.split(/\s+/).filter((s) => s.length > 0);
  return line.split(sep).map((s) => s.trim());
}

function toNumber(token: string, sep: string): number {
  let t = token.trim();
  if (sep !== "," && t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return NaN;
  return Number(t);
}

const looksLikeSwerefN = (v: number) => v >= 6_100_000 && v <= 7_700_000;
const looksLikeSwerefE = (v: number) => v >= 180_000 && v <= 900_000;
const plausibleZ = (v: number) => v > -1000 && v < 10000;

interface Located {
  /** Index i radens fält där koordinaterna börjar. */
  start: number;
  e: number;
  n: number;
  z: number;
  order: CoordinateOrder;
}

/** Hittar koordinaterna på en rad: först på värden (SWEREF 99 TM), annars de tre sista talen. */
function locate(tokens: string[], sep: string): Located | null {
  const nums = tokens.map((t) => toNumber(t, sep));
  for (let i = 0; i + 2 < nums.length; i++) {
    const a = nums[i];
    const b = nums[i + 1];
    const c = nums[i + 2];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !plausibleZ(c)) continue;
    if (looksLikeSwerefE(a) && looksLikeSwerefN(b)) return { start: i, e: a, n: b, z: c, order: "ENZ" };
    if (looksLikeSwerefN(a) && looksLikeSwerefE(b)) return { start: i, e: b, n: a, z: c, order: "NEZ" };
  }
  // Reserv för lokala koordinatsystem: de tre sista talen, efter eventuella punktkoder och tomma fält.
  let end = nums.length;
  while (end > 0 && !Number.isFinite(nums[end - 1])) end--;
  if (end < 3 || !Number.isFinite(nums[end - 2]) || !Number.isFinite(nums[end - 3])) return null;
  return { start: end - 3, e: nums[end - 3], n: nums[end - 2], z: nums[end - 1], order: "last" };
}

function orderText(order: CoordinateOrder): string {
  return order === "NEZ" ? "N E Z" : "E N Z";
}

export function parseStartPoints(text: string): StartPointParse {
  const warnings: string[] = [];
  const lines: { text: string; no: number }[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const t = l.trim();
    if (t.length === 0 || t.startsWith("#") || t.startsWith("//")) return;
    lines.push({ text: t, no: i + 1 });
  });
  const empty = (warning: string, separator = ","): StartPointParse => ({
    points: [],
    warnings: [warning],
    separator,
    swappedEN: false,
    columns: null,
    note: "",
  });
  if (lines.length === 0) return empty("Ingen data att läsa.");

  // Välj den separator som ger flest rader med koordinater. Rader där koordinaterna känns igen på
  // sina värden väger dubbelt, och vid lika väljs den separator som ger färre fält.
  let bestSep: string = ",";
  let bestScore = -1;
  let bestTokens = Infinity;
  for (const sep of SEPARATORS) {
    let score = 0;
    let tokens = 0;
    for (const { text: l } of lines) {
      const p = splitLine(l, sep);
      tokens += p.length;
      const loc = locate(p, sep);
      if (loc) score += loc.order === "last" ? 1 : 2;
    }
    if (score > bestScore || (score === bestScore && tokens < bestTokens)) {
      bestScore = score;
      bestSep = sep;
      bestTokens = tokens;
    }
  }
  if (bestScore === 0) return empty("Hittade inga rader med tre koordinater.", bestSep);

  const points: StartPoint[] = [];
  let columns: CoordinateColumns | null = null;
  let autoId = 0;
  const orders = new Set<CoordinateOrder>();
  let extraColumns = false;
  for (const { text: l, no } of lines) {
    const p = splitLine(l, bestSep);
    const loc = locate(p, bestSep);
    if (!loc) {
      if (points.length === 0) continue; // troligen en rubrikrad
      warnings.push(`Rad ${no}: kunde inte tolka koordinaterna, hoppas över.`);
      continue;
    }
    const before = p.slice(0, loc.start).filter((t) => t.length > 0);
    let id: string;
    if (before.length === 0) {
      autoId++;
      id = String(autoId);
      warnings.push(`Rad ${no}: saknar hål-ID, fick löpnummer ${id}.`);
    } else if (bestSep === " ") {
      // Mellanslag: allt före koordinaterna är id, t.ex. "Hål 12".
      id = before.join(" ");
    } else {
      // Första fältet är id, övriga fält före koordinaterna är annan information.
      id = before[0];
    }
    const after = p.slice(loc.start + 3).filter((t) => t.length > 0);
    if (loc.start > 1 || after.length > 0) extraColumns = true;
    orders.add(loc.order);
    if (!columns) {
      const col = (k: number) => loc.start + k + 1;
      columns =
        loc.order === "NEZ"
          ? { e: col(1), n: col(0), z: col(2), order: loc.order, total: p.length }
          : { e: col(0), n: col(1), z: col(2), order: loc.order, total: p.length };
    }
    points.push({ id, e: loc.e, n: loc.n, z: loc.z, line: no });
  }
  if (points.length === 0 || !columns) return empty("Hittade inga rader med tre koordinater.", bestSep);

  const swappedEN = orders.has("NEZ") && !orders.has("ENZ");
  if (swappedEN) warnings.push("Koordinaterna stod i ordningen N, E, Z och har bytts till E, N, Z.");
  if (orders.has("NEZ") && orders.has("ENZ")) {
    warnings.push("Ordningen på E och N varierar mellan raderna. Kontrollera filen.");
  }
  if (orders.has("last") && extraColumns) {
    warnings.push(
      "Koordinaterna ligger inte i SWEREF 99 TM och raderna har fler kolumner än id, E, N, Z. De tre sista talen på raden tolkades som E, N, Z. Kontrollera att det stämmer.",
    );
  }

  let note = "";
  if (columns.order === "last") {
    if (extraColumns) note = "de tre sista talen på raden lästa som E N Z";
  } else if (extraColumns || columns.order === "NEZ") {
    const first = Math.min(columns.e, columns.n);
    note = `koordinater i kolumn ${first}–${columns.z} i ordningen ${orderText(columns.order)}`;
    if (extraColumns) note += ", övriga kolumner ignoreras";
  }

  const seen = new Map<string, number>();
  for (const pt of points) {
    const k = normalizeId(pt.id);
    const first = seen.get(k);
    if (first !== undefined) warnings.push(`Hål-ID ${pt.id} förekommer flera gånger (rad ${first} och ${pt.line}).`);
    else seen.set(k, pt.line);
  }

  return { points, warnings, separator: bestSep, swappedEN, columns, note };
}

/** Gör hål-ID jämförbara: trimmar, tar bort inledande nollor och använder versaler. */
export function normalizeId(id: string): string {
  const t = id.trim().toUpperCase();
  const m = /^0*(\d+)$/.exec(t);
  return m ? m[1] : t;
}
