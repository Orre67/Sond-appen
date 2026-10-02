import { normalizeId, type StartPoint } from "../io/startpoints";

/**
 * Omnumrering av startpunkter när numreringen i filen inte stämmer med sonderingsfilen.
 * Nyckel är id i filen, värde är det nya id:t eller null för "utan nummer". Punkter som
 * saknas i kartan behåller sitt id.
 */
export type Renames = Map<string, string | null>;

export interface NamedPoint extends StartPoint {
  /** Id i filen, före omnumrering. */
  sourceId: string;
}

export interface Applied {
  /** Punkter med nummer, i filens ordning, med det gällande id:t i id. */
  numbered: NamedPoint[];
  /** Punkter utan nummer, i filens ordning. */
  unnumbered: NamedPoint[];
}

export function applyRenames(points: StartPoint[], renames: Renames): Applied {
  const numbered: NamedPoint[] = [];
  const unnumbered: NamedPoint[] = [];
  for (const p of points) {
    const r = renames.has(p.id) ? renames.get(p.id)! : p.id;
    const np: NamedPoint = { ...p, sourceId: p.id, id: r ?? p.id };
    if (r === null) unnumbered.push(np);
    else numbered.push(np);
  }
  return { numbered, unnumbered };
}

/** Lägsta lediga nummer från och med `from`. Punkten som ska få numret räknas inte som upptagen. */
export function nextFree(from: number, numbered: NamedPoint[], exceptSourceId?: string): number {
  const taken = new Set(numbered.filter((p) => p.sourceId !== exceptSourceId).map((p) => normalizeId(p.id)));
  let n = Math.max(0, Math.round(from));
  while (taken.has(String(n))) n++;
  return n;
}

/** Ger punkten numret `from`, eller närmast lediga därefter, och returnerar det nummer som användes. */
export function assignNumber(renames: Renames, points: StartPoint[], sourceId: string, from: number): number {
  const n = nextFree(from, applyRenames(points, renames).numbered, sourceId);
  renames.set(sourceId, String(n));
  return n;
}

/** Högsta rent numeriska id bland numrerade punkter, 0 om inget finns. */
export function highestNumber(numbered: NamedPoint[]): number {
  let max = 0;
  for (const p of numbered) {
    if (/^\d+$/.test(p.id.trim())) max = Math.max(max, Number(p.id));
  }
  return max;
}

/**
 * Numrerar punkter utan nummer i filens ordning, från högsta befintliga nummer plus ett.
 * Upptagna nummer hoppas över. Returnerar antalet punkter som fick nummer.
 */
export function numberUnnumbered(renames: Renames, points: StartPoint[]): number {
  let next = highestNumber(applyRenames(points, renames).numbered) + 1;
  let count = 0;
  for (const p of points) {
    if (renames.get(p.id) !== null) continue;
    next = assignNumber(renames, points, p.id, next) + 1;
    count++;
  }
  return count;
}

/** Tar bort alla nummer så att numreringen kan göras om från början. */
export function clearNumbers(renames: Renames, points: StartPoint[]): void {
  for (const p of points) renames.set(p.id, null);
}
