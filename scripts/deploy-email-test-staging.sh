#!/usr/bin/env bash
set -euo pipefail
# A dedicated manual staging smoke-test job. No CRM, no scheduler and no real send by default.
if [[ "$(git branch --show-current)" != "feature/crm-platform-mvp" ]]; then
  echo "Wrong branch" >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean" >&2; exit 1
fi
gcloud run jobs deploy rental-email-test-staging \
  --source=. \
  --region=us-east5 \
  --project=altruistic-platform \
  --service-account=rental-email-staging@altruistic-platform.iam.gserviceaccount.com \
  --command=/cnb/lifecycle/launcher \
  --args=node,scripts/send-controlled-email-test.js \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=altruistic-platform,EMAIL_TEST_MODE=staging-manual-only,EMAIL_TEST_ENABLED=false" \
  --set-secrets="RESEND_API_KEY=rental-assistant-resend-staging:1" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=120s \
  --memory=512Mi
echo "Dry-run email test deployed; actual email delivery remains disabled."
