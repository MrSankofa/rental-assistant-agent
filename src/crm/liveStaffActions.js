"use strict";

const NEXT = Object.freeze({
  TOUR_SCHEDULED: "TOUR_COMPLETED",
  TOUR_COMPLETED: "APPLICATION_INVITED",
  APPLICATION_INVITED: "APPLICATION_RECEIVED",
  APPLICATION_RECEIVED: "UNDER_LANDLORD_REVIEW"
});

function actionsEnabled(env) {
  return env.K_SERVICE === "rental-assistant-staff-live" &&
    env.CRM_STAFF_ENABLED === "true" &&
    env.CRM_REAL_STAFF_ENABLED === "true" &&
    env.CRM_LIVE_STAFF_ACTIONS_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === "rental-leads-prod" &&
    env.CRM_SCOPE === "rental-live" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_DELIVERY_MODE === "disabled" &&
    env.CRM_PUBLIC_INTAKE_ENABLED !== "true" &&
    env.CRM_REAL_INTAKE_ENABLED !== "true" &&
    !env.FIRESTORE_EMULATOR_HOST;
}

function validateMilestone(current, input) {
  if (!current || current.domain !== "rental") {
    throw Object.assign(new Error("Rental engagement required"), {
      status: 403
    });
  }

  if (!input || typeof input !== "object" ||
      Array.isArray(input)) {
    throw Object.assign(new Error("Invalid request"), {status:400});
  }

  const expected = NEXT[current.stage];

  if (!expected || input.stage !== expected) {
    throw Object.assign(
      new Error("Milestone not permitted from current stage"),
      {status:409}
    );
  }

  if (typeof input.evidence !== "string" ||
      input.evidence.trim().length < 10 ||
      input.evidence.length > 300) {
    throw Object.assign(
      new Error("Staff evidence must be 10-300 characters"),
      {status:400}
    );
  }

  if (input.confirmed !== true) {
    throw Object.assign(
      new Error("Explicit staff confirmation required"),
      {status:403}
    );
  }

  const nextActions = {
    TOUR_COMPLETED: "Invite prospect to apply",
    APPLICATION_INVITED: "Await application submission",
    APPLICATION_RECEIVED: "Review submitted application",
    UNDER_LANDLORD_REVIEW: "Landlord reviews application"
  };

  return {
    stage: expected,
    evidence: input.evidence.trim(),
    nextAction: nextActions[expected]
  };
}

module.exports = {
  NEXT,
  actionsEnabled,
  validateMilestone
};
