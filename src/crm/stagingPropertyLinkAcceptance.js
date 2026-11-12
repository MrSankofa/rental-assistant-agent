"use strict";
// Isolated fictional staging UI acceptance. Cloud Run IAM and preview-origin
// restrictions still apply. This is NOT a production staff authorization path.
function enabled(env) {
 return env.K_SERVICE==="rental-assistant-staff-staging" &&
  env.CRM_STAFF_ENABLED==="true" &&
  env.CRM_BACKEND==="firestore" &&
  env.GOOGLE_CLOUD_PROJECT==="altruistic-platform" &&
  env.CRM_SCOPE==="rental-staging" &&
  env.CRM_DATABASE==="rental-email-staging" &&
  env.CRM_DELIVERY_MODE==="disabled" &&
  env.CRM_PRODUCTION_EMAIL_ENABLED==="false" &&
  env.PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED==="true" &&
  !env.FIRESTORE_EMULATOR_HOST &&
  typeof env.PUBLIC_ORIGIN==="string" &&
  /^https:\/\/8080-cs-[0-9]+-default\.cs-[a-z0-9-]+\.cloudshell\.dev$/.test(env.PUBLIC_ORIGIN);
}
module.exports={enabled};
