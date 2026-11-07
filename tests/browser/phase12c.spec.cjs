"use strict";

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const { validateMilestone } = require(
  "../../src/crm/liveStaffActions"
);
const { summarizeDashboard } = require(
  "../../src/crm/staff"
);

const html = fs.readFileSync(
  path.join(__dirname, "../../public/staff.html"), "utf8"
);

const BASE = "http://phase12c.invalid";
const ID = "fictional-phase12c-001";

async function openFixture(page) {
  let stage = "TOUR_SCHEDULED";
  const audit = [];
  let outbound = 0;

  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());

    // Deny every destination outside our fictional origin.
    if (url.origin !== BASE) {
      await route.abort();
      return;
    }

    if (url.pathname === "/staff" &&
        request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: html
      });
      return;
    }

    if (url.pathname === "/api/staff/dashboard" &&
        request.method() === "GET") {
      const dashboard = summarizeDashboard(
        [{
          id: "fictional-contact",
          name: "Fictional Tester",
          email: "fictional@example.invalid"
        }],
        [{
          id: ID,
          domain: "rental",
          contactId: "fictional-contact",
          targetId: "ziegler",
          stage,
          interest: "Fictional apartment tour",
          nextAction: "Staff verification required"
        }],
        [],
        { workspace: "live", actionsEnabled: true }
      );

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...dashboard,
          reminders: [],
          reminderStaffActionsEnabled: false
        })
      });
      return;
    }

    if (url.pathname ===
        `/api/staff/engagements/${ID}/stage` &&
        request.method() === "POST") {
      try {
        const input = request.postDataJSON();
        const result = validateMilestone(
          { id: ID, domain: "rental", stage },
          input
        );

        stage = result.stage;
        audit.push({
          stage,
          confirmed: result.confirmed,
          evidence: result.evidence
        });

        await route.fulfill({
          status: 200,
          json: { id: ID, stage }
        });
      } catch (error) {
        await route.fulfill({
          status: error.status || 400,
          json: { error: error.message }
        });
      }
      return;
    }

    await route.abort();
  });

  await page.goto(`${BASE}/staff`);

  return {
    state: () => ({ stage, audit: [...audit], outbound })
  };
}

test("fictional dashboard renders with delivery disabled",
  async ({ page }) => {
    const fixture = await openFixture(page);

    await expect(
      page.getByText("Fictional Tester").first()
    ).toBeVisible();

    await expect(
      page.locator("#workspaceDescription")
    ).toContainText("Automated messages");

    await expect(
      page.locator(".staff-milestone-form")
    ).toHaveCount(1);

    expect(fixture.state().outbound).toBe(0);
  }
);

test("missing evidence blocks milestone submission",
  async ({ page }) => {
    const fixture = await openFixture(page);

    await page.getByRole("button", {
      name: "Record milestone"
    }).click();

    expect(fixture.state().stage).toBe("TOUR_SCHEDULED");
    expect(fixture.state().audit).toHaveLength(0);
  }
);

test("verified milestone advances and records evidence",
  async ({ page }) => {
    const fixture = await openFixture(page);

    page.on("dialog", dialog => dialog.accept());

    const form = page.locator(".staff-milestone-form");

    await form.getByLabel("Milestone evidence").fill(
      "Fictional tour completed and independently verified."
    );

    await form.locator('input[type="checkbox"]').check();

    await form.getByRole("button", {
      name: "Record milestone"
    }).click();

    await expect.poll(
      () => fixture.state().stage
    ).toBe("TOUR_COMPLETED");

    expect(fixture.state().audit).toHaveLength(1);
    expect(fixture.state().audit[0].confirmed).toBe(true);
    expect(fixture.state().outbound).toBe(0);
  }
);

