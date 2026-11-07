"use strict";

// Real-lead intake is disabled by default and must never share the fictional staging DB.
// This module performs no I/O and grants no authority to send messages or book tours.
const DB = "rental-leads-prod";
const SCOPE = "rental-live";
const SERVICES = new Set(["rental-assistant", "rental-assistant-live-candidate"]);
const INTERESTS = new Set(["Tour inquiry", "Human follow-up", "Application information", "General property question"]);
const fail = () => Object.assign(new Error("Invalid rental inquiry"), { status: 400 });

function trustedHttps(value, exactHost) {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === exactHost &&
      !u.username && !u.password && !u.port && !u.search && !u.hash;
  } catch (_) { return false; }
}

function realIntakeEnabled(env, crmConfigured) {
  return Boolean(
    crmConfigured &&
    SERVICES.has(env.K_SERVICE) &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === DB &&
    env.CRM_SCOPE === SCOPE &&
    env.CRM_PUBLIC_INTAKE_ENABLED === "true" &&
    env.CRM_REAL_INTAKE_ENABLED === "true" &&
    env.CRM_STAGING_TEST_MODE !== "true" &&
    env.CRM_STAFF_ENABLED !== "true" &&
    env.CRM_DELIVERY_MODE !== "simulation" &&
    !env.FIRESTORE_EMULATOR_HOST &&
    typeof env.PUBLIC_ORIGIN === "string" &&
    /^https:\/\/[a-z0-9.-]+$/.test(env.PUBLIC_ORIGIN) &&
    (trustedHttps(env.PUBLIC_ORIGIN, "altruisticdevelopment.com") ||
      trustedHttps(env.PUBLIC_ORIGIN, "www.altruisticdevelopment.com") ||
      (new URL(env.PUBLIC_ORIGIN).hostname.endsWith(".run.app"))) &&
    trustedHttps(env.CRM_PRIVACY_URL, "altruisticdevelopment.com") &&
    new URL(env.CRM_PRIVACY_URL).pathname === "/privacy/"
  );
}

function validateRealRentalIntake(input, getPropertyInformation) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail();

  const name = typeof input.name === "string"
    ? input.name.trim().replace(/ +/g, " ")
    : "";

  const email = typeof input.email === "string"
    ? input.email.trim().toLowerCase()
    : "";

  const phone = typeof input.phone === "string"
    ? input.phone.trim().replace(/[\s().-]/g, "")
    : "";

  const interest = input.interest;
  const consent = input.consent;

  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,79}$/u.test(name) ||
      (!email && !phone) ||
      (email && !/^[^\s@<>]{1,64}@[^\s@<>]{1,189}$/.test(email)) ||
      email.length > 254 ||
      (phone && !/^\+?[0-9]{10,15}$/.test(phone)) ||
      !INTERESTS.has(interest) ||
      input.domain !== "rental" ||
      input.targetId !== "ziegler" ||
      !consent ||
      consent.recording !== true ||
      typeof consent.email !== "boolean" ||
      (consent.email === true && !email) ||
      consent.sms !== false ||
      typeof getPropertyInformation !== "function") {
    throw fail();
  }

  const found = getPropertyInformation("ziegler");

  if (found?.found !== true || found.property?.available !== true) {
    throw Object.assign(
      new Error("Rental inquiries are unavailable"),
      {status:409}
    );
  }

  return {
    name,
    email,
    phone,
    preferredChannel: email ? "email" : "none",
    domain:"rental",
    targetId:"ziegler",
    interest,
    source:"rental-assistant-live-form",
    consent:{
      recording:true,
      email:consent.email,
      sms:false
    }
  };
}

module.exports = { DB, SCOPE, realIntakeEnabled, validateRealRentalIntake };
