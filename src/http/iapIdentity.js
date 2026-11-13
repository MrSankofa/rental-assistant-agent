"use strict";

const crypto = require("crypto");

const AUDIENCE =
  "/projects/951837038410/locations/us-east5/" +
  "services/rental-assistant-staff-live";

const ISSUER = "https://cloud.google.com/iap";
const JWKS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";

let cachedKeys = null;
let cacheUntil = 0;

function reject() {
  throw Object.assign(new Error("Verified staff identity required"), {
    status:403
  });
}

function decode(segment) {
  if (typeof segment !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(segment)) reject();

  try {
    return JSON.parse(
      Buffer.from(segment,"base64url").toString("utf8")
    );
  } catch {
    reject();
  }
}

async function publicKeys(fetchFn, now) {
  if (cachedKeys && now < cacheUntil) return cachedKeys;

  const response = await fetchFn(JWKS_URL, {
    signal:AbortSignal.timeout(8000)
  });

  if (!response.ok) reject();

  const data = await response.json();

  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    reject();
  }

  cachedKeys = data.keys;
  cacheUntil = now + 300000;
  return cachedKeys;
}

async function verifyIapIdentity(
  assertion,
  {
    allowedEmails,
    audience=AUDIENCE,
    fetchFn=globalThis.fetch,
    now=Date.now()
  }={}
) {
  if (typeof assertion !== "string" ||
      assertion.length < 100 ||
      assertion.length > 8192) reject();

  if (typeof allowedEmails !== "string" ||
      !allowedEmails.trim()) reject();

  const allowlist = new Set(
    allowedEmails.split(",")
      .map(s=>s.trim().toLowerCase())
      .filter(Boolean)
  );

  const segments = assertion.split(".");
  if (segments.length !== 3) reject();

  const [encodedHeader,encodedPayload,encodedSignature] = segments;
  const header = decode(encodedHeader);
  const payload = decode(encodedPayload);

  if (header.alg !== "ES256" ||
      typeof header.kid !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) reject();

  const permittedAudiences = new Set([AUDIENCE,
    "/projects/951837038410/locations/us-east5/services/rental-assistant-staff-staging"]);
  if (!permittedAudiences.has(audience)) reject();
  if (payload.iss !== ISSUER ||
      payload.aud !== audience ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp)) reject();

  const seconds = now / 1000;

  if (payload.iat > seconds + 30 ||
      payload.exp < seconds - 30 ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 660) reject();

  if (typeof payload.email !== "string" ||
      typeof payload.sub !== "string" ||
      !/^accounts\.google\.com:[0-9]{6,30}$/.test(payload.sub)) {
    reject();
  }

  const email = payload.email.toLowerCase();

  if (!allowlist.has(email)) reject();

  const keys = await publicKeys(fetchFn,now);
  const jwk = keys.find(key =>
    key.kid === header.kid &&
    key.kty === "EC" &&
    key.crv === "P-256"
  );

  if (!jwk) reject();

  let valid = false;

  try {
    const publicKey = crypto.createPublicKey({
      key:jwk,format:"jwk"
    });

    valid = crypto.verify(
      "sha256",
      Buffer.from(encodedHeader+"."+encodedPayload),
      {key:publicKey,dsaEncoding:"ieee-p1363"},
      Buffer.from(encodedSignature,"base64url")
    );
  } catch {
    reject();
  }

  if (!valid) reject();

  return Object.freeze({
    email,
    sub:payload.sub,
    actor:"staff:"+payload.sub
  });
}

module.exports = {
  AUDIENCE,
  verifyIapIdentity
};
