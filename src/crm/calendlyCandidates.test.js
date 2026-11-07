"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { makeCalendlyCandidateLookup } =
  require("./calendlyCandidates");

async function setup() {
  const crm = new CRM(new MemoryStore(), "rental-staging");

  const created = await crm.intake({
    name: "Fictional Prospect",
    email: "Prospect@Example.test",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    source: "calendly-test",
    interest: "Tour",
    consent: { recording: true }
  }, { origin: "staff" });

  await crm.transition(
    created.engagementId,
    { stage: "TOUR_OFFERED" },
    "staff"
  );

  return { crm, created };
}

test("finds matching Ziegler prospect with direct reads", async () => {
  const { crm, created } = await setup();
  const get = jest.spyOn(crm.store, "get");
  const list = jest.spyOn(crm.store, "list");

  const lookup = makeCalendlyCandidateLookup(crm);
  const result = await lookup({
    email: " PROSPECT@example.test "
  });

  expect(result.complete).toBe(true);
  expect(result.contacts).toHaveLength(1);
  expect(result.engagements[0].id).toBe(created.engagementId);
  expect(get).toHaveBeenCalledTimes(2);
  expect(list).not.toHaveBeenCalled();
});

test("unknown email produces no authorized match", async () => {
  const { crm } = await setup();
  const result = await makeCalendlyCandidateLookup(crm)({
    email: "unknown@example.test"
  });

  expect(result.contacts).toHaveLength(0);
  expect(result.engagements).toHaveLength(0);
});

test("rejects cross-scope contact matching", async () => {
  const { crm } = await setup();
  const differentScope = new CRM(
    crm.store, "another-rental-scope"
  );

  const result = await makeCalendlyCandidateLookup(
    differentScope
  )({ email: "prospect@example.test" });

  expect(result.contacts).toHaveLength(0);
});

test("wrong-property engagement is not returned", async () => {
  const { crm, created } = await setup();
  const row = await crm.store.get(
    "engagements", created.engagementId
  );

  await crm.store.replace(
    "engagements",
    created.engagementId,
    { ...row.value, targetId: "virginia" },
    row.version
  );

  const result = await makeCalendlyCandidateLookup(crm)({
    email: "prospect@example.test"
  });

  expect(result.engagements).toHaveLength(0);
});
