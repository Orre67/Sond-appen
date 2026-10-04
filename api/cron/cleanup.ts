import { del, list } from "@vercel/blob";
import { readRegister, writeRegister } from "../../src/server/blob.js";

const KEEP_DAYS = 30;

/**
 * Daglig rensning (vercel.json): tar bort delningspaket äldre än KEEP_DAYS dagar så att
 * lagringen på gratisnivån inte fylls, och plockar bort dem ur registret. Vercel anropar
 * med Authorization: Bearer CRON_SECRET.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const old: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "share/", cursor, limit: 1000 });
    for (const b of page.blobs) if (b.uploadedAt.getTime() < cutoff) old.push(b.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (old.length > 0) await del(old);

  const deletedIds = new Set(old.map((u) => /share\/([a-z0-9]+)\.json$/i.exec(u)?.[1]?.toLowerCase()).filter((x): x is string => !!x));
  let pruned = 0;
  if (deletedIds.size > 0) {
    const catalog = await readRegister();
    const entries = catalog.entries.filter((e) => !deletedIds.has(e.id));
    pruned = catalog.entries.length - entries.length;
    if (pruned > 0) await writeRegister({ version: 1, entries });
  }
  return Response.json({ deleted: old.length, pruned, keepDays: KEEP_DAYS });
}