test("server validator rejects skipping to lease signed",
  async ({ page }) => {
    const fixture = await openFixture(page);

    const status = await page.evaluate(async id => {
      const response = await fetch(
        `/api/staff/engagements/${id}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "LEASE_SIGNED",
            evidence: "Fictional invalid shortcut attempt",
            confirmed: true
          })
        }
      );

      return response.status;
    }, ID);

    expect(status).toBe(409);
    expect(fixture.state().stage).toBe("TOUR_SCHEDULED");
    expect(fixture.state().audit).toHaveLength(0);
  }
);

test("complete fictional leasing journey through browser",
  async ({ page }) => {
    const fixture = await openFixture(page);
    page.on("dialog", dialog => dialog.accept());

    const evidence = "Fictional milestone independently verified.";

    async function advance(expected, options = {}) {
      const form = page.locator(".staff-milestone-form");
      await expect(form).toHaveCount(1);

      if (options.decision) {
        await form.getByLabel("Landlord decision")
          .selectOption(options.decision);
      }

      await form.getByLabel("Milestone evidence")
        .fill(evidence);

      if (options.applicationUrl) {
        await form.getByLabel("External application URL")
          .fill(options.applicationUrl);
      }

      if (options.submissionReference) {
        await form.getByLabel("Application submission reference")
          .fill(options.submissionReference);
      }

      if (options.externalReference) {
        await form.getByLabel("External provider reference")
          .fill(options.externalReference);
      }

      if (options.providerUrl) {
        await form.getByLabel("External lease provider URL")
          .fill(options.providerUrl);
      }

      if (options.signingTime) {
        await form.getByLabel("Lease signing appointment")
          .fill(options.signingTime);
      }

      for (const checkbox of await form.locator(
        'input[type="checkbox"]'
      ).all()) {
        await checkbox.check();
      }

      await form.getByRole("button", {
        name: "Record milestone"
      }).click();

      await expect.poll(
        () => fixture.state().stage
      ).toBe(expected);

      await expect(
        page.locator("#message")
      ).not.toContainText("Request failed");
    }

    await advance("TOUR_COMPLETED");

    await advance("APPLICATION_INVITED", {
      applicationUrl: "https://applications.example.com/apply"
    });

    await advance("APPLICATION_RECEIVED", {
      submissionReference: "APP-TEST-123456"
    });

    await advance("UNDER_LANDLORD_REVIEW");

    await advance("MORE_INFO_REQUESTED", {
      decision: "MORE_INFO_REQUESTED",
      externalReference: "INFO-REQUEST-123"
    });

    await advance("UNDER_LANDLORD_REVIEW", {
      externalReference: "INFO-RESPONSE-123"
    });

    await advance("APPROVED", {
      decision: "APPROVED",
      externalReference: "APPROVAL-TEST-123"
    });

    await advance("RENTREDI_ONBOARDING", {
      externalReference: "ONBOARD-TEST-123",
      providerUrl: "https://leasing.example.com/lease"
    });

    await advance("LEASE_SIGNING_SCHEDULED", {
      externalReference: "SIGNING-TEST-123",
      providerUrl: "https://leasing.example.com/lease",
      signingTime: "2026-12-01T13:00"
    });

    await advance("DISCLOSURES_READY_AND_DELIVERED", {
      externalReference: "DISCLOSURE-TEST-123"
    });

    await advance("LEASE_SIGNED", {
      externalReference: "SIGNED-TEST-123"
    });

    const result = fixture.state();

    expect(result.stage).toBe("LEASE_SIGNED");
    expect(result.audit).toHaveLength(11);
    expect(result.audit.every(a => a.confirmed)).toBe(true);
    expect(result.outbound).toBe(0);
  }
);

test("real CRM and MemoryStore persistence through browser",
  async ({ page }) => {
    const { CRM } = require("../../src/crm/workflows");
    const { MemoryStore } = require("../../src/crm/storage");

    const store = new MemoryStore();
    const crm = new CRM(store, "rental-live");
    const actor = "staff:accounts.google.com:123456789012345678901";
    const id = "fictional-phase12c-integrated";

    await store.create("contacts", "fictional-contact", {
      id: "fictional-contact",
      name: "Fictional Tester",
      email: "fictional@example.invalid"
    });

    await store.create("engagements", id, {
      id,
      contactId: "fictional-contact",
      domain: "rental",
      targetId: "ziegler",
      stage: "TOUR_SCHEDULED",
      nextAction: "Staff review",
      history: []
    });

    let outboundRequests = 0;

    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.origin !== BASE) {
        outboundRequests++;
        await route.abort();
        return;
      }

      if (url.pathname === "/staff" &&
          request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html
        });
        return;
      }

      if (url.pathname === "/api/staff/dashboard" &&
          request.method() === "GET") {
        const dashboard = summarizeDashboard(
          await crm.listContacts(),
          await crm.listEngagements(),
          await crm.listTasks(),
          { workspace: "live", actionsEnabled: true }
        );

        await route.fulfill({
          status: 200,
          json: {
            ...dashboard,
            reminders: [],
            reminderStaffActionsEnabled: false
          }
        });
        return;
      }

      const stagePath =
        /^\/api\/staff\/engagements\/([a-zA-Z0-9_-]+)\/stage$/;

      const match = url.pathname.match(stagePath);

      if (request.method() === "POST" &&
          match && match[1] === id) {
        try {
          const current = await crm.history(id);
          const input = request.postDataJSON();
          const milestone = validateMilestone(current, input);
          const result = await crm.transition(
            id, milestone, actor
          );

          await route.fulfill({
            status: 200,
            json: { id, stage: result.stage }
          });
        } catch (error) {
          await route.fulfill({
            status: error.status || 500,
            json: { error: error.message }
          });
        }
        return;
      }

      await route.abort();
    });

    page.on("dialog", dialog => dialog.accept());
    await page.goto(`${BASE}/staff`);

    async function advance(stage, options = {}) {
      const form = page.locator(".staff-milestone-form");
      await expect(form).toHaveCount(1);

      if (options.decision) {
        await form.getByLabel("Landlord decision")
          .selectOption(options.decision);
      }

      await form.getByLabel("Milestone evidence").fill(
        "Fictional evidence verified by authorized test staff."
      );

      const fields = [
        ["applicationUrl", "External application URL"],
        ["submissionReference", "Application submission reference"],
        ["externalReference", "External provider reference"],
        ["providerUrl", "External lease provider URL"],
        ["signingTime", "Lease signing appointment"]
      ];

      for (const [key, label] of fields) {
        if (options[key]) {
          await form.getByLabel(label).fill(options[key]);
        }
      }

      for (const checkbox of await form.locator(
        'input[type="checkbox"]'
      ).all()) {
        await checkbox.check();
      }

      await form.getByRole("button", {
        name: "Record milestone"
      }).click();

      await expect.poll(async () =>
        (await crm.history(id)).stage
      ).toBe(stage);

      // Confirm the UI has reloaded for the new milestone.
      await expect(
        page.locator("#pipeline")
      ).toContainText(stage);
    }

    const applicationUrl =
      "https://applications.example.com/apply";
    const leaseUrl =
      "https://leasing.example.com/lease";

    await advance("TOUR_COMPLETED");

    await advance("APPLICATION_INVITED", {
      applicationUrl
    });

    await advance("APPLICATION_RECEIVED", {
      submissionReference: "APP-TEST-123456"
    });

    await advance("UNDER_LANDLORD_REVIEW");

    await advance("MORE_INFO_REQUESTED", {
      decision: "MORE_INFO_REQUESTED",
      externalReference: "INFO-REQUEST-123"
    });

    await advance("UNDER_LANDLORD_REVIEW", {
      externalReference: "INFO-RESPONSE-123"
    });

    await advance("APPROVED", {
      decision: "APPROVED",
      externalReference: "APPROVAL-TEST-123"
    });

    await advance("RENTREDI_ONBOARDING", {
      externalReference: "ONBOARD-TEST-123",
      providerUrl: leaseUrl
    });

    await advance("LEASE_SIGNING_SCHEDULED", {
      externalReference: "SIGNING-TEST-123",
      providerUrl: leaseUrl,
      signingTime: "2026-12-01T13:00"
    });

    await advance("DISCLOSURES_READY_AND_DELIVERED", {
      externalReference: "DISCLOSURE-TEST-123"
    });

    await advance("LEASE_SIGNED", {
      externalReference: "SIGNED-TEST-123"
    });

    const engagement = await crm.history(id);
    const audits = await store.list("audits");

    expect(engagement.stage).toBe("LEASE_SIGNED");
    expect(engagement.application.status).toBe("under-review");
    expect(engagement.handoff.decision.status).toBe("approved");
    expect(engagement.handoff.lease.status).toBe("signed");
    expect(engagement.history).toHaveLength(11);

    const transitions = audits.filter(
      entry => entry.type === "stage-transition"
    );

    expect(transitions).toHaveLength(11);
    expect(transitions.every(
      entry => entry.actor === actor
    )).toBe(true);

    // Negative test: an invalid transition cannot mutate records.
    const rejected = await page.evaluate(async id => {
      const response = await fetch(
        `/api/staff/engagements/${id}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "APPLICATION_RECEIVED",
            evidence: "Invalid fictional transition attempt",
            confirmed: true
          })
        }
      );
      return response.status;
    }, id);

    expect(rejected).toBe(409);
    expect((await crm.history(id)).stage).toBe("LEASE_SIGNED");
    expect(await store.list("audits")).toHaveLength(11);
    expect(outboundRequests).toBe(0);
  }
);
