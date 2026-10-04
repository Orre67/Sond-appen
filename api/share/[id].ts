import { list } from "@vercel/blob";

/** Publika blobbar nås på https://<lagrings-id>.public.blob.vercel-storage.com/<sökväg>. Id:t står i skrivnyckeln. */
function publicBase(): string | null {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? "");
  return m ? `https://${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

/**
 * GET /api/share/<id>: skickar telefonen vidare till paketets adress i Blob. Paketet hämtas
 * direkt från Vercels CDN, eftersom det är större än vad en funktion får skicka tillbaka.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? url.pathname.split("/").pop() ?? "";
  if (!/^[a-z0-9]{8,24}$/i.test(id)) return Response.json({ error: "Ogiltigt id." }, { status: 400 });
  const pathname = `share/${id.toLowerCase()}.json`;
  const base = publicBase();
  let target = base ? `${base}/${pathname}` : null;
  if (!target) {
    const page = await list({ prefix: pathname, limit: 1 });
    target = page.blobs[0]?.url ?? null;
  }
  if (!target) return Response.json({ error: "Paketet finns inte." }, { status: 404 });
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
}
