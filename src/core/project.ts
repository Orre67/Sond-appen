import type { HoleInput } from "../geom/hole";
import type { SondeProfile } from "../io/dm4";
import type { IredesFile, IredesHole } from "../io/iredes";
import { normalizeId, type StartPoint } from "../io/startpoints";

export interface LinkResult {
  holes: HoleInput[];
  /** Startpunkter utan sonderingsdata. */
  unmatchedPoints: StartPoint[];
  /** Sonderingsprofiler utan startpunkt. */
  unmatchedProfiles: SondeProfile[];
  warnings: string[];
}

/** Kopplar startpunkter till sonderingsprofiler via hål-ID (Profile Number). */
export function linkHoles(points: StartPoint[], profiles: SondeProfile[]): LinkResult {
  const warnings: string[] = [];
  const byId = new Map<string, SondeProfile>();
  for (const p of profiles) {
    const k = normalizeId(p.id);
    const prev = byId.get(k);
    if (prev) {
      warnings.push(
        `Hål ${p.id} finns i flera sonderingsfiler (${prev.source ?? "?"} och ${p.source ?? "?"}), den senare används.`,
      );
    }
    byId.set(k, p);
  }
  const used = new Set<string>();
  const holes: HoleInput[] = [];
  const unmatchedPoints: StartPoint[] = [];
  for (const pt of points) {
    const k = normalizeId(pt.id);
    const prof = byId.get(k);
    if (!prof || prof.stations.length < 2) {
      unmatchedPoints.push(pt);
      continue;
    }
    used.add(k);
    holes.push({ id: pt.id, collar: [pt.e, pt.n, pt.z], stations: prof.stations });
  }
  const unmatchedProfiles = [...byId.entries()].filter(([k]) => !used.has(k)).map(([, p]) => p);
  return { holes, unmatchedPoints, unmatchedProfiles, warnings };
}

/** Riggens uppgifter om ett hål: planen (vad som skulle borras) och loggen (vad riggen registrerade som borrat). */
export interface RigReference {
  plan?: IredesHole;
  quality?: IredesHole;
}

/** Hur nära (vågrätt, meter) en logg utan hålnamn måste ligga en plan- eller startpunkt för att få dess namn. */
export const RIG_MATCH_DISTANCE = 1.0;

/**
 * Plan och logg per hålnamn, normaliserat som sonderingens Profile Number. Senare fil med samma
 * hål vinner. Loggar utan hålnamn (Sandvik) får namnet från närmaste planhål eller startpunkt
 * inom RIG_MATCH_DISTANCE, annars behåller de sitt HoleId och kan inte kopplas till sondering.
 */
export function rigReferences(files: IredesFile[], points: StartPoint[]): Map<string, RigReference> {
  const refs = new Map<string, RigReference>();
  const at = (key: string): RigReference => {
    let r = refs.get(key);
    if (!r) {
      r = {};
      refs.set(key, r);
    }
    return r;
  };
  for (const f of files) {
    if (f.kind !== "plan") continue;
    for (const h of f.holes) at(normalizeId(h.id)).plan = h;
  }
  // Kandidater med namn och läge, för loggar utan namn.
  const named: { key: string; name: string; e: number; n: number }[] = [];
  for (const [key, r] of refs) if (r.plan) named.push({ key, name: r.plan.id, e: r.plan.start[0], n: r.plan.start[1] });
  for (const p of points) named.push({ key: normalizeId(p.id), name: p.id, e: p.e, n: p.n });
  for (const f of files) {
    if (f.kind !== "quality") continue;
    for (const h of f.holes) {
      let hole = h;
      if (h.unnamed) {
        let best: { key: string; name: string; d: number } | null = null;
        for (const c of named) {
          const d = Math.hypot(c.e - h.start[0], c.n - h.start[1]);
          if (d <= RIG_MATCH_DISTANCE && (!best || d < best.d)) best = { key: c.key, name: c.name, d };
        }
        // Loggen får hålets namn; HoleId behålls så att ursprunget syns.
        if (best) hole = { ...h, id: best.name, unnamed: false };
      }
      at(normalizeId(hole.id)).quality = hole;
    }
  }
  return refs;
}

/**
 * Startpunkter från riggen för hål som saknas i startpunktsfilen, så att sonderingar kan kopplas
 * och hålen visas utan egen startpunktsfil. Loggens start går före planens.
 */
export function rigStartPoints(refs: Map<string, RigReference>, points: StartPoint[]): StartPoint[] {
  const have = new Set(points.map((p) => normalizeId(p.id)));
  const out: StartPoint[] = [];
  for (const [key, r] of refs) {
    if (have.has(key)) continue;
    const h = r.quality ?? r.plan;
    if (!h) continue;
    out.push({ id: h.id, e: h.start[0], n: h.start[1], z: h.start[2], line: 0 });
  }
  return out;
}
