// Verifies the Cloudflare Access token on every admin request (defence in depth:
// Access already blocks strangers at the edge, this also blocks a misconfigured route).
// Needs ACCESS_TEAM_DOMAIN (e.g. spikinglabs.cloudflareaccess.com) and ACCESS_AUD.

const certCache = new Map();

function b64urlBytes(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlJson(text) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(text)));
}

function issuer(team) {
  return "https://" + String(team).replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function signingKey(team, kid, fetchImpl) {
  const url = `${issuer(team)}/cdn-cgi/access/certs`;
  let keys = certCache.get(url);
  if (!keys || !keys.some((k) => k.kid === kid)) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`could not load Access certificates (${res.status})`);
    keys = (await res.json()).keys || [];
    certCache.set(url, keys);
  }
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("unknown Access signing key");
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

function tokenFrom(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  return cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] || "";
}

/** Returns { email } for a valid Access token, otherwise throws with a reason. */
export async function verifyAccess(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new Error("Cloudflare Access is not configured");
  const token = tokenFrom(request);
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not signed in through Cloudflare Access");
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== "RS256") throw new Error("unexpected token algorithm");
  const key = await signingKey(env.ACCESS_TEAM_DOMAIN, header.kid, fetchImpl);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), signed))) {
    throw new Error("bad token signature");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUD)) throw new Error("token is for another application");
  if (claims.iss !== issuer(env.ACCESS_TEAM_DOMAIN)) throw new Error("token from another team");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) throw new Error("token expired");
  if (!claims.email) throw new Error("token has no email");
  return { email: claims.email };
}
