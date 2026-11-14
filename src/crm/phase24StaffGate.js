"use strict";

const {actionsEnabled} = require("./liveStaffActions");

function phase24Enabled(env) {
  return actionsEnabled(env) &&
    env.PHASE24_PARALLEL_MILESTONES_ENABLED === "true" &&
    env.CRM_PRODUCTION_EMAIL_ENABLED === "false";
}

function phase24Response(engagement) {
  return {
    id: engagement.id,
    stage: engagement.stage,
    parallelMoveIn: engagement.parallelMoveIn || null,
    updatedAt: engagement.updatedAt
  };
}

const LEGACY_LEASING_STAGES = new Set([
  "RENTREDI_ONBOARDING",
  "LEASE_SIGNING_SCHEDULED",
  "DISCLOSURES_READY_AND_DELIVERED",
  "LEASE_SIGNED",
  "MOVE_IN_FUNDS_VERIFIED",
  "KEYS_RELEASED",
  "MOVE_IN_CHECKLIST_PENDING",
  "MOVE_IN_COMPLETED"
]);

function legacyStageBlocked(stage, env) {
  return phase24Enabled(env) &&
    LEGACY_LEASING_STAGES.has(stage);
}

module.exports = {
  phase24Enabled,
  phase24Response,
  legacyStageBlocked
};
