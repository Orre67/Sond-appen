import { del, get, list, put } from "@vercel/blob";
import { emptyCatalog, type Catalog } from "../core/catalog.js";

/** Publika blobbar nås på https://<lagrings-id>.public.blob.vercel-storage.com/<sökväg>. Id:t står i skrivnyckeln. */
export function publicBase(): string {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? "");
  if (!m) throw new Error("BLOB_READ_WRITE_TOKEN saknas eller har okänt format.");
  return `https://${m[1].toLowerCase()}.public.blob.vercel-storage.com`;
}

export const bundlePath = (id: string) => `share/${id.toLowerCase()}.json`;
export const bundleUrl = (id: string) => `${publicBase()}/${bundlePath(id)}`;

/**
 * Registret ligger under en hemlig sökväg, så att bara funktionerna läser det, efter inloggning.
 * Varje skrivning blir en ny, oföränderlig fil: överskrivning av samma sökväg visade sig ge
 * gamla läsningar i flera sekunder, medan nya sökvägar syns direkt i både list() och get().
 */
function versionsPrefix(): string {
  const secret = process.env.REGISTER_SECRET;
  if (!secret) throw new Error("REGISTER_SECRET saknas.");
  return `register/${secret}/v/`;
}

const KEEP_VERSIONS = 3;

async function listVersions(): Promise<{ pathname: string; url: string }[]> {
  const all: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: versionsPrefix(), cursor, limit: 1000 });
    for (const b of page.blobs) all.push({ pathname: b.pathname, url: b.url });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  // Namnen börjar med en tidsstämpel av fast längd, så textordning är tidsordning
  return all.sort((a, b) => b.pathname.localeCompare(a.pathname));
}

export async function readRegister(): Promise<Catalog> {
  const versions = await listVersions();
  if (versions.length === 0) return emptyCatalog();
  const res = await get(versions[0].pathname, { access: "public", useCache: false });
  if (!res || res.statusCode !== 200) return emptyCatalog();
  const data = JSON.parse(await new Response(res.stream).text()) as Partial<Catalog>;
  // Passa på att rensa gamla versioner när de blivit många, utan extra anrop
  if (versions.length > 20) await del(versions.slice(KEEP_VERSIONS).map((v) => v.url));
  return { version: 1, entries: Array.isArray(data.entries) ? data.entries : [] };
}

export async function writeRegister(catalog: Catalog): Promise<void> {
  const name = `${versionsPrefix()}${String(Date.now()).padStart(13, "0")}-${Math.random().toString(36).slice(2, 8)}.json`;
  await put(name, JSON.stringify(catalog), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
  });
}

/** Tar bort alla registerversioner utom de senaste. Körs av den nattliga rensningen. */
export async function pruneRegisterVersions(): Promise<number> {
  const versions = await listVersions();
  const old = versions.slice(KEEP_VERSIONS);
  if (old.length > 0) await del(old.map((v) => v.url));
  return old.length;
}

export async function deleteBundle(id: string): Promise<void> {
  await del(bundleUrl(id));
}
