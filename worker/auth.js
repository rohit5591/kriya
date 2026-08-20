/* ==================================================================
   Sign-in with Google, and the session cookie we hand out afterwards.

   Google's ID token proves who someone is. It says nothing about what
   they may hear — that comes from the users table. We verify their
   token once, then run on our own short cookie so every later request
   is a signature check and a row lookup, no round trip to Google.
   ================================================================== */

const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISS = ["accounts.google.com", "https://accounts.google.com"];
export const SESSION_COOKIE = "kriya_session";
const SESSION_DAYS = 90;

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jsonPart = (s) => JSON.parse(dec.decode(b64urlToBytes(s)));

/* Google rotates these keys, and the response says how long they last,
   so the cache lifetime comes from Cache-Control rather than a guess. */
let jwks = { keys: null, until: 0 };

async function googleKeys() {
  if (jwks.keys && Date.now() < jwks.until) return jwks.keys;
  const r = await fetch(GOOGLE_JWKS);
  if (!r.ok) throw new Error("could not reach Google's signing keys");
  const maxAge = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  const body = await r.json();
  jwks = { keys: body.keys, until: Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000 };
  return jwks.keys;
}

/* Throws on anything that doesn't add up — an unsigned token, someone
   else's client id, an expired one, an unverified address. */
export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts;
  const header = jsonPart(h);
  const payload = jsonPart(p);

  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");

  if (payload.aud !== clientId) throw new Error("token was issued for another app");
  if (!GOOGLE_ISS.includes(payload.iss)) throw new Error("wrong issuer");
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error("token expired");
  if (!payload.email) throw new Error("no email on token");
  if (payload.email_verified === false) throw new Error("email not verified with Google");

  return {
    email: String(payload.email).toLowerCase(),
    name: payload.name || "",
    picture: payload.picture || "",
  };
}

/* ------------------------- our own session ------------------------ */

const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signSession(email, secret) {
  const body = bytesToB64url(enc.encode(JSON.stringify({
    sub: email,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function readSession(cookieHeader, secret) {
  const raw = (cookieHeader || "")
    .split(";").map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) return null;

  const [body, sig] = raw.slice(SESSION_COOKIE.length + 1).split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC", await hmacKey(secret), b64urlToBytes(sig), enc.encode(body));
    if (!ok) return null;
    const claims = jsonPart(body);
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    return claims.sub;
  } catch (e) {
    return null;
  }
}

export const sessionCookie = (value) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
export const clearedCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
