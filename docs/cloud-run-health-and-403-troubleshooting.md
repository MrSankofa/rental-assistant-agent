# Rental Assistant: Cloud Run health and access troubleshooting

Updated: 2026-11-10. Scope: altruistic-platform, rental-assistant-agent.

## Project-specific checkpoint

- **Use `GET /health` as the default health-check endpoint** when troubleshooting this project. The operator reports that `/healthz` has repeatedly produced misleading results in their workflows.
- Current `server.js` implements **both** `/health` and `/healthz` as health endpoints. Thus `/healthz` is not inherently unsupported in the code. A platform-generated 403/404 response does not establish which application routes exist.
- Do **not** use `/healthz` responses alone to diagnose application health. Test the service with a valid Cloud Run invocation method and inspect response provenance first.
- Google Frontend HTML 403 (`server: Google Frontend`, `Error: Forbidden`) is an access-layer symptom, not the JSON response produced by our Node.js health handler.
- A bare `curl` response of 404 or 403 is **not** proof a Cloud Run revision failed to deploy. Determine whether Google Frontend, IAM, ingress, or the application generated the error.

## Verified incident: November 10, 2026

- Deployment: `rental-assistant-staging-00022-yas`, tag `p21-agent`, **0% traffic**.
- Existing `rental-assistant-staging-00010-kob` continues receiving **100%** staging traffic.
- Service ingress was `all`; invoker IAM check was **enabled**.
- `gcloud run services get-iam-policy` displayed no `roles/run.invoker` binding in the reported output.
- Anonymous browser requests to `/`, `/health`, and `/api/prospect/context` returned **Google Frontend HTML 403**.
- Main staging URL and legacy tags returned 403 on `/` too. The problem is **not isolated to the new revision/tag**.
- Earlier comparison returned 404 for `/healthz` across all URLs, but a later request to `/health` returned 403. Treat unauthenticated results as inconclusive for application endpoint health.
- Request logs registered the 403s on their respective revisions. This does not establish that the Node.js handler executed.
- A prior attempted identity token with `gcloud auth print-identity-token --audiences=<tag URL>` returned 404. That alone does not establish an authorized invocation because audience and caller permissions were not confirmed.

## Safe decision process

1. Check `/health`, but only through a verified authorized invocation path.
2. Inspect Cloud Run IAM policy, ingress, tag routing, and service account roles **without** printing secrets.
3. Distinguish caller identity (the browser or Cloud Shell principal) from the service's execution identity. The Cloud Run runtime service account does **not** grant a browser permission to invoke the service.
4. For an IAM-protected preview, consider `gcloud run services proxy` with authenticated local access or a properly scoped identity token from a confirmed authorized caller. Avoid changing a shared service's invoker policy casually.
5. Preserve the 100% legacy staging traffic and private staff services. Public applicant access and protected staff access are different security perimeters.
6. If public browser access is required, first plan a **separate** public test service or explicitly review IAM impact before changing an existing shared staging service.
7. Only proceed to the fictional prospect browser flow after proving a 200 response from `/health` through the intended access path.

## GCP ACE checkpoint

Cloud Run invocation identity and application-level prospect identity are separate:
- Cloud Run IAM decides whether requests may reach the container.
- The Rental Assistant's verified prospect session decides which CRM records an admitted request may see.

Do not change tenant-facing authentication to address Cloud Run IAM, or vice versa.
