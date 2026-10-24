"use strict";
// Manually authorized, one-shot fictional CRM-to-Firestore staging probe.
// Never imported by public services, schedulers, or the Resend sender.
const { randomUUID } = require("node:crypto");
const { CRM } = require("../src/crm/workflows");
const { FirestoreStore } = require("../src/crm/storage");
const { generateFollowupTasks } = require("../src/crm/followups");
const { dispatchMockFollowup } = require("../src/crm/stagingDeliveryIntegration");

const REQUIRED = Object.freeze({
  CLOUD_RUN_JOB: "rental-crm-email-test-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CRM_EMAIL_TEST_ENABLED: "false",
  CRM_E2E_PROBE_APPROVAL: "VERIFY_STAGING_CRM_E2E"
});
const COLLECTIONS = Object.freeze(["contacts", "engagements", "interactions", "tasks", "audits"]);
const ALLOWED = new Set(COLLECTIONS);

function validate(env) {
  for (const [key, value] of Object.entries(REQUIRED)) {
    if (env[key] !== value) throw Error("CRM E2E probe unauthorized");
  }
  if (env.RESEND_API_KEY || env.CRM_EMAIL_TEST_APPROVAL || env.CRM_WRITE_PROBE_APPROVAL ||
      env.FIRESTORE_EMULATOR_HOST || env.CRM_EMAIL_TEST_TO || env.CRM_EMAIL_TEST_TASK_ID) {
    throw Error("CRM E2E probe unauthorized");
  }
}
function probeScope(uuid) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uuid)) {
    throw Error("Invalid CRM E2E probe ID");
  }
  // Maximum 40 characters, valid for FirestoreStore scope validation.
  return "crm-e2e-" + uuid.replace(/-/g, "");
}
function trackWrites(store, scope) {
  const attempted = [];
  const create = store.create.bind(store);
  const replace = store.replace.bind(store);
  store.create = async (collection, id, value) => {
    if (!ALLOWED.has(collection) || !/^[a-zA-Z0-9_-]{8,120}$/.test(id) ||
        !value || typeof value !== "object" || value.id !== id) {
      throw Error("Unexpected CRM E2E write");
    }
    // Unacknowledged creates remain ambiguous, even if immediate reads return 404.
    const attempt = { collection, id, confirmed: false };
    attempted.push(attempt); // Record BEFORE attempting the network write.
    const created = await create(collection, id, { ...value, e2eProbeScope: scope });
    if (!created) throw Error("CRM E2E document collision");
    attempt.confirmed = true;
    return created;
  };
  store.replace = async (collection, id, value, version) => {
    if (!ALLOWED.has(collection) || value?.id !== id || value.e2eProbeScope !== scope) {
      throw Error("Unexpected CRM E2E update");
    }
    return replace(collection, id, value, version);
  };
  return attempted;
}
async function deleteDocument({ store, collection, id, version }) {
  const url = store.path(collection, id) +
    "?currentDocument.updateTime=" + encodeURIComponent(version);
  const response = await store.fetchFn(url, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + await store.bearer() }
  });
  if (response.status !== 200) throw Error("CRM E2E delete unconfirmed");
}
async function cleanup({ store, attempted, scope, deleteFn = deleteDocument }) {
  // Do not certify cleanup after an ambiguous create, even if records look absent.
  let failed = attempted.some(attempt => attempt.confirmed !== true);
  const visited = new Set();
  for (const { collection, id } of [...attempted].reverse()) {
    const key = collection + "/" + id;
    if (visited.has(key)) continue;
    visited.add(key);
    try {
      const row = await store.get(collection, id);
      if (!row) continue;
      if (row.value?.e2eProbeScope !== scope || row.value.id !== id || !row.version) {
        failed = true;
        continue; // Never delete a record with an unexpected identity.
      }
      await deleteFn({ store, collection, id, version: row.version });
      if (await store.get(collection, id)) failed = true;
    } catch (_) {
      failed = true; // No automatic retry after ambiguous writes or deletes.
    }
  }
  // Verify that no untracked document remains in the isolated namespace.
  for (const collection of COLLECTIONS) {
    try {
      if ((await store.list(collection, 200)).length !== 0) failed = true;
    } catch (_) { failed = true; }
  }
  if (failed) throw Error("CRM E2E cleanup requires manual reconciliation");
}
async function run({
  env = process.env,
  uuid = randomUUID,
  storeFactory = scope => new FirestoreStore({
    projectId: "altruistic-platform", databaseId: "rental-email-staging", scope
  }),
  deleteFn = deleteDocument,
  log = console.log
} = {}) {
  validate(env); // Fail closed BEFORE accessing credentials or Firestore.
  const scope = probeScope(uuid());
  const store = storeFactory(scope);
  if (!store || typeof store.create !== "function" || typeof store.get !== "function" ||
      typeof store.list !== "function" || typeof store.replace !== "function") {
    throw Error("CRM E2E store unavailable");
  }
  const attempted = trackWrites(store, scope);
  const crm = new CRM(store, "rental-staging");
  let verified = false;
  let cleaned = false;
  log("CRM_E2E_PROBE_SCOPE", scope);
  try {
    // A brand-new run-specific namespace must be empty; never adopt existing data.
    for (const collection of COLLECTIONS) {
      if ((await store.list(collection, 200)).length !== 0) {
        throw Error("CRM E2E namespace not empty");
      }
    }
    const email = "fictional-" + scope.slice(8) + "@example.test";
    const response = await crm.intake({
      name: "Fictional CRM Integration",
      email, phone: "", preferredChannel: "email",
      domain: "rental", targetId: "ziegler",
      source: "isolated-crm-e2e-probe", interest: "Tour inquiry",
      consent: { recording: true, email: true, sms: false }
    }, { origin: "public" });
    if (response?.received !== true) throw Error("CRM E2E intake unsuccessful");
    const engagements = await crm.listEngagements();
    if (engagements.length !== 1 || engagements[0].stage !== "CONTACT_CAPTURED" ||
        engagements[0].e2eProbeScope !== scope) {
      throw Error("CRM E2E engagement mismatch");
    }
    const now = new Date(Date.parse(engagements[0].updatedAt) + 25 * 3600000);
    const followups = await generateFollowupTasks(crm, { now });
    const tasks = await crm.listTasks();
    if (followups.created !== 1 || tasks.length !== 1 ||
        tasks[0].status !== "ready-for-automatic-delivery" ||
        tasks[0].e2eProbeScope !== scope) {
      throw Error("CRM E2E follow-up mismatch");
    }
    let mockCalls = 0;
    const result = await dispatchMockFollowup(crm, tasks[0].id, {
      env: { CRM_DELIVERY_INTEGRATION_MODE: "mock", CRM_SCOPE: "rental-staging" },
      now,
      transport: async message => {
        if (message.to !== email || message.idempotencyKey !== "rental-" + tasks[0].id) {
          throw Error("CRM E2E unexpected mock recipient");
        }
        mockCalls++;
        return { status: "accepted", providerId: "fake-crm-e2e-receipt" };
      }
    });
    const saved = await store.get("tasks", tasks[0].id);
    if (result.outcome !== "accepted" || mockCalls !== 1 ||
        saved?.value?.status !== "delivery-accepted" ||
        saved.value.delivery?.providerId !== "fake-crm-e2e-receipt") {
      throw Error("CRM E2E mocked delivery not verified");
    }
    verified = true;
    log("CRM_E2E_WORKFLOW_VERIFIED");
  } catch (_) {
    log("CRM_E2E_WORKFLOW_FAILED");
  }
  try {
    await cleanup({ store, attempted, scope, deleteFn });
    cleaned = true;
    log("CRM_E2E_CLEANUP_OK");
  } catch (_) {
    log("CRM_E2E_MANUAL_RECONCILIATION_REQUIRED", scope);
  }
  if (!verified || !cleaned) throw Error("CRM E2E probe inconclusive");
  log("CRM_E2E_VERIFIED");
  return { verified: true, cleaned: true };
}
if (require.main === module) {
  run().catch(() => {
    console.error("CRM_E2E_FAILED");
    process.exitCode = 1;
  });
}
module.exports = { run, validate, probeScope, trackWrites, cleanup, deleteDocument };
