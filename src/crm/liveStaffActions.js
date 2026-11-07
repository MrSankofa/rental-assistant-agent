"use strict";
const {validateApplicationStep} =
  require("./applicationTracking");
const {validateHandoffStep} =
  require("./leasingHandoffs");

const NEXT = Object.freeze({
  TOUR_SCHEDULED: "TOUR_COMPLETED",
  TOUR_COMPLETED: "APPLICATION_INVITED",
  APPLICATION_INVITED: "APPLICATION_RECEIVED",
  APPLICATION_RECEIVED: "UNDER_LANDLORD_REVIEW",
  MORE_INFO_REQUESTED: "UNDER_LANDLORD_REVIEW",
  APPROVED: "RENTREDI_ONBOARDING",
  RENTREDI_ONBOARDING: "LEASE_SIGNING_SCHEDULED",
  LEASE_SIGNING_SCHEDULED: "DISCLOSURES_READY_AND_DELIVERED",
  DISCLOSURES_READY_AND_DELIVERED: "LEASE_SIGNED"
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

  const allowed=current.stage==="UNDER_LANDLORD_REVIEW"
    ? ["APPROVED","DENIED","MORE_INFO_REQUESTED"]
    : expected?[expected]:[];

  if (!allowed.includes(input.stage)) {
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
    UNDER_LANDLORD_REVIEW: "Landlord reviews application",
    APPROVED: "Start external RentRedi onboarding",
    DENIED: "Complete required applicant notice outside the CRM",
    MORE_INFO_REQUESTED: "Await external information response",
    RENTREDI_ONBOARDING: "Schedule external lease signing",
    LEASE_SIGNING_SCHEDULED: "Prepare and deliver disclosures",
    DISCLOSURES_READY_AND_DELIVERED: "Verify external signatures",
    LEASE_SIGNED: "Verify move-in requirements separately"
  };

  return {
    stage: input.stage,
    confirmed:true,
    evidence: input.evidence.trim(),
    nextAction: nextActions[input.stage],
    application:validateApplicationStep(input.stage,input),
    handoff:validateHandoffStep(
      input.stage,input,{fromStage:current.stage}
    )
  };
}

module.exports = {
  NEXT,
  actionsEnabled,
  validateMilestone
};
