"use strict";
const crypto = require("crypto");
const { StoreConflict } = require("./storage");

const MAX_TURNS = 20;
const RETENTION_DAYS = 30;
const fail = (status, message) => Object.assign(new Error(message), {status});
const docId = engagementId => {
  if (!/^e_[0-9a-f]{40}$/.test(engagementId || ""))
    throw fail(400, "Invalid engagement");
  return "pc_" + crypto.createHash("sha256").update(engagementId).digest("hex");
};
const validTurn = turn => turn && ["user","assistant"].includes(turn.role) &&
  typeof turn.content === "string" && turn.content.length > 0 &&
  turn.content.length <= 4000;
async function loadConversation(store, engagementId, { now = Date.now() } = {}) {
  const id = docId(engagementId);
  const row = await store.get("prospectconversations", id);
  if (!row) return {turns:[], version:null};
  if (row.value.engagementId !== engagementId) throw fail(403,"Conversation mismatch");
  if (Date.parse(row.value.expiresAt) <= now)
    return {turns:[], version:row.version};
  if (!Array.isArray(row.value.turns) ||
      !row.value.turns.every(validTurn)) throw fail(503,"Conversation unavailable");
  return {turns:row.value.turns.slice(-MAX_TURNS),version:row.version};
}
async function appendConversation(store, engagementId, expectedVersion, pair,
  {now = Date.now()} = {}) {
  const id = docId(engagementId);
  if (!Array.isArray(pair) || pair.length !== 2 ||
      pair[0]?.role !== "user" || pair[1]?.role !== "assistant" ||
      !pair.every(validTurn)) throw fail(400,"Invalid conversation turn");
  const row = await store.get("prospectconversations",id);
  if ((row?.version || null) !== expectedVersion)
    throw fail(409,"Conversation updated in another tab");
  const existing = row && Date.parse(row.value.expiresAt) > now
    ? row.value.turns : [];
  if (!Array.isArray(existing)) throw fail(503,"Conversation unavailable");
  const next = {id,engagementId,
    turns:[...existing,...pair].slice(-MAX_TURNS),
    updatedAt:new Date(now).toISOString(),
    expiresAt:new Date(now + RETENTION_DAYS * 86400000).toISOString()};
  try {
    if (row) await store.replace("prospectconversations",id,next,row.version);
    else if (!await store.create("prospectconversations",id,next))
      throw new StoreConflict();
  } catch (error) {
    if (error instanceof StoreConflict) throw fail(409,"Conversation updated in another tab");
    throw error;
  }
  return next.turns;
}
module.exports={loadConversation,appendConversation,MAX_TURNS,RETENTION_DAYS};
