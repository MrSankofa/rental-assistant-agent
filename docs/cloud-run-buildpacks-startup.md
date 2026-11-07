# Cloud Run Buildpacks Startup Standard

Applies to Altruistic Development Cloud Run services and jobs
built using Cloud Native Buildpacks.

## Root cause

The initial container PATH may not include the Node.js binary.
Setting a Cloud Run container command directly to `node` bypasses
the Buildpacks launcher and can cause container startup failure.

## Approved pattern

If the image already has the correct startup process, retain
the image-default command and arguments.

For the dedicated Calendly webhook service, explicitly use:

```bash
--command=/cnb/lifecycle/launcher \
--args=node,scripts/calendly-webhook-server.js
```

Validate before deploying:

```bash
node scripts/check-cloud-run-startup.js \
  /cnb/lifecycle/launcher \
  node scripts/calendly-webhook-server.js
```

This validation is intended for Buildpacks images, not arbitrary
Docker images.

## Deployment acceptance

- Verify startup command and arguments on the created revision.
- Verify health endpoints on the intended tagged revision.
- Verify the original traffic allocation remains unchanged.
- Verify webhook write switches and database scope.
- Do not promote a revision solely because image build succeeded.

## Known incidents

- Earlier staging job startup failures.
- 2026-10-29 webhook revision 00013-fud:
  direct `node` invocation could not find the executable in PATH.
- Corrected with the launcher on revision 00014-vas.
