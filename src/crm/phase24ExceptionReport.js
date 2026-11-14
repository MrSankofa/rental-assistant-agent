"use strict";

const {
  auditId,
  planPhase24Reconciliation
} = require("./phase24Reconciliation");

async function buildPhase24ExceptionReport({
  store, engagements, scope, now = new Date(), maxEvents = 100
}) {
  if (!store || typeof store.get !== "function")
    throw new Error("CRM store required");
  if (!Array.isArray(engagements))
    throw new Error("Engagements required");
  if (typeof scope !== "string" || !scope.trim())
    throw new Error("Scope required");
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 200)
    throw new Error("Invalid inspection limit");

  const eligible = engagements.filter(e =>
    e?.domain === "rental" && e.parallelMoveIn
  );

  const expected = [];
  for (const e of eligible) {
    for (const event of e.parallelMoveIn.events || []) {
      expected.push({
        engagementId:e.id,
        eventId:event.eventId
      });
    }
  }

  // Never infer audit completeness from a truncated Firestore list.
  const selected = expected.slice(0, maxEvents);
  const audits = [];

  for (const event of selected) {
    const id = auditId(scope,event.engagementId,event.eventId);
    const row = await store.get("audits",id);
    if (row) audits.push(row.value);
  }

  const inspectedEngagementIds = new Set(
    selected.map(e => e.engagementId)
  );

  // Include all engagements with no events, but do not misclassify
  // uninspected events as missing audits.
  const scoped = eligible.filter(e => {
    const count = (e.parallelMoveIn.events || []).length;
    return count === 0 ||
      (inspectedEngagementIds.has(e.id) &&
       (e.parallelMoveIn.events || []).every(event =>
         selected.some(s =>
           s.engagementId === e.id &&
           s.eventId === event.eventId
         )
       ));
  });

  const result = planPhase24Reconciliation({
    engagements:scoped,
    audits,
    scope,
    now
  });

  return {
    ...result,
    coverage:expected.length > selected.length ?
      "partial" : "complete",
    expectedAuditCount:expected.length,
    inspectedAuditCount:selected.length,
    excludedEngagementCount:eligible.length-scoped.length,
    requiresStaffReview:
      result.issueCount > 0 ||
      expected.length > selected.length,
    outboundEnabled:false
  };
}

module.exports={buildPhase24ExceptionReport};
