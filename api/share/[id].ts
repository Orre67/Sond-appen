import { bundleUrl } from "../../src/server/blob";

/**
 * GET /api/share/<id>: skickar telefonen vidare till paketets adress i Blob. Paketet hämtas
 * direkt från Vercels CDN, eftersom det är större än vad en funktion får skicka tillbaka.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? url.pathname.split("/").pop() ?? "";
  if (!/^[a-z0-9]{8,24}$/i.test(id)) return Response.json({ error: "Ogiltigt id." }, { status: 400 });
  return new Response(null, { status: 302, headers: { location: bundleUrl(id), "cache-control": "no-store" } });
}
