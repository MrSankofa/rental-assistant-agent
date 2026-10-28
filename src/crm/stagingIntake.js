"use strict";

// Temporary private-staging form gate. Never enable for a production Cloud Run service.
function stagingIntakeEnabled(env, crmConfigured) {
  return Boolean(
    crmConfigured &&
    env.K_SERVICE === "rental-assistant-staging" &&
    env.CRM_STAGING_TEST_MODE === "true" &&
    env.CRM_PUBLIC_INTAKE_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === "rental-email-staging" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    typeof env.PUBLIC_ORIGIN === "string" &&
    /^https:\/\/[a-z0-9.-]+\.cloudshell\.dev$/.test(env.PUBLIC_ORIGIN)
  );
}

function requireStagingOrigin(origin, allowedOrigin) {
  return typeof origin === "string" && origin === allowedOrigin;
}

function normalizePhone(value) {
  return typeof value === "string"
    ? value.trim().replace(/[\s().+-]/g, "")
    : "";
}

function validateFictionalIntake(data) {
  const bad = () => Object.assign(
    new Error("Staging accepts fictional sample data only. Use the provided .test example or a 555-01xx test phone number."),
    { status: 400 }
  );

  if (!data || typeof data !== "object") throw bad();

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string"
    ? data.email.trim().toLowerCase()
    : "";
  const phone = normalizePhone(data.phone);

  if (!/^Fictional(?: [A-Za-z]{2,25}){1,3}$/.test(name)) throw bad();
  if (!email && !phone) throw bad();

  if (email &&
      !/^[a-z0-9._+-]{3,50}@example\.test$/.test(email)) {
    throw bad();
  }

  // NANP 555-0100 through 555-0199 are used here as fictional test numbers.
  if (phone &&
      !/^(?:1)?[2-9][0-9]{2}55501[0-9]{2}$/.test(phone)) {
    throw bad();
  }

  if (data.domain !== "rental" ||
      data.targetId !== "ziegler" ||
      !["Tour inquiry", "Human follow-up", "Application information", "General property question"].includes(data.interest) ||
      !data.consent ||
      data.consent.recording !== true ||
      data.consent.email !== false ||
      data.consent.sms !== false) {
    throw bad();
  }

  return {
    ...data,
    name,
    email,
    phone,
    preferredChannel: email ? "email" : "none",
    source: "private-staging-form"
  };
}

module.exports = { stagingIntakeEnabled, requireStagingOrigin, validateFictionalIntake };
