#!/usr/bin/env bash
set -euo pipefail
# Only staging, only fictional @example.test recipients, no email transport.
if [[ "$(git branch --show-current)" != "feature/crm-platform-mvp" ]]; then
  echo "Wrong branch" >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Review uncommitted changes before deploying" >&2; exit 1
fi
gcloud run jobs deploy rental-followups-staging \
  --source=. \
  --region=us-east5 \
  --project=altruistic-platform \
  --service-account=rental-assistant-staging-run@altruistic-platform.iam.gserviceaccount.com \
  --command=/cnb/lifecycle/launcher \
  --args=node,scripts/followups-job.js \
  --set-env-vars="CRM_BACKEND=firestore,CRM_SCOPE=rental-staging,GOOGLE_CLOUD_PROJECT=altruistic-platform,CRM_FOLLOWUPS_JOB_ENABLED=true,CRM_AUTONOMY_SIMULATION=true" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=120s \
  --memory=512Mi
echo "Staging job only updated. Fictional simulation ON; live email sending OFF."
