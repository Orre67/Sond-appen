import type { HoleInput } from "../geom/hole";
import type { Surface } from "../geom/surface";
import { fmt } from "../view/format";

export interface CollarCheckLimits {
  /** Påhugg längre från ytan än så här nämns med sitt avstånd, meter. */
  far: number;
  /** Är minst hälften av påhuggen längre bort än så här är något fel med filerna, meter. */
  lost: number;
  /** Högsta antal hål som räknas upp var för sig. */
  listMax: number;
}

export const DEFAULT_COLLAR_LIMITS: CollarCheckLimits = { far: 1.0, lost: 10, listMax: 10 };

/**
 * Påhuggen ska ligga på ytmodellen. Stora avstånd tyder på fel koordinatsystem, fel kolumnordning
 * i startpunktsfilen eller fel filer, och det ser ingen filtolkning. Returnerar varningstexter.
 */
export function checkCollars(surface: Surface, holes: HoleInput[], limits: CollarCheckLimits = DEFAULT_COLLAR_LIMITS): string[] {
  const far: { id: string; distance: number }[] = [];
  for (const h of holes) {
    const hit = surface.closestPoint(h.collar);
    const distance = hit ? hit.distance : Infinity;
    if (distance > limits.far) far.push({ id: h.id, distance });
  }
  if (far.length === 0) return [];
  const out: string[] = [];
  const lost = far.filter((f) => f.distance > limits.lost).length;
  if (lost > 0 && lost >= holes.length / 2) {
    out.push(
      `${lost} av ${holes.length} påhugg ligger mer än ${fmt(limits.lost, 0)} m från ytmodellen. Kontrollera koordinatsystem, kolumnordning i startpunktsfilen och att rätt filer är inlästa.`,
    );
  }
  for (const f of far.slice(0, limits.listMax)) {
    out.push(`Hål ${f.id}: påhugget ligger ${Number.isFinite(f.distance) ? `${fmt(f.distance, 1)} m` : "långt"} från ytmodellen.`);
  }
  if (far.length > limits.listMax) out.push(`… och ${far.length - limits.listMax} påhugg till utanför ytmodellen.`);
  return out;
}
