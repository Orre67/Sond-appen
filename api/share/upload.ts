import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

/**
 * Nyckelutbyte för uppladdning av delningspaket direkt från webbläsaren till Vercel Blob.
 * Paketen är större än de 4,5 MB en funktion får ta emot, så filen går aldrig via servern:
 * klienten ber om en kortlivad uppladdningsnyckel här och skickar sedan paketet till Blob.
 * Nyckeln lämnas bara ut om klienten skickar med rätt delningsnyckel (SHARE_KEY).
 */
export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const expected = process.env.SHARE_KEY;
        let given = "";
        try {
          given = clientPayload ? ((JSON.parse(clientPayload) as { key?: string }).key ?? "") : "";
        } catch {
          given = "";
        }
        if (!expected || given !== expected) throw new Error("Fel delningsnyckel.");
        if (!/^share\/[a-z0-9]{8,24}\.json$/.test(pathname)) throw new Error("Ogiltigt paketnamn.");
        return {
          allowedContentTypes: ["application/json"],
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: 200 * 1024 * 1024,
          tokenPayload: "",
        };
      },
      onUploadCompleted: async () => {
        // Inget register att uppdatera: paketets adress följer av dess id.
      },
    });
    return Response.json(json);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
