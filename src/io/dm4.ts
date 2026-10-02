/**
 * Inläsning av DM4-filer från sonderingsinstrumentet.
 *
 *   Profile Number  ,20
 *   Depth in metres?,13.3
 *   Incrm in metres?,2.0
 *   Sonde Data Point,<djup>,<bäring>,<lutning från lod>,0,0
 */
export interface SondeStation {
  depth: number;
  bearing: number;
  inclination: number;
}

export interface SondeProfile {
  id: string;
  totalDepth?: number;
  increment?: number;
  stations: SondeStation[];
  source?: string;
}

export interface Dm4Parse {
  profiles: SondeProfile[];
  warnings: string[];
}

export function parseDm4(text: string, source?: string): Dm4Parse {
  const warnings: string[] = [];
  const profiles: SondeProfile[] = [];
  let cur: SondeProfile | null = null;
  const where = source ? `${source}: ` : "";

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(",").map((s) => s.trim());
    const key = parts[0].toLowerCase();
    if (key.startsWith("profile number")) {
      cur = { id: parts[1] && parts[1].length > 0 ? parts[1] : `okänd-${profiles.length + 1}`, stations: [], source };
      profiles.push(cur);
    } else if (key.startsWith("depth in metres")) {
      if (cur) cur.totalDepth = Number(parts[1]);
    } else if (key.startsWith("incrm in metres")) {
      if (cur) cur.increment = Number(parts[1]);
    } else if (key.startsWith("sonde data point")) {
      if (!cur) {
        warnings.push(`${where}rad ${i + 1}: mätpunkt före första "Profile Number", hoppas över.`);
        return;
      }
      const depth = Number(parts[1]);
      const bearing = Number(parts[2]);
      const inclination = Number(parts[3]);
      if (![depth, bearing, inclination].every(Number.isFinite)) {
        warnings.push(`${where}rad ${i + 1}: kunde inte tolka mätpunkten "${line}".`);
        return;
      }
      const normBearing = bearing >= 0 && bearing < 360 ? bearing : ((bearing % 360) + 360) % 360;
      cur.stations.push({ depth, bearing: normBearing, inclination });
    }
  });

  for (const p of profiles) {
    p.stations.sort((a, b) => a.depth - b.depth);
    const dedup: SondeStation[] = [];
    for (const s of p.stations) {
      const last = dedup[dedup.length - 1];
      if (last && Math.abs(last.depth - s.depth) < 1e-9) {
        warnings.push(`${where}hål ${p.id}: dubbel mätpunkt på djup ${s.depth} m, den sista används.`);
        dedup[dedup.length - 1] = s;
      } else dedup.push(s);
    }
    p.stations = dedup;
    if (p.stations.length < 2) {
      warnings.push(`${where}hål ${p.id}: färre än två mätpunkter, hålet kan inte byggas.`);
    }
    if (p.totalDepth !== undefined && Number.isFinite(p.totalDepth) && p.stations.length > 0) {
      const last = p.stations[p.stations.length - 1].depth;
      if (Math.abs(last - p.totalDepth) > 0.05) {
        warnings.push(`${where}hål ${p.id}: angivet djup ${p.totalDepth} m men sista mätpunkt på ${last} m.`);
      }
    }
  }
  return { profiles, warnings };
}
