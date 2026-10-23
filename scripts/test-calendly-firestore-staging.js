"use strict";

const crypto = require("crypto");
const { FirestoreStore } = require("../src/crm/storage");
const { CRM } = require("../src/crm/workflows");
const {
  processBooking,
  bookingId
} = require("../src/crm/calendlyBookings");

const PROJECT = "altruistic-platform";
const DATABASE = "rental-email-staging";
const EXPECTED_SA =
  "rental-assistant-web-staging@altruistic-platform.iam.gserviceaccount.com";

async function main() {
  if (
    process.env.CALENDLY_FIRESTORE_TEST_ENABLED !== "true" ||
    process.env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
    process.env.CRM_DATABASE !== DATABASE ||
    process.env.CRM_EMAIL_TEST_ENABLED !== "false" ||
    process.env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error("STAGING_SAFETY_GUARD_FAILED");
  }

  // Validate the execution identity using Cloud Run metadata.
  const identityResponse = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/" +
      "service-accounts/default/email",
    {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5000)
    }
  );

  if (!identityResponse.ok ||
      (await identityResponse.text()).trim() !== EXPECTED_SA) {
    throw new Error("STAGING_IDENTITY_MISMATCH");
  }

  // Use a fresh isolated scope for every run.
  const unique = crypto.randomBytes(8).toString("hex");
  const scope = "calendly-test-" + unique;

  const store = new FirestoreStore({
    projectId: PROJECT,
    databaseId: DATABASE,
    scope
  });

  const crm = new CRM(store, scope);
  const email = "calendly-fixture-" + unique + "@example.test";

  console.log("ISOLATED_TEST_SCOPE:", scope);

  const lead = await crm.intake({
    name: "Calendly Fictional Fixture",
    email,
    preferredChannel: "none",
    domain: "rental",
    targetId: "ziegler",
    source: "isolated-calendly-test",
    consent: {
      recording: true,
      email: false,
      sms: false
    }
  }, { origin: "staff" });

  await crm.transition(
    lead.engagementId,
    { stage: "TOUR_OFFERED" },
    "staff"
  );

  const inviteeId =
    "https://api.calendly.com/scheduled_events/" +
    unique + "/invitees/" + unique;

  const created = {
    type: "created",
    inviteeId,
    engagementId: lead.engagementId,
    propertyId: "ziegler",
    email,
    startsAt: "2026-11-02T18:00:00Z",
    endsAt: "2026-11-02T18:30:00Z"
  };

  const first = await processBooking(crm, created);

  if (first.status !== "scheduled" ||
      (await crm.history(lead.engagementId)).stage !== "TOUR_SCHEDULED") {
    throw new Error("BOOKING_PERSISTENCE_FAILED");
  }

  console.log("FIRESTORE_BOOKING_PERSISTENCE_PASS");

  const repeated = await processBooking(crm, created);

  if (repeated.status !== "duplicate") {
    throw new Error("BOOKING_IDEMPOTENCY_FAILED");
  }

  console.log("FIRESTORE_BOOKING_IDEMPOTENCY_PASS");

  const cancellation = {
    type: "canceled",
    inviteeId
  };

  const canceled = await processBooking(crm, cancellation);

  if (canceled.status !== "cancelled" ||
      (await crm.history(lead.engagementId)).stage !== "TOUR_CANCELLED") {
    throw new Error("BOOKING_CANCELLATION_FAILED");
  }

  const bookingRow = await store.get(
    "bookings", bookingId(inviteeId)
  );

  if (!bookingRow ||
      bookingRow.value.status !== "cancelled" ||
      bookingRow.value.crmSyncStatus !== "completed") {
    throw new Error("BOOKING_CANCELLATION_PERSISTENCE_FAILED");
  }

  console.log("FIRESTORE_BOOKING_CANCELLATION_PASS");

  const repeatedCancel = await processBooking(crm, cancellation);

  if (repeatedCancel.status !== "duplicate") {
    throw new Error("CANCELLATION_IDEMPOTENCY_FAILED");
  }

  console.log("FIRESTORE_CANCELLATION_IDEMPOTENCY_PASS");
  console.log("CALENDLY_FIRESTORE_STAGING_TEST_PASS");
}

if (require.main === module) {
  main().catch(error => {
    console.error("CALENDLY_FIRESTORE_STAGING_TEST_FAILED");
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
