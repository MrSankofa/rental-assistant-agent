"use strict";

const {verifyIapIdentity} = require("../http/iapIdentity");
const {LeaseTemplateObjectStorage} = require("./leaseTemplateObjectStorage");
const {LeaseDraftObjectStorage} = require("./leaseDraftObjectStorage");
const {LeaseOwnerDraftService} = require("./leaseOwnerDraftService");
const {LeaseOwnerReviewWorkflow} = require("./leaseOwnerReviewWorkflow");

const STAGING_BUCKET = "altruistic-platform-lease-templates-staging";
const STAGING_AUDIENCE = "/projects/951837038410/locations/us-east5/services/rental-assistant-staff-staging";

function enabled(env, crm) {
  return Boolean(crm && crm.store &&
    env.LEASE_OWNER_WORKFLOW_ENABLED === "true" &&
    env.K_SERVICE === "rental-assistant-staff-staging" &&
    env.CRM_STAFF_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_DATABASE === "rental-email-staging" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.LEASE_OWNER_BUCKET === STAGING_BUCKET &&
    typeof env.LEASE_OWNER_EMAIL === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.LEASE_OWNER_EMAIL) &&
    typeof env.CRM_STAFF_ALLOWED_EMAILS === "string" &&
    env.CRM_STAFF_ALLOWED_EMAILS.split(",").map(v=>v.trim().toLowerCase())
      .includes(env.LEASE_OWNER_EMAIL.toLowerCase()) &&
    !env.FIRESTORE_EMULATOR_HOST);
}

function makeWorkflow({crm, env, bucket, verifyIdentity = verifyIapIdentity}) {
  if (!enabled(env, crm)) throw new Error("Lease owner workflow disabled");
  if (!bucket || typeof bucket.file !== "function") throw new Error("Private GCS bucket required");
  const verifyActor = assertion => verifyIdentity(assertion, {
    allowedEmails: env.CRM_STAFF_ALLOWED_EMAILS,
    audience: STAGING_AUDIENCE
  });
  const authorizeOwner = async ({actor, propertyId}) =>
    ["ziegler","virginia"].includes(propertyId) &&
    actor?.email?.toLowerCase() === env.LEASE_OWNER_EMAIL.toLowerCase();
  const preparer = new LeaseOwnerDraftService({
    store: crm.store,
    objects: new LeaseTemplateObjectStorage(bucket),
    verifyActor, authorizeOwner
  });
  return new LeaseOwnerReviewWorkflow({
    store:crm.store,
    objects:new LeaseDraftObjectStorage(bucket),
    preparer, verifyActor, authorizeOwner,
    loadEngagement:async ({engagementId}) => crm.history(engagementId)
  });
}
module.exports = {enabled, makeWorkflow, STAGING_BUCKET, STAGING_AUDIENCE};
