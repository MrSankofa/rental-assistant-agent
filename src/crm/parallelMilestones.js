"use strict";

const {StoreConflict} = require("./storage");
const crypto = require("crypto");
const {evaluatePossessionReadiness} = require("./possessionReadiness");

const TRACKS = Object.freeze({
  lease: ["prepared", "sent", "signed"],
  rentredi: ["invited"],
  rent: ["due", "received", "verified"],
  deposit: ["due", "received", "verified"],
  disclosures: ["delivered"],
  possession: ["lawful-ready"],
  keys: ["released"],
  checklist: ["signed-recorded", "copy-delivered"]
});

function fail(message, status) {
  throw Object.assign(new Error(message), {status});
}

function isStaff(actor) {
  return actor === "staff" ||
    (typeof actor === "string" &&
     /^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor));
}

function validateAction(engagement, input, actor) {
  if (!engagement || engagement.domain !== "rental" ||
      !["ziegler", "virginia"].includes(engagement.targetId))
    fail("Valid rental engagement required", 403);

  if (!isStaff(actor))
    fail("Staff identity required", 403);

  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Invalid milestone request", 400);

  const {track, status, evidence, confirmed, eventId} = input;

  if (!Object.prototype.hasOwnProperty.call(TRACKS, track) ||
      !TRACKS[track].includes(status))
    fail("Unknown milestone", 400);

  if (confirmed !== true)
    fail("Explicit staff confirmation required", 403);

  if (typeof evidence !== "string" ||
      evidence.trim().length < 10 || evidence.length > 300)
    fail("Evidence must be 10-300 characters", 400);

  if (typeof eventId !== "string" ||
      !/^[a-zA-Z0-9_-]{12,100}$/.test(eventId))
    fail("Stable event ID required", 400);

  if (engagement.stage === "DENIED" ||
      engagement.stage === "WITHDRAWN")
    fail("Engagement is closed", 409);

  if (!engagement.handoff ||
      engagement.handoff.decision?.status !== "approved")
    fail("Independent landlord approval required", 409);

  return {
    track,
    status,
    evidence: evidence.trim(),
    eventId
  };
}

function applyMilestone(engagement, action, actor, now) {
  const previous = engagement.parallelMoveIn || {
    tracks: {},
    events: []
  };

  const events = previous.events || [];
  const existing = events.find(
    item => item.eventId === action.eventId
  );

  if (existing) {
    if (existing.track !== action.track ||
        existing.status !== action.status ||
        existing.evidence !== action.evidence ||
        existing.actor !== actor)
      fail("Event ID reused for different action", 409);

    return {duplicate: true, parallelMoveIn: previous};
  }

  if (action.track === "keys") {
    const readiness = evaluatePossessionReadiness(engagement);
    if (!readiness.eligibleForOwnerReview) {
      fail("Possession requirements incomplete", 409);
    }
  }

  if (action.track === "checklist" &&
      previous.tracks?.keys?.status !== "released") {
    fail("Physical key handover must be recorded first", 409);
  }

  const steps = TRACKS[action.track];
  const current = previous.tracks?.[action.track]?.status || null;
  const nextIndex = steps.indexOf(action.status);
  const currentIndex = current === null ? -1 : steps.indexOf(current);

  if (nextIndex !== currentIndex + 1)
    fail("Previous track milestone required", 409);

  const entry = {
    eventId: action.eventId,
    track: action.track,
    status: action.status,
    evidence: action.evidence,
    actor,
    at: now
  };

  return {
    duplicate: false,
    parallelMoveIn: {
      tracks: {
        ...previous.tracks,
        [action.track]: {
          status: action.status,
          evidence: action.evidence,
          at: now
        }
      },
      events: [...events, entry]
    }
  };
}

async function ensureMilestoneAudit(
  crm, engagementId, event
) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify([
      crm.scope, engagementId, event.eventId
    ]))
    .digest("hex");

  const auditId = "p24_" + digest.slice(0, 40);
  const audit = {
    id: auditId,
    scope: crm.scope,
    actor: event.actor,
    type: "parallel-move-in-milestone",
    entityId: engagementId,
    details: {
      eventId: event.eventId,
      track: event.track,
      status: event.status
    },
    at: event.at
  };

  const created = await crm.store.create(
    "audits", auditId, audit
  );

  if (!created) {
    const existing = await crm.store.get("audits", auditId);
    if (!existing ||
        JSON.stringify(existing.value) !== JSON.stringify(audit)) {
      throw new StoreConflict(
        "Milestone audit conflicts with existing record"
      );
    }
  }
}

async function recordParallelMilestone(
  crm, engagementId, input, actor = "staff"
) {
  if (typeof engagementId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,120}$/.test(engagementId))
    fail("Invalid engagement ID", 400);

  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await crm.store.get("engagements", engagementId);
    if (!row)
      fail("Engagement not found", 404);

    const action = validateAction(row.value, input, actor);
    const now = new Date().toISOString();
    const change = applyMilestone(
      row.value, action, actor, now
    );

    if (change.duplicate) {
      const event = change.parallelMoveIn.events.find(
        item => item.eventId === action.eventId
      );
      await ensureMilestoneAudit(crm, engagementId, event);

      return {
        ...row.value,
        parallelMoveIn: change.parallelMoveIn
      };
    }

    const updated = {
      ...row.value,
      parallelMoveIn: change.parallelMoveIn,
      updatedAt: now
    };

    try {
      await crm.store.replace(
        "engagements", engagementId, updated, row.version
      );

      const event = change.parallelMoveIn.events.find(
        item => item.eventId === action.eventId
      );
      await ensureMilestoneAudit(crm, engagementId, event);

      return updated;
    } catch (error) {
      if (!(error instanceof StoreConflict))
        throw error;
    }
  }

  throw new StoreConflict();
}

module.exports = {
  TRACKS,
  validateAction,
  applyMilestone,
  recordParallelMilestone
};
