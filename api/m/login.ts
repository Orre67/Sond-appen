import { codeMatches, createSession, isLoggedIn, sessionCookie } from "../../src/server/auth.js";

/** GET: är telefonen inloggad? POST { code }: logga in med företagets åtkomstkod. */
export async function GET(request: Request): Promise<Response> {
  return Response.json({ loggedIn: isLoggedIn(request) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  let code = "";
  try {
    code = String(((await request.json()) as { code?: unknown }).code ?? "");
  } catch {
    code = "";
  }
  if (!codeMatches(code)) return Response.json({ error: "Fel kod." }, { status: 401 });
  const secure = new URL(request.url).protocol === "https:";
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(createSession(), secure), "cache-control": "no-store" },
  });
}
