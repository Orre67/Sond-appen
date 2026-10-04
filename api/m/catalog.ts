import { isLoggedIn } from "../../src/server/auth";
import { readRegister } from "../../src/server/blob";

/** Listan över publicerade inmätningar, bara för inloggade telefoner. */
export async function GET(request: Request): Promise<Response> {
  if (!isLoggedIn(request)) return Response.json({ error: "Inte inloggad." }, { status: 401 });
  const catalog = await readRegister();
  return Response.json(catalog, { headers: { "cache-control": "no-store" } });
}
