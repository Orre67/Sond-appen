import type { BurdenClass, BurdenOptions, HoleResult } from "../geom/burden";
import type { ProfileStyle } from "../view/profile";

/**
 * Ett delningspaket: hålens beräknade resultat och ytans snitt längs varje hål, så att telefonen
 * kan rita snittet i sin egen skärmstorlek utan modell och utan beräkning. Vyn framifrån följer
 * med färdigritad eftersom den kräver 3D-modellen.
 */
export interface ShareBundle {
  version: 2;
  name: string;
  created: string;
  opts: BurdenOptions;
  /** Ritval från skrivbordet som telefonen följer. */
  style: Pick<ProfileStyle, "showSkipped" | "showTrace" | "showSticks" | "mergeLabelsWithin">;
  /** Färgregeln i klartext, t.ex. "Rött < 1,5 m, blått > 3,5 m, från 1,0 m djup". */
  rule: string;
  holes: ShareHole[];
}

export interface ShareHole {
  id: string;
  minBurden: number | null;
  minBurdenDepth: number | null;
  cls: BurdenClass;
  /** Längd, bäring och lutning i klartext. */
  info: string;
  result: HoleResult;
  /** Ytans snitt längs hålets bäring, [s0, z0, s1, z1, ...], med marginal runt det bilden behöver. */
  section: number[];
  /** Väggen framifrån, stående format, med bild om den kunde renderas. */
  frontSvg: string | null;
}

export interface ShareResponse {
  id: string;
  /** Adresser där paketet kan öppnas, en per nätverkskort. */
  urls: string[];
}

/** Koordinater och mått avrundas till 0,1 mm så att paketet blir mindre. */
function compactNumbers(_key: string, value: unknown): unknown {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value;
}

export async function uploadShare(bundle: ShareBundle): Promise<ShareResponse> {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bundle, compactNumbers),
  });
  if (!res.ok) throw new Error(`Delningen misslyckades: ${res.status} ${await res.text()}`);
  return (await res.json()) as ShareResponse;
}

export async function fetchShare(id: string): Promise<ShareBundle> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(res.status === 404 ? "Paketet finns inte längre." : `Kunde inte hämta paketet: ${res.status}`);
  const data = (await res.json()) as Partial<ShareBundle>;
  if (!Array.isArray(data.holes)) throw new Error("Svaret från servern var inget profilpaket.");
  if (data.version !== 2) throw new Error("Paketet kommer från en äldre version av appen. Dela profilerna igen från datorn.");
  return data as ShareBundle;
}
