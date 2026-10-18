#!/usr/bin/env bash
set -euo pipefail
# Deploy only to private, fictional-data CRM staging resources.
project="altruistic-platform"
region="us-east5"
sa="rental-assistant-staging-run@altruistic-platform.iam.gserviceaccount.com"
branch="$(git branch --show-current)"
if [[ "$branch" != "feature/crm-platform-mvp" ]]; then
  echo "Refusing deployment from $branch. Use feature/crm-platform-mvp." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing deployment with uncommitted changes." >&2
  exit 1
fi
if [[ -z "${STAFF_PREVIEW_ORIGIN:-}" ]] || [[ ! "$STAFF_PREVIEW_ORIGIN" =~ ^https://[a-zA-Z0-9.-]+\.cloudshell\.dev$ ]]; then
  echo "Set STAFF_PREVIEW_ORIGIN to your exact Cloud Shell preview origin (no trailing slash)." >&2
  exit 1
fi
echo "Deploying private staff staging service using $(git rev-parse --short HEAD)"
gcloud run deploy rental-assistant-staff-staging \
  --source=. \
  --region="$region" \
  --project="$project" \
  --service-account="$sa" \
  --no-allow-unauthenticated \
  --ingress=all \
  --set-env-vars="CRM_BACKEND=firestore,CRM_SCOPE=rental-staging,GOOGLE_CLOUD_PROJECT=altruistic-platform,CRM_STAFF_ENABLED=true,PUBLIC_ORIGIN=$STAFF_PREVIEW_ORIGIN" \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi
echo "Deploying isolated scheduler job (not executing it yet)"
gcloud run jobs deploy rental-followups-staging \
  --source=. \
  --region="$region" \
  --project="$project" \
  --service-account="$sa" \
  --command=/cnb/lifecycle/launcher \
  --args=node,scripts/followups-job.js \
  --set-env-vars="CRM_BACKEND=firestore,CRM_SCOPE=rental-staging,GOOGLE_CLOUD_PROJECT=altruistic-platform,CRM_FOLLOWUPS_JOB_ENABLED=true" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=120s \
  --memory=512Mi
echo "Deployments complete. Neither production nor scheduled automatic execution was changed."
