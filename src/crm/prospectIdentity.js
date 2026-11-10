"use strict";
const crypto = require("crypto");
const { StoreConflict } = require("./storage");

const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = (status, message) => Object.assign(new Error(message), { status });
const token = () => crypto.randomBytes(32).toString("base64url");
const iso = time => new Date(time).toISOString();
const nowMs = clock => {
  const n = Number(clock());
  if (!Number.isFinite(n)) throw Error("Invalid clock");
  return n;
};
const isToken = value => typeof value === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(value);

// Token bytes are returned only to trusted mail/HTTP orchestration.
// They must never be placed in CRM records, logs, or public responses.
async function issueReturnLink(store, { contactId, engagementId, email }, { clock = Date.now } = {}) {
  if (!/^c_[0-9a-f]{40}$/.test(contactId || "") ||
      !/^e_[0-9a-f]{40}$/.test(engagementId || "") ||
      typeof email !== "string") throw fail(400, "Invalid identity reference");
  const contact = await store.get("contacts", contactId);
  const engagement = await store.get("engagements", engagementId);
  if (!contact || !engagement ||
      contact.value.email?.toLowerCase() !== email.trim().toLowerCase() ||
      engagement.value.contactId !== contactId ||
      engagement.value.domain !== "rental") throw fail(404, "Identity not available");
  const raw = token();
  const issuedAt = nowMs(clock);
  const id = "rl_" + digest(raw);
  const record = { id, contactId, engagementId, createdAt: iso(issuedAt),
    expiresAt: iso(issuedAt + LINK_TTL_MS), consumedAt: null };
  if (!await store.create("returnlinks", id, record)) throw fail(409, "Link conflict");
  return { token: raw, expiresAt: record.expiresAt };
}

async function exchangeReturnLink(store, raw, { clock = Date.now } = {}) {
  if (!isToken(raw)) throw fail(401, "Invalid or expired link");
  const id = "rl_" + digest(raw);
  const row = await store.get("returnlinks", id);
  const current = nowMs(clock);
  if (!row || row.value.consumedAt || Date.parse(row.value.expiresAt) <= current)
    throw fail(401, "Invalid or expired link");

  // Verify the linked records still agree before issuing a session.
  const contact = await store.get("contacts", row.value.contactId);
  const engagement = await store.get("engagements", row.value.engagementId);
  if (!contact || !engagement ||
      engagement.value.contactId !== row.value.contactId ||
      engagement.value.domain !== "rental") throw fail(401, "Invalid or expired link");

  try {
    await store.replace("returnlinks", id,
      { ...row.value, consumedAt: iso(current) }, row.version);
  } catch (error) {
    if (error instanceof StoreConflict) throw fail(401, "Invalid or expired link");
    throw error;
  }
  const rawSession = token();
  const sessionId = "ps_" + digest(rawSession);
  const expiresAt = iso(current + SESSION_TTL_MS);
  await store.create("prospectsessions", sessionId,
    { id: sessionId, contactId: row.value.contactId,
      engagementId: row.value.engagementId, expiresAt, revokedAt: null });
  return { sessionToken: rawSession, expiresAt };
}

// A session is bound to ONE contact AND ONE rental engagement, never to
// an arbitrary ID passed from the browser.
async function getProspectContext(store, rawSession, { clock = Date.now } = {}) {
  if (!isToken(rawSession)) throw fail(401, "Session required");
  const sessionRow = await store.get("prospectsessions", "ps_" + digest(rawSession));
  if (!sessionRow || sessionRow.value.revokedAt ||
      Date.parse(sessionRow.value.expiresAt) <= nowMs(clock))
    throw fail(401, "Session expired");
  const { contactId, engagementId } = sessionRow.value;
  const contact = await store.get("contacts", contactId);
  const engagement = await store.get("engagements", engagementId);
  if (!contact || !engagement || engagement.value.contactId !== contactId ||
      engagement.value.domain !== "rental") throw fail(403, "Session unavailable");
  // Explicit allowlist: never return confidential staff notes, screening data,
  // underlying CRM document, or any other prospect's records.
  return {
    propertyId: engagement.value.targetId,
    stage: engagement.value.stage,
    nextAction: engagement.value.nextAction || null,
    prospectName: contact.value.name,
    engagementId
  };
}
async function revokeSession(store, rawSession, { clock = Date.now } = {}) {
  if (!isToken(rawSession)) throw fail(401, "Session required");
  const id = "ps_" + digest(rawSession);
  const row = await store.get("prospectsessions", id);
  if (!row) return false;
  try {
    await store.replace("prospectsessions", id,
      { ...row.value, revokedAt: iso(nowMs(clock)) }, row.version);
  } catch (error) {
    if (error instanceof StoreConflict) return false;
    throw error;
  }
  return true;
}
module.exports = { issueReturnLink, exchangeReturnLink, getProspectContext,
  revokeSession, LINK_TTL_MS, SESSION_TTL_MS };
