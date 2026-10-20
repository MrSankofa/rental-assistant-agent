"use strict";
const {validate} = require("./check-firestore-access");
test("enforces isolated job and disabled email", () => {
 expect(() => validate({
  CLOUD_RUN_JOB: "rental-crm-email-test-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_SCOPE: "rental-staging",
  CRM_EMAIL_TEST_ENABLED: "false"
 })).not.toThrow();
 expect(() => validate({
  CLOUD_RUN_JOB: "rental-crm-email-test-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_SCOPE: "rental-staging",
  CRM_EMAIL_TEST_ENABLED: "true"
 })).toThrow("IAM probe environment not authorized");
});
