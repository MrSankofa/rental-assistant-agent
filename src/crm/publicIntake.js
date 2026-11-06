"use strict";

const {stagingIntakeEnabled, validateFictionalIntake} = require("./stagingIntake");
const {realIntakeEnabled, validateRealRentalIntake} = require("./realIntake");
const {turnstileConfigured,verifyRealInquiry} = require("../http/turnstile");
const {offerStagingShowing}=require("./stagingShowingHandoff");

const crypto = require("crypto");

// Called only after the real inquiry has passed validation,
// Turnstile verification, and durable CRM intake.
async function offerRealTour(crm, validated) {
  if (validated.interest !== "Tour inquiry" ||
      validated.targetId !== "ziegler" ||
      !validated.email ||
      crm.scope !== "rental-live") return;

  const hash = value => crypto.createHash("sha256")
    .update(value).digest("hex").slice(0, 40);

  const contactId = "c_" + hash(
    crm.scope + "|" + validated.email
  );
  const engagementId = "e_" + hash(
    contactId + "|rental|ziegler"
  );

  const contact = await crm.store.get("contacts", contactId);
  const engagement = await crm.store.get(
    "engagements", engagementId
  );

  if (!contact || !engagement ||
      contact.value.email !== validated.email ||
      engagement.value.contactId !== contactId ||
      engagement.value.domain !== "rental" ||
      engagement.value.targetId !== "ziegler") {
    throw Object.assign(
      new Error("Tour handoff requires staff review"),
      {status: 503}
    );
  }

  // Never rewind an existing booking or later lifecycle stage.
  if (engagement.value.stage !== "CONTACT_CAPTURED") return;

  try {
    await crm.transition(
      engagementId,
      {stage: "TOUR_OFFERED"},
      "verified-intake"
    );
  } catch (error) {
    const current = await crm.history(engagementId);
    if (!["TOUR_OFFERED", "TOUR_SCHEDULED"].includes(
      current.stage
    )) throw error;
  }
}

const httpError=(status,message)=>Object.assign(new Error(message),{status});

function intakeStatus(env, crmConfigured) {
  const staging = stagingIntakeEnabled(env, crmConfigured);
  const real = !staging && realIntakeEnabled(env, crmConfigured) && turnstileConfigured(env);
  return {
    publicIntakeEnabled: staging || real,
    stagingTestMode: staging,
    realIntakeEnabled: real,
    privacyUrl: real ? env.CRM_PRIVACY_URL : null,
    turnstileSiteKey: real ? env.CRM_TURNSTILE_SITE_KEY : null
  };
}

// Browser-originated JSON only; no CORS allowance. This is a CSRF barrier,
// not bot protection, authentication, or a replacement for edge rate limits.
function requireIntakeRequest(headers, origin) {
  if (!headers || typeof headers.origin !== "string" ||
      headers.origin !== origin ||
      (headers["sec-fetch-site"] &&
        !["same-origin","none"].includes(headers["sec-fetch-site"])) ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(
        String(headers["content-type"] || "")
      )) throw httpError(403,"Inquiry submission not permitted");
}

async function acceptPublicInquiry({env, crm, headers, body, lookupProperty, verify=verifyRealInquiry}) {
  const status=intakeStatus(env,Boolean(crm));
  if (!status.publicIntakeEnabled) throw httpError(503,"Public intake not enabled");
  requireIntakeRequest(headers,env.PUBLIC_ORIGIN);
  const validated=status.stagingTestMode
    ? validateFictionalIntake(body)
    : validateRealRentalIntake(body,lookupProperty);
  if (status.realIntakeEnabled) await verify({env,token:body.turnstileToken});
  const receipt=await crm.intake(validated,{origin:"public",actor:"prospect"});
  if(!status.stagingTestMode) {
    if(status.realIntakeEnabled) {
      await offerRealTour(crm,validated);
    }
    return receipt;
  }
  // Only fictional private staging offers a tour automatically. Never expose CRM IDs.
  // Intake is already durable: a failed handoff must remain a staff-reviewed inquiry.
  try {
    const nextSteps=await offerStagingShowing(crm,validated,lookupProperty);
    return nextSteps ? {...receipt,nextSteps} : receipt;
  } catch (_) {
    return receipt;
  }
}

module.exports={intakeStatus,requireIntakeRequest,acceptPublicInquiry,offerRealTour};
