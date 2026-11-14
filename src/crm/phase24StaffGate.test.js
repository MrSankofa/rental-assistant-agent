"use strict";

const {
  phase24Enabled,
  phase24Response
} = require("./phase24StaffGate");

const production = {
  K_SERVICE: "rental-assistant-staff-live",
  CRM_STAFF_ENABLED: "true",
  CRM_REAL_STAFF_ENABLED: "true",
  CRM_LIVE_STAFF_ACTIONS_ENABLED: "true",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-leads-prod",
  CRM_SCOPE: "rental-live",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_DELIVERY_MODE: "disabled",
  CRM_PRODUCTION_EMAIL_ENABLED: "false",
  PHASE24_PARALLEL_MILESTONES_ENABLED: "true"
};

describe("Phase 24 staff feature boundary", () => {
  test("requires explicit production-only enablement", () => {
    expect(phase24Enabled(production)).toBe(true);

    for (const changes of [
      {PHASE24_PARALLEL_MILESTONES_ENABLED:"false"},
      {CRM_PRODUCTION_EMAIL_ENABLED:"true"},
      {CRM_DELIVERY_MODE:"enabled"},
      {K_SERVICE:"rental-assistant-live-candidate"},
      {CRM_DATABASE:"rental-email-staging"},
      {CRM_SCOPE:"rental-staging"}
    ]) {
      expect(phase24Enabled({...production,...changes}))
        .toBe(false);
    }
  });

  test("response does not include contact or screening data", () => {
    const result=phase24Response({
      id:"fictional-engagement",
      stage:"APPROVED",
      parallelMoveIn:{tracks:{lease:{status:"prepared"}}},
      updatedAt:"2026-11-14T00:00:00Z",
      contact:{email:"private@example.test"},
      application:{screening:"private"}
    });

    expect(result.parallelMoveIn.tracks.lease.status)
      .toBe("prepared");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

describe("Phase 24 legacy transition compatibility", () => {
  const {legacyStageBlocked} = require("./phase24StaffGate");

  const env = {
    K_SERVICE:"rental-assistant-staff-live",
    CRM_STAFF_ENABLED:"true",
    CRM_REAL_STAFF_ENABLED:"true",
    CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",
    CRM_BACKEND:"firestore",
    CRM_DATABASE:"rental-leads-prod",
    CRM_SCOPE:"rental-live",
    GOOGLE_CLOUD_PROJECT:"altruistic-platform",
    CRM_DELIVERY_MODE:"disabled",
    CRM_PRODUCTION_EMAIL_ENABLED:"false",
    PHASE24_PARALLEL_MILESTONES_ENABLED:"true"
  };

  test("blocks old leasing and key transitions when enabled", () => {
    for (const stage of [
      "RENTREDI_ONBOARDING",
      "LEASE_SIGNING_SCHEDULED",
      "DISCLOSURES_READY_AND_DELIVERED",
      "LEASE_SIGNED",
      "MOVE_IN_FUNDS_VERIFIED",
      "KEYS_RELEASED",
      "MOVE_IN_CHECKLIST_PENDING",
      "MOVE_IN_COMPLETED"
    ]) {
      expect(legacyStageBlocked(stage,env)).toBe(true);
    }
  });

  test("preserves application review and legacy fallback", () => {
    expect(legacyStageBlocked("APPROVED",env)).toBe(false);

    expect(legacyStageBlocked("KEYS_RELEASED",{
      ...env,
      PHASE24_PARALLEL_MILESTONES_ENABLED:"false"
    })).toBe(false);
  });
});
