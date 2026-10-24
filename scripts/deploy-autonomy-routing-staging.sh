#!/usr/bin/env bash
set -euo pipefail
# Deploy ONLY the staging follow-up job; leave staff service, scheduler and production alone.
project="altruistic-platform"
region="us-east5"
service_account="rental-assistant-staging-run@altruistic-platform.iam.gserviceaccount.com"
if [[ "$(git branch --show-current)" != "feature/crm-platform-mvp" ]]; then
  echo "Refusing deployment outside feature/crm-platform-mvp" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes detected; review git status before deploying" >&2
  exit 1
fi
echo "Deploying isolated staging follow-up job at $(git rev-parse --short HEAD)"
gcloud run jobs deploy rental-followups-staging \
  --source=. \
  --region="$region" \
  --project="$project" \
  --service-account="$service_account" \
  --command=/cnb/lifecycle/launcher \
  --args=node,scripts/followups-job.js \
  --set-env-vars="CRM_BACKEND=firestore,CRM_SCOPE=rental-staging,GOOGLE_CLOUD_PROJECT=altruistic-platform,CRM_FOLLOWUPS_JOB_ENABLED=true" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=120s \
  --memory=512Mi
echo "Only staging follow-up job updated. Automatic email delivery is NOT enabled."
