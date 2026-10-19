#!/usr/bin/env bash
set -euo pipefail

# Code-only preparation for an isolated, disabled-by-default CRM email Cloud Run Job.
# --plan makes NO Cloud API calls. --preflight is read-only. --deploy requires
# separate human authorization and never executes a job or grants IAM permissions.

PROJECT="altruistic-platform"
REGION="us-east5"
JOB="rental-crm-email-test-staging"
SERVICE_ACCOUNT="rental-email-staging@altruistic-platform.iam.gserviceaccount.com"
BRANCH="feature/crm-platform-mvp"
APPROVAL_PHRASE="DEPLOY_DISABLED_CRM_STAGING_JOB"

fail() { echo "CRM staging deployment refused: $*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Usage: bash scripts/deploy-controlled-crm-email-staging.sh --plan|--preflight|--deploy

  --plan       Print the disabled-job deployment configuration. No cloud calls.
  --preflight  Read-only checks of repository, identity and job absence.
  --deploy     Create the disabled job, only with an additional explicit approval
               in CRM_STAGING_DEPLOY_APPROVAL. Does NOT execute it.

This script never provisions IAM roles, mounts a Resend secret or sends email.
USAGE
}

if [[ $# -ne 1 ]]; then usage; exit 2; fi
MODE="$1"
case "$MODE" in
  --plan|--preflight|--deploy) ;;
  --help|-h) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

# Intentional approval barrier BEFORE any cloud operations.
if [[ "$MODE" == "--deploy" &&
      "${CRM_STAGING_DEPLOY_APPROVAL:-}" != "$APPROVAL_PHRASE" ]]; then
  fail "explicit approval required to deploy the disabled staging job"
fi

deploy_command=(
  gcloud run jobs deploy "$JOB"
  --source=.
  --region="$REGION"
  --project="$PROJECT"
  --service-account="$SERVICE_ACCOUNT"
  --command=/cnb/lifecycle/launcher
  --args=node,scripts/send-controlled-crm-email-test.js
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT,CRM_BACKEND=firestore,CRM_SCOPE=rental-staging,CRM_EMAIL_TEST_ENABLED=false"
  --clear-secrets
  --tasks=1
  --parallelism=1
  --max-retries=0
  --task-timeout=120s
  --memory=512Mi
  --labels=environment=staging,purpose=controlled-crm-email
  --quiet
)

if [[ "$MODE" == "--plan" ]]; then
  echo "PLAN ONLY: This command is NOT being executed."
  printf '%q ' "${deploy_command[@]}"
  printf '\n'
  echo "No approval flags, test task ID, destination inbox or Resend secret mounted."
  echo "Job execution and IAM changes are outside this script."
  exit 0
fi

command -v git >/dev/null 2>&1 || fail "git not found"
command -v gcloud >/dev/null 2>&1 || fail "gcloud not found"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not in a Git repository"
cd "$ROOT"
[[ "$(git branch --show-current)" == "$BRANCH" ]] ||
  fail "only branch $BRANCH is approved for preparation"
[[ -z "$(git status --porcelain)" ]] ||
  fail "working directory must be clean"
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH" 2>/dev/null)" ]] ||
  fail "local HEAD must match fetched origin/$BRANCH; run git fetch origin first"
[[ -f scripts/send-controlled-crm-email-test.js ]] ||
  fail "manual CRM sender entrypoint missing"

# These calls only inspect metadata. They do not retrieve secrets or mutate IAM.
gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null ||
  fail "cannot inspect the target project"
gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$PROJECT"   --format='value(email)' >/dev/null ||
  fail "dedicated email-staging identity not found or unreadable"

# Do NOT silently update an existing job, even one with the same name.
existing_jobs="$(gcloud run jobs list --region="$REGION" --project="$PROJECT"   --format='value(metadata.name)')" ||
  fail "cannot inspect existing Cloud Run jobs"
if printf '%s\n' "$existing_jobs" | awk -F/ '{print $NF}' | grep -Fxq "$JOB"; then
  fail "target job already exists; review its configuration manually"
fi

echo "PREFLIGHT PASS: branch, worktree, origin, project, service account and job absence."
echo "UNVERIFIED: effective Firestore database permissions and any inherited IAM bindings."
echo "No IAM grant, secret attachment, cloud deployment or job execution occurred."
if [[ "$MODE" == "--preflight" ]]; then exit 0; fi

# Deployment is separately approved and creates a DISABLED job only.
"${deploy_command[@]}"
echo "Disabled staging job created; no scheduled invocation or real email authorized."
echo "Review its live configuration before even considering a dry-run execution."
