import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inloggning för telefonerna i testfasen: en gemensam åtkomstkod (ACCESS_CODE). Rätt kod ger
 * en signerad session i en kaka som gäller 30 dagar. Byts koden blir alla sessioner ogiltiga.
 */
export const SESSION_COOKIE = "sond_access";
const SESSION_DAYS = 30;

function signingKey(): string {
  const code = process.env.ACCESS_CODE;
  if (!code) throw new Error("ACCESS_CODE saknas.");
  return `${code}|${process.env.REGISTER_SECRET ?? ""}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function codeMatches(given: string): boolean {
  const expected = process.env.ACCESS_CODE ?? "";
  return expected.length > 0 && equal(given.trim(), expected);
}

/** Session: utgångstid i sekunder plus signatur. */
export function createSession(now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + SESSION_DAYS * 86_400);
  return `${exp}.${sign(exp)}`;
}

export function sessionValid(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return equal(sig, sign(exp));
}

export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function isLoggedIn(request: Request): boolean {
  return sessionValid(cookieValue(request.headers.get("cookie"), SESSION_COOKIE));
}
