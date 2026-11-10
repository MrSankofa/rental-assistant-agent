"use strict";
const { exchangeReturnLink, getProspectContext, revokeSession } =
  require("../crm/prospectIdentity");
const { loadConversation } = require("../crm/prospectConversation");

const COOKIE = "__Host-rental_prospect";
const MAX_BODY = 2048;

function parseSessionCookie(header) {
  if (typeof header !== "string" || header.length > 8192) return null;
  const matches = header.split(";").map(x => x.trim())
    .filter(x => x.startsWith(COOKIE + "="));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null;
}
function cookie(value, maxAge) {
  return COOKIE + "=" + value +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
function authorizedOrigin(headers, configuredOrigin) {
  // Browser session creation and revocation require same-origin requests.
  // Never trust X-Forwarded-* headers to select a permitted origin.
  return typeof configuredOrigin === "string" &&
    /^https:\/\/[^/]+$/.test(configuredOrigin) &&
    headers.origin === configuredOrigin &&
    (!headers["sec-fetch-site"] ||
      ["same-origin", "none"].includes(headers["sec-fetch-site"])) &&
    /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(
      String(headers["content-type"] || "")
    );
}
async function readBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw Object.assign(new Error("Too large"), {status:413});
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON"), {status:400}); }
}
function reply(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(body));
}
async function handleProspectSession({req, res, crm, env, pathname}) {
  if (!crm || env.PROSPECT_SESSION_ENABLED !== "true" ||
      !["/api/prospect/session", "/api/prospect/context", "/api/prospect/conversation"].includes(pathname))
    return false;

  // Session tokens are not readable by JS, and will never be placed in a
  // response body. Only the verified server-scoped context is returned.
  if (["/api/prospect/context", "/api/prospect/conversation"].includes(pathname) && req.method === "GET") {
    const session = parseSessionCookie(req.headers.cookie);
    if (!session) { reply(res, 401, { error: "Session required" }); return true; }
    try {
      const context = await getProspectContext(crm.store, session);
      const { engagementId, ...safeContext } = context;
      if (pathname === "/api/prospect/conversation") {
        const conversation = await loadConversation(crm.store,engagementId);
        reply(res,200,{...safeContext,turns:conversation.turns});
      } else reply(res, 200, safeContext);
    } catch {
      reply(res, 401, { error: "Session unavailable" },
        { "Set-Cookie": cookie("", 0) });
    }
    return true;
  }
  if (pathname === "/api/prospect/session" && req.method === "POST") {
    if (!authorizedOrigin(req.headers, env.PUBLIC_ORIGIN)) {
      reply(res, 403, { error: "Request not permitted" }); return true;
    }
    try {
      const body = await readBody(req);
      if (!body || typeof body.token !== "string") {
        reply(res, 400, {error: "Invalid request"}); return true;
      }
      const session = await exchangeReturnLink(crm.store, body.token);
      reply(res, 200, { authenticated: true, expiresAt: session.expiresAt },
        { "Set-Cookie": cookie(session.sessionToken, 12 * 3600) });
    } catch (error) {
      reply(res, error.status === 413 ? 413 : 401,
        { error: "Invalid or expired link" });
    }
    return true;
  }
  if (pathname === "/api/prospect/session" && req.method === "DELETE") {
    if (!authorizedOrigin(req.headers, env.PUBLIC_ORIGIN)) {
      reply(res, 403, { error: "Request not permitted" }); return true;
    }
    const session = parseSessionCookie(req.headers.cookie);
    if (session) {
      try { await revokeSession(crm.store, session); }
      catch { reply(res, 503, {error:"Session unavailable"}); return true; }
    }
    reply(res, 200, { authenticated: false },
      { "Set-Cookie": cookie("", 0) });
    return true;
  }
  reply(res, 405, {error:"Method not allowed"}, {"Allow":
    pathname !== "/api/prospect/session" ? "GET" : "POST, DELETE"});
  return true;
}
module.exports = { handleProspectSession, parseSessionCookie, authorizedOrigin, cookie };
