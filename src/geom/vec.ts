/** Enkla float64-vektorer i ordningen E (x), N (y), höjd (z). */
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l === 0) throw new Error("Kan inte normalisera en nollvektor");
  return [a[0] / l, a[1] / l, a[2] / l];
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const DEG = Math.PI / 180;
export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad / DEG;

/** Bäring i grader medurs från norr för en horisontell riktning (dE, dN). */
export function bearingOf(dE: number, dN: number): number {
  const b = toDeg(Math.atan2(dE, dN));
  return ((b % 360) + 360) % 360;
}

/** Höjdvinkel i grader, positiv uppåt. */
export function elevationOf(v: Vec3): number {
  return toDeg(Math.atan2(v[2], Math.hypot(v[0], v[1])));
}
