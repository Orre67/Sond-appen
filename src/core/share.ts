import type { BurdenClass, BurdenOptions } from "../geom/burden";
import type { HoverSample } from "../view/profile";

/** Ett delningspaket: färdigritade profiler för visning på telefon, utan modell och utan beräkning. */
export interface ShareBundle {
  version: 1;
  name: string;
  created: string;
  opts: Pick<BurdenOptions, "interval" | "mode" | "minBurden" | "maxBurden" | "startDepth">;
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
  /** Snittet, stående format, utan vyn framifrån. */
  sectionSvg: string;
  sectionSamples: HoverSample[];
  /** Väggen framifrån, stående format, med bild om den kunde renderas. */
  frontSvg: string | null;
}

export interface ShareResponse {
  id: string;
  /** Adresser där paketet kan öppnas, en per nätverkskort. */
  urls: string[];
}

export async function uploadShare(bundle: ShareBundle): Promise<ShareResponse> {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bundle),
  });
  if (!res.ok) throw new Error(`Delningen misslyckades: ${res.status} ${await res.text()}`);
  return (await res.json()) as ShareResponse;
}

export async function fetchShare(id: string): Promise<ShareBundle> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(res.status === 404 ? "Paketet finns inte längre." : `Kunde inte hämta paketet: ${res.status}`);
  return (await res.json()) as ShareBundle;
}
