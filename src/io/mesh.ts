/** Gemensam form för en inläst ytmodell, oavsett filformat. */
export interface MeshData {
  /** Hörnpunkter i float64, E N Z (x = öst, y = norr, z = höjd). */
  positions: Float64Array;
  /** Tre hörnindex per triangel. */
  indices: Uint32Array;
  /** Texturkoordinater (u, v) om de finns, annars undefined. */
  uvs?: Float32Array;
  /** Index i uvs per triangelhörn, parallellt med indices, -1 om saknas. */
  uvIndices?: Int32Array;
  /** Namn på texturfil enligt MTL, om känt. */
  textureFile?: string;
  name?: string;
  crsName?: string;
  epsg?: string;
  source: "landxml" | "obj";
  warnings: string[];
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function meshBounds(m: MeshData): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}
