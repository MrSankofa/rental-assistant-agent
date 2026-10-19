# Manual CRM-to-Resend staging checkpoint (code-only)

**Status:** GitHub code and Jest tests only. No Cloud Run job deployment, scheduled invocation, real email or tenant data is authorized by this document.

## Scope

- Feature branch: `feature/crm-platform-mvp`.
- Entrypoint: `scripts/send-controlled-crm-email-test.js`.
- Fixture preparer: `src/crm/controlledResendFixture.js`.
- The only authorized recipient is the existing owner-controlled test inbox, defined in `controlledResendIntegration.js`.
- The fixture's contact, engagement and deterministic follow-up task use staging scope `rental-staging`. The fixture intentionally uses a fictional identity but the owner's real inbox for an eventual owner-approved delivery.
- Existing `rental-followups-staging` scheduler and `rental-assistant` production service are not modified or authorized to send.

## Execution model

1. Without `CRM_EMAIL_TEST_ENABLED=true`, the entrypoint permits only a **dry-run**, with no CRM datastore access and no Resend network call. It still checks project, job, backend and scope.
2. Enabled execution requires all checks together: exact isolated `CLOUD_RUN_JOB`, GCP project, Firestore backend, staging scope, approval phrase, owner recipient, and the exact deterministic fixture task ID.
3. The fixture preparer refuses collisions with any record not bearing the expected staging fixture identity. It must never overwrite or adopt genuine tenant records.
4. Existing task status cannot be reset. Reserved, accepted and reconciliation-required tasks remain locked against automatic repeat delivery.
5. The CRM integration rechecks policy, stage, email consent, snapshot and outbox fingerprint before contacting Resend, and returns a provider ID when accepted.

## Before any deployment (separate approval required)

- Verify fresh CI, Node/Jest unit tests, and clean checkout.
- Review staging Firestore access boundaries for the dedicated service account, and use **secret-level** Secret Manager access only for that account.
- Verify collision checks against the staging dataset without printing sensitive records.
- Confirm the intended Cloud Run job has no scheduler trigger, has one task, zero retries, and defaults to `CRM_EMAIL_TEST_ENABLED=false`.
- Inspect the fixture timestamp's 30-day window. If it expires, replace it through reviewed code and test changes, never bypass the expiry guard.
- Obtain separate approval to deploy the job, then **another explicit approval** for one real email to the specified owner inbox. Code-only approval is not permission to send.

## Reconciliation and residual limitations

- A provider timeout might occur after Resend accepts the email. Do not automatically retry. Inspect provider delivery status and CRM task state manually.
- Firestore commit/CRM audit errors can result in a reserved task whose final delivery state is not yet known.
- Consent or recipient could still change after the final CRM check and before the HTTP request. Future work should design an operational cancellation boundary and document the inherent distributed-system race.
- A success log means provider acceptance, **not** proof of inbox delivery or inbound reply processing.
- The fixture setup itself changes Firestore when invoked with enabled authorization. Do not execute the entrypoint against staging until deployment and execution have been explicitly approved.

## Test commands

```bash
npm test -- src/crm/controlledResendIntegration.test.js scripts/send-controlled-crm-email-test.test.js
npm test
npm run build
```

All Jest network transports are mocked. No cloud credentials or live Resend API calls are required by these tests.
