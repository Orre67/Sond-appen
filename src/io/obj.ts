import type { MeshData } from "./mesh";

/**
 * Inläsning av Wavefront OBJ. Koordinaterna antas vara E N Z direkt i filen,
 * så som Agisoft Metashape exporterar georefererade modeller.
 * Texturkoordinater och materialreferens sparas för 3D-vyn men används inte i beräkningen.
 */
export function parseObj(text: string): MeshData {
  const warnings: string[] = [];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const uvIndices: number[] = [];
  let mtllib: string | undefined;
  let polygons = 0;
  let badFaces = 0;

  const cornerCache: number[] = [];
  const cornerUv: number[] = [];

  let lineStart = 0;
  const n = text.length;
  while (lineStart < n) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = n;
    let line = text.slice(lineStart, lineEnd);
    lineStart = lineEnd + 1;
    if (line.length === 0) continue;
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    const c0 = line.charCodeAt(0);

    if (c0 === 118 /* v */) {
      const c1 = line.charCodeAt(1);
      if (c1 === 32) {
        const p = line.trim().split(/\s+/);
        positions.push(Number(p[1]), Number(p[2]), Number(p[3]));
      } else if (c1 === 116 /* t */) {
        const p = line.trim().split(/\s+/);
        uvs.push(Number(p[1]), Number(p[2]));
      }
    } else if (c0 === 102 /* f */ && line.charCodeAt(1) === 32) {
      const p = line.trim().split(/\s+/);
      cornerCache.length = 0;
      cornerUv.length = 0;
      const vCount = positions.length / 3;
      const vtCount = uvs.length / 2;
      let ok = true;
      for (let i = 1; i < p.length; i++) {
        const tok = p[i];
        const slash = tok.indexOf("/");
        let vi: number;
        let ti = -1;
        if (slash < 0) vi = Number(tok);
        else {
          vi = Number(tok.slice(0, slash));
          const rest = tok.slice(slash + 1);
          const slash2 = rest.indexOf("/");
          const tStr = slash2 < 0 ? rest : rest.slice(0, slash2);
          if (tStr.length > 0) {
            ti = Number(tStr);
            ti = ti < 0 ? vtCount + ti : ti - 1;
          }
        }
        vi = vi < 0 ? vCount + vi : vi - 1;
        if (!Number.isInteger(vi) || vi < 0 || vi >= vCount) {
          ok = false;
          break;
        }
        cornerCache.push(vi);
        cornerUv.push(ti);
      }
      if (!ok || cornerCache.length < 3) {
        badFaces++;
        continue;
      }
      if (cornerCache.length > 3) polygons++;
      for (let i = 1; i + 1 < cornerCache.length; i++) {
        indices.push(cornerCache[0], cornerCache[i], cornerCache[i + 1]);
        uvIndices.push(cornerUv[0], cornerUv[i], cornerUv[i + 1]);
      }
    } else if (line.startsWith("mtllib ")) {
      mtllib = line.slice(7).trim();
    }
  }

  if (positions.length === 0) throw new Error("OBJ-filen innehåller inga punkter (v).");
  if (indices.length === 0) throw new Error("OBJ-filen innehåller inga trianglar (f).");
  if (polygons > 0) warnings.push(`${polygons} ytor med fler än tre hörn delades upp i trianglar.`);
  if (badFaces > 0) warnings.push(`${badFaces} ytor med ogiltiga referenser hoppades över.`);
  const hasUv = uvs.length > 0 && uvIndices.some((i) => i >= 0);

  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
    uvs: hasUv ? Float32Array.from(uvs) : undefined,
    uvIndices: hasUv ? Int32Array.from(uvIndices) : undefined,
    textureFile: undefined,
    name: mtllib ? mtllib.replace(/\.mtl$/i, "") : undefined,
    source: "obj",
    warnings,
  };
}

/** Läser en MTL-fil och returnerar texturfil per material (map_Kd). */
export function parseMtl(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) cur = line.slice(7).trim();
    else if (cur && /^map_Kd\s+/i.test(line)) out[cur] = line.replace(/^map_Kd\s+/i, "").trim();
  }
  return out;
}
