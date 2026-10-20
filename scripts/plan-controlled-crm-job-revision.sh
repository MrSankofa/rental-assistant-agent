#!/usr/bin/env bash
set -euo pipefail
# Read-only preparation. This script NEVER deploys or executes a Cloud Run job.
PROJECT=altruistic-platform
REGION=us-east5
JOB=rental-crm-email-test-staging
BRANCH=feature/crm-platform-mvp
fail() { echo "CRM REVISION PREFLIGHT FAILED: $*" >&2; exit 1; }
if [[ $# -ne 1 ]]; then fail "use --plan or --preflight"; fi
case "$1" in
  --plan)
    cat <<'PLAN'
PLAN ONLY — NO CLOUD MUTATIONS.
Existing job: rental-crm-email-test-staging (altruistic-platform/us-east5).
Preflight: verify clean feature branch and live existing job's identity, image,
command, environment, service account, task count, parallelism and retries.
Approved future revision proposal:
  - Build source from reviewed feature branch.
  - Keep command /cnb/lifecycle/launcher.
  - Keep args node scripts/send-controlled-crm-email-test.js.
  - Keep CRM_EMAIL_TEST_ENABLED=false and CRM_DATABASE=rental-email-staging.
  - Preserve project, region, service account, one task, one worker,
    zero retries and 120-second timeout.
  - No secrets, IAM mutations, scheduler, job execution or actual email.
  - Include scripts/check-firestore-write-access.js in the new container image.
  - Verify live revision before separately approving a read-only probe.
NO deploy command is implemented here. A separate explicit approval and
reviewed update command are required to change the existing Cloud Run job.
PLAN
    exit 0 ;;
  --preflight) ;;
  *) fail "use --plan or --preflight" ;;
esac
command -v git >/dev/null || fail "git required"
command -v gcloud >/dev/null || fail "gcloud required"
command -v node >/dev/null || fail "node required"
ROOT="$(git rev-parse --show-toplevel)" || fail "not in Git repository"
cd "$ROOT"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "wrong branch"
[[ -z "$(git status --porcelain)" ]] || fail "dirty working tree"
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] ||
  fail "HEAD does not match fetched origin"
[[ -f scripts/check-firestore-write-access.js ]] || fail "write probe missing"
gcloud run jobs describe "$JOB" --project="$PROJECT" --region="$REGION" --format=json |
  node scripts/verify-existing-controlled-crm-job.js ||
  fail "existing job differs from reviewed configuration"
echo "READ-ONLY PREFLIGHT PASS; no deployment or job execution occurred."
