import { del, put } from "@vercel/blob";
import { emptyCatalog, type Catalog } from "../core/catalog";

/** Publika blobbar nås på https://<lagrings-id>.public.blob.vercel-storage.com/<sökväg>. Id:t står i skrivnyckeln. */
export function publicBase(): string {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? "");
  if (!m) throw new Error("BLOB_READ_WRITE_TOKEN saknas eller har okänt format.");
  return `https://${m[1].toLowerCase()}.public.blob.vercel-storage.com`;
}

export const bundlePath = (id: string) => `share/${id.toLowerCase()}.json`;
export const bundleUrl = (id: string) => `${publicBase()}/${bundlePath(id)}`;

/** Registret ligger under en hemlig sökväg, så att bara funktionerna läser det, efter inloggning. */
function registerPath(): string {
  const secret = process.env.REGISTER_SECRET;
  if (!secret) throw new Error("REGISTER_SECRET saknas.");
  return `register/${secret}/index.json`;
}

export async function readRegister(): Promise<Catalog> {
  const res = await fetch(`${publicBase()}/${registerPath()}?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return emptyCatalog();
  if (!res.ok) throw new Error(`Kunde inte läsa registret: ${res.status}`);
  const data = (await res.json()) as Partial<Catalog>;
  return { version: 1, entries: Array.isArray(data.entries) ? data.entries : [] };
}

export async function writeRegister(catalog: Catalog): Promise<void> {
  await put(registerPath(), JSON.stringify(catalog), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function deleteBundle(id: string): Promise<void> {
  await del(bundleUrl(id));
}
