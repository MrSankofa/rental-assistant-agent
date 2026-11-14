"use strict";

const crypto = require("crypto");

function auditId(scope, engagementId, eventId) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify([scope, engagementId, eventId]))
    .digest("hex");
  return "p24_" + digest.slice(0, 40);
}

function planPhase24Reconciliation({
  engagements = [],
  audits = [],
  scope,
  now = new Date(),
  staleDays = 7
} = {}) {
  if (typeof scope !== "string" || !scope.trim())
    throw new Error("Scope required");

  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid reconciliation time");

  if (!Number.isInteger(staleDays) || staleDays < 1)
    throw new Error("Invalid stale threshold");

  const knownAudits = new Map(
    audits.filter(a => a.scope === scope).map(a => [a.id,a])
  );

  const issues = [];
  let inspected = 0;

  for (const e of engagements) {
    if (!e || e.domain !== "rental" || !e.parallelMoveIn)
      continue;

    inspected++;
    const events = e.parallelMoveIn.events || [];

    for (const event of events) {
      const id = auditId(scope, e.id, event.eventId);
      const audit = knownAudits.get(id);

      if (!audit) {
        issues.push({
          engagementId:e.id,
          type:"missing-audit",
          eventId:event.eventId,
          auditId:id,
          action:"staff-reconciliation-required"
        });
      } else if (
        audit.entityId !== e.id ||
        audit.type !== "parallel-move-in-milestone" ||
        audit.actor !== event.actor ||
        audit.details?.eventId !== event.eventId ||
        audit.details?.track !== event.track ||
        audit.details?.status !== event.status
      ) {
        issues.push({
          engagementId:e.id,
          type:"audit-mismatch",
          eventId:event.eventId,
          auditId:id,
          action:"investigate-without-overwriting"
        });
      }
    }

    if (["DENIED","WITHDRAWN"].includes(e.stage))
      continue;

    const tracks = e.parallelMoveIn.tracks || {};
    const updated = Date.parse(e.updatedAt || "");

    if (Number.isFinite(updated) &&
        now.getTime() - updated >= staleDays*86400000 &&
        tracks.keys?.status !== "released") {
      issues.push({
        engagementId:e.id,
        type:"stalled-move-in",
        action:"staff-review-required"
      });
    }

    for (const track of ["rent","deposit"]) {
      if (tracks[track]?.status === "received") {
        issues.push({
          engagementId:e.id,
          type:"payment-awaiting-verification",
          track,
          action:"staff-review-required"
        });
      }
    }
  }

  return {
    inspected,
    issueCount:issues.length,
    issues,
    automaticRemediation:false,
    emailSent:false
  };
}

module.exports = {
  auditId,
  planPhase24Reconciliation
};
