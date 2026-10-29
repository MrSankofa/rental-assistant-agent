"use strict";

const { dispatchCalendlyWebhook } =
  require("../crm/calendlyDispatcher");
const { makeCalendlyApi } =
  require("../crm/calendlyApi");
const { makeCalendlyCandidateLookup } =
  require("../crm/calendlyCandidates");

const EXPECTED_DATABASE = "rental-email-staging";
const EXPECTED_PROJECT = "altruistic-platform";
const EXPECTED_SCOPE = "rental-staging";

const EVENT_TYPE =
  "https://api.calendly.com/event_types/" +
  "dee239b2-15fd-44b2-a343-f41e9ce2488e";

const HOST =
  "https://api.calendly.com/users/" +
  "3cf40dec-d274-4901-84af-89910edd3640";

function enabled(env, crm) {
  return Boolean(
    crm &&
    env.CALENDLY_WEBHOOK_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.GOOGLE_CLOUD_PROJECT === EXPECTED_PROJECT &&
    env.CRM_DATABASE === EXPECTED_DATABASE &&
    env.CRM_SCOPE === EXPECTED_SCOPE &&
    env.CALENDLY_API_TOKEN?.length >= 16 &&
    env.CALENDLY_WEBHOOK_SIGNING_KEY?.length >= 16 &&
    !env.FIRESTORE_EMULATOR_HOST
  );
}

async function readRawBody(req, maxBytes = 65536) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > maxBytes) {
      const error = new Error("Payload too large");
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function handleCalendlyWebhook({ req, crm, env = process.env }) {
  if (!enabled(env, crm)) {
    return { statusCode: 404, body: { error: "Not found" } };
  }

  try {
    const rawBody = await readRawBody(req);
    const signatureHeader =
      req.headers["calendly-webhook-signature"];

    const api = makeCalendlyApi({
      token: env.CALENDLY_API_TOKEN
    });

    const writeSwitchEnabled =
      env.CALENDLY_CRM_WRITES_ENABLED === "true";

    const allowedEmailHash =
      env.CALENDLY_CRM_WRITE_EMAIL_SHA256 || "";

    // Fail closed: no writes without a valid test-email allowlist.
    const matchedWritesEnabled =
      env.CALENDLY_CRM_MATCHED_WRITES_ENABLED === "true";

    // Both switches must be enabled for general matched-prospect writes.
    // The original single-email allowlist remains the safer test mode.
    const writesEnabled = writeSwitchEnabled &&
      (matchedWritesEnabled ||
       /^[a-f0-9]{64}$/.test(allowedEmailHash));

    const result = await dispatchCalendlyWebhook({
      crm,
      rawBody,
      signatureHeader,
      signingKey: env.CALENDLY_WEBHOOK_SIGNING_KEY,
      expectedEventTypeUri: EVENT_TYPE,
      expectedHostUri: HOST,
      fetchProviderResources: api.fetchProviderResources,
      loadCrmCandidates: makeCalendlyCandidateLookup(crm),

      // Only the explicitly allowlisted staging prospect can be changed.
      writesEnabled,
      allowedEmailHash,
      matchedWritesEnabled: writeSwitchEnabled && matchedWritesEnabled
    });

    return {
      statusCode: 202,
      body: {
        received: true,
        status: result.status,
        crmUpdated: result.crmUpdated === true
      }
    };
  } catch (error) {
    if (error.status === 401) {
      return {
        statusCode: 401,
        body: { error: "Invalid signature" }
      };
    }

    if (error.status === 400 || error.status === 413) {
      return {
        statusCode: error.status,
        body: { error: "Invalid webhook request" }
      };
    }

    // Never expose Calendly tokens, CRM records, or internal errors.
    return {
      statusCode: 503,
      body: { error: "Webhook verification unavailable" }
    };
  }
}

module.exports = {
  handleCalendlyWebhook,
  calendlyWebhookEnabled: enabled
};
