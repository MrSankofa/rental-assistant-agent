#!/usr/bin/env bash
# Phase 22B final operations: full regression, reconcile closed booking,
# deploy ONLY read-only tour report job, verify final Firestore state.
# Never invokes or deploys an email sender.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="altruistic-platform"
REGION="us-east5"
BRANCH="feature/persistent-agent-phases-21-22"
REPORT="rental-prospect-tour-outbox-report-staging"
PLANNER="rental-prospect-tour-planner-staging"
test "$(gcloud config get-value project 2>/dev/null)" = "$PROJECT"
test "$(git branch --show-current)" = "$BRANCH"
test -z "$(git status --porcelain)"
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH)"
echo "===== PHASE22B FULL TEST SUITE ====="
npm test -- --runInBand
npm run check:startup
node --check src/crm/prospectTourOutboxReport.js
node --check src/crm/prospectTourOwnerEmail.js
echo "PHASE22B_FULL_REGRESSION_PASS"
echo "===== CANCEL UNUSED REVIEW TASK AFTER FICTIONAL BOOKING CLOSED ====="
gcloud run jobs execute "$PLANNER" --project="$PROJECT" --region="$REGION" --wait
python3 scripts/check-phase22b-final-acceptance.py
echo "===== UPDATE READ-ONLY OUTBOX REPORT ====="
gcloud run jobs deploy "$REPORT" \
  --source=. --project="$PROJECT" --region="$REGION" \
  --service-account="rental-assistant-web-staging@altruistic-platform.iam.gserviceaccount.com" \
  --command=/cnb/lifecycle/launcher \
  --args=node,scripts/prospect-tour-outbox-report-staging.js \
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=120s \
  --memory=512Mi --cpu=1 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT,CRM_BACKEND=firestore,CRM_DATABASE=rental-email-staging,CRM_SCOPE=rental-staging,CRM_DELIVERY_MODE=disabled,CRM_PRODUCTION_EMAIL_ENABLED=false,PROSPECT_TOUR_REPORT_APPROVAL=READ_ONLY_TOUR_OUTBOX_STAGING" \
  --quiet
echo "===== EXECUTE READ-ONLY STATUS REPORT ====="
gcloud run jobs execute "$REPORT" --project="$PROJECT" --region="$REGION" --wait
echo "PHASE22B_REPORT_JOB_EXECUTION_PASS"
echo "No email sender was executed by this script."
