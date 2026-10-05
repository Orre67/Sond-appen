import * as geomagnetismNs from "geomagnetism";

type GeomagnetismApi = Pick<typeof geomagnetismNs, "model">;
/** CommonJS-paketet syns som namngivna exporter i Vite och vitest men som default i tsx. */
const geomagnetism: GeomagnetismApi =
  typeof (geomagnetismNs as Partial<GeomagnetismApi>).model === "function"
    ? geomagnetismNs
    : (geomagnetismNs as unknown as { default: GeomagnetismApi }).default;

/**
 * Geodesi för bäringskorrektionen: SWEREF 99 TM till latitud/longitud (Gauss-Krüger på GRS80,
 * Lantmäteriets serier), meridiankonvergens och magnetisk missvisning ur WMM2025.
 *
 * Rutnätsbäring = magnetisk bäring + missvisning − meridiankonvergens.
 * Missvisningen är positiv när magnetisk nord ligger öster om sann nord. Konvergensen är positiv
 * när rutnätsnord ligger öster om sann nord, vilket gäller öster om mittmeridianen.
 */

/** Projektionsparametrar för en SWEREF 99-zon. */
export interface TmZone {
  name: string;
  /** Mittmeridian i grader. */
  lon0: number;
  falseEasting: number;
  k0: number;
}

export const SWEREF99_TM: TmZone = { name: "SWEREF 99 TM", lon0: 15, falseEasting: 500000, k0: 0.9996 };

const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const E1 = Math.sqrt(E2);
const N = F / (2 - F);
const A_HAT = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
/** Framåt: ξ η ur ξ' η'. */
const ALPHA = [
  0,
  N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180,
  (13 * N ** 2) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440,
  (61 * N ** 3) / 240 - (103 * N ** 4) / 140,
  (49561 * N ** 4) / 161280,
];
/** Bakåt: ξ' η' ur ξ η. */
const BETA = [
  0,
  N / 2 - (2 * N ** 2) / 3 + (37 * N ** 3) / 96 - N ** 4 / 360,
  N ** 2 / 48 + N ** 3 / 15 - (437 * N ** 4) / 1440,
  (17 * N ** 3) / 480 - (37 * N ** 4) / 840,
  (4397 * N ** 4) / 161280,
];
/** Bakåt: geodetisk latitud ur konform latitud. */
const DELTA = [
  0,
  2 * N - (2 * N ** 2) / 3 - 2 * N ** 3 + (116 * N ** 4) / 45,
  (7 * N ** 2) / 3 - (8 * N ** 3) / 5 - (227 * N ** 4) / 45,
  (56 * N ** 3) / 15 - (136 * N ** 4) / 35,
  (4279 * N ** 4) / 630,
];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Grov igenkänning av SWEREF 99 TM på värdena, som i startpunktstolken. */
export function looksLikeSwerefTm(e: number, n: number): boolean {
  return e >= 250000 && e <= 950000 && n >= 6100000 && n <= 7700000;
}

/** E N i en zon till latitud och longitud i grader. */
export function tmToLatLon(e: number, n: number, zone: TmZone = SWEREF99_TM): { lat: number; lon: number } {
  const xi = n / (zone.k0 * A_HAT);
  const eta = (e - zone.falseEasting) / (zone.k0 * A_HAT);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 4; j++) {
    xiP -= BETA[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const phiStar = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = phiStar;
  for (let j = 1; j <= 4; j++) phi += DELTA[j] * Math.sin(2 * j * phiStar);
  const dLon = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: toDeg(phi), lon: zone.lon0 + toDeg(dLon) };
}

/** Latitud och longitud i grader till E N i en zon. */
export function latLonToTm(lat: number, lon: number, zone: TmZone = SWEREF99_TM): { e: number; n: number } {
  const phi = toRad(lat);
  const dLon = toRad(lon - zone.lon0);
  // Konform latitud, exakt.
  const phiStar = Math.atan(Math.sinh(Math.asinh(Math.tan(phi)) - E1 * Math.atanh(E1 * Math.sin(phi))));
  const xiP = Math.atan2(Math.tan(phiStar), Math.cos(dLon));
  const etaP = Math.atanh(Math.cos(phiStar) * Math.sin(dLon));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 4; j++) {
    xi += ALPHA[j] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  return { e: zone.k0 * A_HAT * eta + zone.falseEasting, n: zone.k0 * A_HAT * xi };
}

/** Meridiankonvergens i grader: vinkeln från sann nord till rutnätsnord, positiv öster om mittmeridianen. */
export function gridConvergence(lat: number, lon: number, lon0: number = SWEREF99_TM.lon0): number {
  return toDeg(Math.atan(Math.sin(toRad(lat)) * Math.tan(toRad(lon - lon0))));
}

export interface DeclinationResult {
  /** Grader, positiv öster om sann nord. */
  declination: number;
  /** Modellens namn, t.ex. WMM-2025. */
  model: string;
}

/** Magnetisk missvisning ur WMM för en plats och ett datum. Utanför modellens giltighet används närmaste modell. */
export function magneticDeclination(lat: number, lon: number, date: Date): DeclinationResult {
  const model = geomagnetism.model(date, { allowOutOfBoundsModel: true });
  const p = model.point([lat, lon, 0]);
  return { declination: p.decl, model: model.name };
}

export interface AutoBearingCorrection {
  lat: number;
  lon: number;
  zone: string;
  date: Date;
  declination: number;
  convergence: number;
  model: string;
  /** Det som läggs på sondens magnetiska bäring: missvisning − konvergens. */
  correction: number;
}

/**
 * Automatisk bäringskorrektion ur en plats i SWEREF 99 TM och ett datum.
 * null om koordinaterna inte ser ut som SWEREF 99 TM (lokalt system eller annan zon).
 */
export function autoBearingCorrection(e: number, n: number, date: Date): AutoBearingCorrection | null {
  if (!looksLikeSwerefTm(e, n)) return null;
  const { lat, lon } = tmToLatLon(e, n);
  const convergence = gridConvergence(lat, lon);
  const d = magneticDeclination(lat, lon, date);
  return { lat, lon, zone: SWEREF99_TM.name, date, declination: d.declination, convergence, model: d.model, correction: d.declination - convergence };
}

const signed = (v: number, decimals: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(decimals).replace(".", ",")}`;

/** Korrektionen i klartext, t.ex. "missvisning +6,7° (WMM-2025, 2026-10-01) − konvergens +0,8° (SWEREF 99 TM) = +5,9°". */
export function describeCorrection(c: AutoBearingCorrection): string {
  const p = (v: number) => String(v).padStart(2, "0");
  const date = `${c.date.getFullYear()}-${p(c.date.getMonth() + 1)}-${p(c.date.getDate())}`;
  return `missvisning ${signed(c.declination, 1)}° (${c.model}, ${date}) − konvergens ${signed(c.convergence, 1)}° (${c.zone}) = ${signed(c.correction, 1)}°`;
}
