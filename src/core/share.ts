import type { BurdenClass, BurdenOptions, HoleResult } from "../geom/burden";
import type { ProfileStyle } from "../view/profile";
import type { CatalogEntry } from "./catalog";

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

function newShareId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Skickar paketet dit telefonen kan hämta det. Under utveckling tar Vites dev-server emot det
 * (vite.config.ts). I produktion går det direkt från webbläsaren till Vercel Blob, efter ett
 * nyckelutbyte med /api/share/upload där delningsnyckeln kontrolleras.
 */
export async function uploadShare(bundle: ShareBundle, getKey: () => Promise<string | null>): Promise<ShareResponse> {
  const body = JSON.stringify(bundle, compactNumbers);
  if (import.meta.env.DEV) {
    const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body });
    if (!res.ok) throw new Error(`Delningen misslyckades: ${res.status} ${await res.text()}`);
    return (await res.json()) as ShareResponse;
  }
  const key = await getKey();
  if (!key) throw new Error("Ingen delningsnyckel angiven.");
  const id = newShareId();
  const { upload } = await import("@vercel/blob/client");
  await upload(`share/${id}.json`, new Blob([body], { type: "application/json" }), {
    access: "public",
    handleUploadUrl: "/api/share/upload",
    contentType: "application/json",
    clientPayload: JSON.stringify({ key }),
    multipart: body.length > 20_000_000,
  });
  return { id, urls: [`${location.origin}/m/${id}`] };
}

async function postPublish(body: unknown): Promise<void> {
  const res = await fetch("/api/m/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Publiceringen misslyckades: ${res.status}`);
  }
}

/** Lägger inmätningen i listan telefonerna väljer från. Samma plats och datum ersätter en tidigare publicering. */
export async function publishEntry(entry: Omit<CatalogEntry, "published">, getKey: () => Promise<string | null>): Promise<void> {
  const key = import.meta.env.DEV ? "dev" : await getKey();
  if (!key) throw new Error("Ingen delningsnyckel angiven.");
  await postPublish({ key, entry });
}

/** Tar bort inmätningen ur listan och raderar paketet. */
export async function unpublishEntry(id: string, getKey: () => Promise<string | null>): Promise<void> {
  const key = import.meta.env.DEV ? "dev" : await getKey();
  if (!key) throw new Error("Ingen delningsnyckel angiven.");
  await postPublish({ key, remove: id });
}

export async function fetchShare(id: string): Promise<ShareBundle> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(res.status === 404 ? "Paketet finns inte längre." : `Kunde inte hämta paketet: ${res.status}`);
  const data = (await res.json()) as Partial<ShareBundle>;
  if (!Array.isArray(data.holes)) throw new Error("Svaret från servern var inget profilpaket.");
  if (data.version !== 2) throw new Error("Paketet kommer från en äldre version av appen. Dela profilerna igen från datorn.");
  return data as ShareBundle;
}
