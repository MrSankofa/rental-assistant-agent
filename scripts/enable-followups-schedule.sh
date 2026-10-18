#!/usr/bin/env bash
set -euo pipefail
# Enable a single hourly Cloud Scheduler trigger ONLY for fictional staging follow-ups.
project="altruistic-platform"
region="us-east5"
job="rental-followups-staging"
scheduler_sa="rental-followups-scheduler@altruistic-platform.iam.gserviceaccount.com"
schedule_name="rental-followups-hourly-staging"
gcloud run jobs describe "$job" --project="$project" --region="$region" >/dev/null
if ! gcloud iam service-accounts describe "$scheduler_sa" --project="$project" >/dev/null 2>&1; then
 gcloud iam service-accounts create rental-followups-scheduler \
   --display-name="Staging Follow-ups Scheduler" --project="$project"
fi
gcloud run jobs add-iam-policy-binding "$job" --project="$project" --region="$region" \
  --member="serviceAccount:$scheduler_sa" --role="roles/run.invoker" >/dev/null
gcloud services enable cloudscheduler.googleapis.com --project="$project"
url="https://run.googleapis.com/v2/projects/$project/locations/$region/jobs/$job:run"
if gcloud scheduler jobs describe "$schedule_name" --project="$project" --location="$region" >/dev/null 2>&1; then
 echo "Scheduler already exists. Not modifying its configuration."
else
 gcloud scheduler jobs create http "$schedule_name" \
   --project="$project" --location="$region" \
   --schedule="0 * * * *" --time-zone="America/Detroit" \
   --uri="$url" --http-method=POST \
   --oauth-service-account-email="$scheduler_sa" \
   --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"
fi
echo "Hourly staging scheduler configured. Follow-ups create staff tasks only, never send emails or texts."
