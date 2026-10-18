#!/usr/bin/env bash
set -euo pipefail
# Isolated, fiction-only human-approved messaging demo. Does not change production or scheduled jobs.
if [[ "$(git branch --show-current)" != "feature/crm-platform-mvp" ]]; then
  echo "Wrong branch: use feature/crm-platform-mvp" >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Local changes detected; review git status before deploying" >&2; exit 1
fi
if [[ ! "${STAFF_PREVIEW_ORIGIN:-}" =~ ^https://[a-zA-Z0-9.-]+\.cloudshell\.dev$ ]]; then
  echo "Set STAFF_PREVIEW_ORIGIN to the exact Cloud Shell preview origin" >&2; exit 1
fi
gcloud run deploy rental-assistant-staff-staging \
  --source=. --region=us-east5 --project=altruistic-platform \
  --service-account=rental-assistant-staging-run@altruistic-platform.iam.gserviceaccount.com \
  --no-allow-unauthenticated --ingress=all \
  --set-secrets=OPENAI_API_KEY=openai-api-key:latest \
  --set-env-vars="CRM_BACKEND=firestore,CRM_SCOPE=rental-staging,GOOGLE_CLOUD_PROJECT=altruistic-platform,CRM_STAFF_ENABLED=true,CRM_DELIVERY_MODE=simulation,CRM_AI_DRAFTS_ENABLED=true,PUBLIC_ORIGIN=$STAFF_PREVIEW_ORIGIN" \
  --min-instances=0 --max-instances=1 --memory=512Mi
echo "Private staff staging deployed with AI drafts and simulated sending only."
