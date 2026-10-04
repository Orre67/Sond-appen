import { del, list } from "@vercel/blob";

const KEEP_DAYS = 30;

/**
 * Daglig rensning (vercel.json): tar bort delningspaket äldre än KEEP_DAYS dagar så att
 * lagringen på gratisnivån inte fylls. Vercel anropar med Authorization: Bearer CRON_SECRET.
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
  return Response.json({ deleted: old.length, keepDays: KEEP_DAYS });
}
