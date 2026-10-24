# CRM platform MVP (feature branch, not production)

This adds a consent-aware contact intake form to Rental Assistant and an isolated durable CRM workflow foundation. It does **not** implement outbound email/SMS, Calendly webhook verification, Zillow/RentRedi API integration, application screening, payment processing, or lease execution.

## Current verified capabilities in source
- Node HTTP app and existing property-chat flows preserved.
- Optional CRM module. With CRM_BACKEND unset all CRM endpoints return 503; chat and site continue working.
- Intake API validates property, name, email/phone, consent, source, and preferred channel.
- Firestore persistence behind a scoped repository. A memory repository is for tests only.
- Stable contact and per-property engagement IDs prevent duplicate intake for the same canonical contact key. Conflicting names require human review. A new email or phone identifier may need a manual merge.
- Separate rental/community engagement stages; milestone transitions require evidence and staff confirmation where appropriate.
- Staff-only read API for contacts, engagements, and next-action tasks. Tasks are draft/approval records and never send messages.
- Audit entries and interaction records. No public record lookup.
- Reuse demonstrated with fictional community data and an isolated store.

## Local verification

    npm ci
    npm test
    npm run build
    CRM_BACKEND=memory CRM_SCOPE=rental-mvp CRM_ADMIN_TOKEN=<long-random-token> PUBLIC_ORIGIN=http://localhost:3000 node server.js

In nonproduction environments only, memory mode is useful for functional development. It loses data on process restart and must not be used in production.

Staff example (set ADMIN_TOKEN in your shell, not in command history or source):

    curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/crm/admin/engagements

## Firestore Cloud Run configuration (only after separate review)
- Create Firestore native-mode database in the existing Google Cloud project **after checking billing, policies, region and data retention**.
- Give the dedicated Cloud Run runtime service account only necessary Firestore permissions; review narrow custom role options before using broad roles.
- Set CRM_BACKEND=firestore, CRM_SCOPE=rental-mvp, GOOGLE_CLOUD_PROJECT=altruistic-platform, PUBLIC_ORIGIN to the precise serving origin, and CRM_ADMIN_TOKEN as a Secret Manager-backed environment variable (min 32 characters).
- Do not place CRM_ADMIN_TOKEN, API keys, or production personal data in a repo, browser JavaScript, screenshots, or publicly accessible web storage.
- Keep firestore database / service account access restricted. Configure privacy/retention, backups, metrics, monitoring, and operational rollback before collecting real tenant data.
- Do not deploy from local working branch with uncommitted edits. Run tests and tag a Cloud Run revision with 0% live traffic first.
- Public intake is a browser form and NOT a secure identity verification service. Staff record retrieval requires protected server-side authorization.
- Shared staff bearer token is a **temporary proof-of-concept access mechanism**, not suitable for multi-person production authorization. Before real tenant data, replace with an identity provider, individual accounts, role-scoped authorization and auditable actor IDs.

## API overview
Public POST /api/crm/intake fields:
name, email or phone, preferredChannel=email|sms|none, domain=rental, targetId=ziegler|virginia,
source, optional interest, consent:{recording:true,email:boolean,sms:boolean}.

Staff Authorization: Bearer <secret>:
- GET /api/crm/admin/contacts
- GET /api/crm/admin/engagements
- GET /api/crm/admin/tasks
- POST /api/crm/admin/intake (supports synthetic community data)
- POST /api/crm/admin/engagements/{id}/stage (stage, evidence, confirmed, nextAction)
- POST /api/crm/admin/tasks (engagementId, summary, dueAt, owner)
- POST /api/crm/admin/tasks/{id}/approve|complete|cancel

## Known blockers to a safe production rollout
- Replace shared admin token with staff identity/roles and non-browser privileged access.
- Implement channel-specific opt-out updates and documented consent provenance. Communication consent alone does not authorize sending messages.
- Implement an immutable complete audit strategy, operational alerting, tested backups/restoration, deletion/retention controls.
- Add reliable external event ingestion with signature verification, retries, and idempotent state updates.
- Confirm provider access and manual handoffs for Calendly, Zillow, and RentRedi.
- Complete lease/disclosure/legal checklist review for each property. Landlord keeps authority over approval, lease signing, payments and keys.
- Fix the original IP rate-limit trust model behind proxies and use a distributed limiter for Cloud Run scale-out.
- Add integration tests for all HTTP endpoints and Firestore emulator tests for concurrent writes, authorization, and restart persistence.

## No claims beyond proof
This branch is an MVP, not an end-to-end fully automated leasing platform. Production stays unchanged until human review and deployment approval.


## Replit Node version compatibility
Replit originally configured Node 12 (replit.nix). The CRM requires Node 20 or newer. The feature branch updates replit.nix and the Nix channel. After fetching, check `node -v`. If it still reports Node 12, restart/rebuild the Replit environment before testing; do not deploy with that runtime.

    git pull --ff-only origin feature/crm-platform-mvp
    node -v
    npm ci
    npm test
    npm run build
    node scripts/crm-demo.js

The public intake form now stays hidden and the endpoint returns 503 unless the CRM backend, PUBLIC_ORIGIN, secure admin token, and CRM_PUBLIC_INTAKE_ENABLED=true are explicitly configured. This is deliberate until the security readiness gates are met.
