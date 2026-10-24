# Staff CRM and staged follow-ups

## Scope and safeguards

This milestone builds a **private, fictional-data-only staging CRM**. Contact and engagement records persist in Firestore under `scopes/rental-staging`. No tenant data is copied to it, and no outbound email or SMS is sent.

- Public chat staging: `rental-assistant-staging`, feature-gated fictional contact form only.
- Staff staging: `rental-assistant-staff-staging`, separate **Cloud Run IAM-private service**, `/staff` dashboard. The application accepts staff actions only on this named service and `rental-staging` scope.
- Scheduler: `rental-followups-staging` one-off Cloud Run Job. When enabled, Cloud Scheduler invokes it hourly. It creates deduplicated internal review tasks with safe draft text and `pending-approval` status, **not messages**.
- Production `rental-assistant` remains unchanged.

## Deployment

Cloud Shell must have the `feature/crm-platform-mvp` branch checked out, tests passing, and no uncommitted changes. Configure `STAFF_PREVIEW_ORIGIN` as the exact HTTPS origin of your Cloud Shell port-8080 preview (no trailing slash). For example:

```bash
cd ~/rental-assistant-staging
git pull --ff-only origin feature/crm-platform-mvp
npm test && npm run build
export STAFF_PREVIEW_ORIGIN="https://8080-cs-1052145169010-default.cs-us-east1-rtep.cloudshell.dev"
bash scripts/deploy-crm-staging.sh
```

This deploys a private staff service and a Cloud Run Job **without executing the job or scheduling it**.

Use a Cloud Shell terminal to run:

```bash
gcloud run services proxy rental-assistant-staff-staging \
  --region=us-east5 --project=altruistic-platform --port=8080
```

Open Cloud Shell Web Preview on port 8080 and navigate to `/staff`. For the staff proxy, stop the chat proxy first if it already occupies port 8080. An anonymous direct call to `https://rental-assistant-staff-staging-951837038410.us-east5.run.app/api/staff/dashboard` should yield HTTP 403.

The dashboard shows contacts and engagements, limited staff-confirmed tour stage actions, and review tasks. Staff can approve and complete internal tasks. Approval **does not send** any communication.

## First scheduler execution

```bash
gcloud run jobs execute rental-followups-staging \
  --region=us-east5 --project=altruistic-platform --wait
gcloud logging read \
 'resource.type="cloud_run_job" AND resource.labels.job_name="rental-followups-staging" AND textPayload:"FOLLOWUPS_PASS"' \
 --project=altruistic-platform --freshness=1h --limit=10 --format="value(textPayload)"
```

For new inquiries less than 24 hours old, `created:0` is normal. When a `CONTACT_CAPTURED` engagement reaches 24 hours, a follow-up task is generated. `TOUR_OFFERED` waits 48 hours; `APPLICATION_INVITED` waits 72 hours. Repeated runs do not duplicate a task for the same stage transition.

After manual execution succeeds, enable an **hourly** Cloud Scheduler trigger:

```bash
bash scripts/enable-followups-schedule.sh
```

This provisions a dedicated Scheduler service account and permission to invoke the staging job. Cloud Scheduler, Cloud Run and Firestore usage may be billable.

## Production gate

Do not deploy `CRM_STAGING_TEST_MODE` or `CRM_STAFF_ENABLED` into the public chatbot. Real-tenant collection is not live. A production release requires staff identity authorization, confirmed retention/deletion policy, opt-in language review, rate-limit hardening and a tested sending provider with consent and opt-out enforcement before outbound communication. Do not merge the full CRM draft PR directly into the live production chatbot.
