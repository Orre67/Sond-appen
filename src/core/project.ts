import type { HoleInput } from "../geom/hole";
import type { SondeProfile } from "../io/dm4";
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
