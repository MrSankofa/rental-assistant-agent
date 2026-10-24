"use strict";

const { CRM } = require("../src/crm/workflows");
const { makeStore } = require("../src/crm/storage");

const EXPECTED_PROJECT = "altruistic-platform";
const EXPECTED_SCOPE = "rental-staging";
const TARGET = "ziegler";
const TEST_EMAIL = "staging-fictional-prospect@example.test";
const ACTIONS = new Set(["write", "read"]);

function requireTestEnvironment() {
  if (process.env.CRM_SMOKE_ENABLED !== "true" ||
      process.env.CRM_BACKEND !== "firestore" ||
      process.env.CRM_SCOPE !== EXPECTED_SCOPE ||
      process.env.GOOGLE_CLOUD_PROJECT !== EXPECTED_PROJECT ||
      process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Refusing to run outside the configured fictional staging environment");
  }
}

const payload = {
  name: "Fictional Staging Prospect",
  email: TEST_EMAIL,
  phone: "",
  preferredChannel: "email",
  domain: "rental",
  targetId: TARGET,
  source: "cloud-run-job-smoke-test",
  interest: "Fictional tour request",
  consent: { recording: true, email: false, sms: false }
};

async function main() {
  requireTestEnvironment();
  const action = process.argv[2];
  if (!ACTIONS.has(action)) throw new Error("Usage: node scripts/firestore-smoke.js write|read");

  const store = makeStore();
  const crm = new CRM(store, EXPECTED_SCOPE);

  if (action === "write") {
    const created = await crm.intake(payload, { actor: "test-job", origin: "staff" });
    let row = await crm.history(created.engagementId);
    if (row.stage === "CONTACT_CAPTURED") {
      row = await crm.transition(created.engagementId, {
        stage: "TOUR_OFFERED",
        nextAction: "Staff confirms a fictional tour"
      }, "staff");
    }
    if (row.stage !== "TOUR_OFFERED") throw new Error("Unexpected stage after writing");
    console.log("SMOKE_WRITE_PASS", JSON.stringify({
      scope: EXPECTED_SCOPE, created: created.created, stage: row.stage
    }));
  } else {
    // Reconstruct the stable, fictional key to retrieve in a separate job execution.
    const crypto = require("crypto");
    const contactId = "c_" + crypto.createHash("sha256")
      .update(EXPECTED_SCOPE + "|" + TEST_EMAIL).digest("hex").slice(0, 40);
    const engagementId = "e_" + crypto.createHash("sha256")
      .update(contactId + "|rental|" + TARGET).digest("hex").slice(0, 40);
    const contact = await store.get("contacts", contactId);
    const row = await crm.history(engagementId);
    if (!contact || contact.value.name !== payload.name ||
        contact.value.consent.recording !== true ||
        row.stage !== "TOUR_OFFERED" ||
        row.nextAction !== "Staff confirms a fictional tour") {
      throw new Error("Fictional record failed persistence verification");
    }
    console.log("SMOKE_READ_PASS", JSON.stringify({
      scope: EXPECTED_SCOPE, stage: row.stage, contactVerified: true
    }));
  }
}

main().catch((error) => {
  console.error("SMOKE_FAILED:", error.message);
  process.exitCode = 1;
});
