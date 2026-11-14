"use strict";

const REQUIREMENTS = Object.freeze([
  ["landlordApproval", "Landlord approval recorded"],
  ["leaseSigned", "Lease signature verified"],
  ["rentrediInvited", "RentRedi invitation recorded"],
  ["rentVerified", "Rent payment independently verified"],
  ["depositVerified", "Deposit independently verified"],
  ["disclosuresDelivered", "Required disclosures confirmed"],
  ["lawfulReadiness", "Owner confirmed lawful and physical readiness"]
]);

function evaluatePossessionReadiness(engagement) {
  if (!engagement || engagement.domain !== "rental" ||
      !["ziegler", "virginia"].includes(engagement.targetId)) {
    return {
      eligibleForOwnerReview: false,
      keysAuthorized: false,
      blocked: true,
      missing: ["Valid rental engagement required"]
    };
  }

  const tracks = engagement.parallelMoveIn?.tracks || {};
  const approved =
    engagement.handoff?.decision?.status === "approved";

  const values = {
    landlordApproval: approved,
    leaseSigned: tracks.lease?.status === "signed",
    rentrediInvited: tracks.rentredi?.status === "invited",
    rentVerified: tracks.rent?.status === "verified",
    depositVerified: tracks.deposit?.status === "verified",
    disclosuresDelivered:
      tracks.disclosures?.status === "delivered",
    lawfulReadiness: tracks.possession?.status === "lawful-ready"
  };

  const missing = REQUIREMENTS
    .filter(([key]) => values[key] !== true)
    .map(([, label]) => label);

  const closed = ["DENIED", "WITHDRAWN"].includes(
    engagement.stage
  );

  if (closed)
    missing.push("Engagement is closed");

  const eligibleForOwnerReview = missing.length === 0;
  const keysReleased = tracks.keys?.status === "released";

  return {
    requirements: values,
    eligibleForOwnerReview,
    keysReleased,
    checklistStatus: tracks.checklist?.status || "not-started",
    // A readiness assessment must never release keys.
    keysAuthorized: false,
    blocked: true,
    missing,
    requiresOwnerConfirmation: true,
    requiresLawfulPossessionReview: true
  };
}

module.exports = {
  REQUIREMENTS,
  evaluatePossessionReadiness
};
