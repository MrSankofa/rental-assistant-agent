"use strict";
const { MemoryStore } = require("../src/crm/storage");
const {
  issueReturnLink, exchangeReturnLink, getProspectContext, revokeSession,
  LINK_TTL_MS, SESSION_TTL_MS
} = require("../src/crm/prospectIdentity");

const email = "fictional@example.test";
const contactId = "c_" + "a".repeat(40);
const engagementId = "e_" + "b".repeat(40);
const anotherContact = "c_" + "c".repeat(40);
const anotherEngagement = "e_" + "d".repeat(40);

async function fixture() {
  const store = new MemoryStore();
  await store.create("contacts", contactId, {
    id: contactId, name: "Fictional Tenant", email,
    screeningNotes: "MUST NOT LEAK"
  });
  await store.create("engagements", engagementId, {
    id: engagementId, contactId, domain: "rental", targetId: "ziegler",
    stage: "TOUR_SCHEDULED", nextAction: "Attend tour",
    staffNotes: "MUST NOT LEAK"
  });
  await store.create("contacts", anotherContact, {
    id: anotherContact, name: "Other Tenant", email: "other@example.test"
  });
  await store.create("engagements", anotherEngagement, {
    id: anotherEngagement, contactId: anotherContact, domain: "rental",
    targetId: "virginia", stage: "APPROVED"
  });
  return store;
}
const clock = value => () => value;
describe("Phase 21 verified prospect context foundation", () => {
  test("single-use link returns session without disclosing sensitive CRM fields", async () => {
    const store = await fixture();
    const link = await issueReturnLink(store, { contactId, engagementId, email },
      { clock: clock(10000) });
    expect(link.token.length).toBeGreaterThan(40);
    const savedLinks = await store.list("returnlinks");
    expect(JSON.stringify(savedLinks)).not.toContain(link.token);
    const session = await exchangeReturnLink(store, link.token,
      { clock: clock(11000) });
    expect(JSON.stringify(await store.list("prospectsessions")))
      .not.toContain(session.sessionToken);
    const context = await getProspectContext(store, session.sessionToken,
      { clock: clock(12000) });
    expect(context).toEqual({
      propertyId: "ziegler", stage: "TOUR_SCHEDULED",
      nextAction: "Attend tour", prospectName: "Fictional Tenant", engagementId
    });
    expect(JSON.stringify(context)).not.toMatch(/MUST NOT LEAK|other@example|APPROVED/);
    await expect(exchangeReturnLink(store, link.token,
      { clock: clock(12000) })).rejects.toMatchObject({ status: 401 });
  });

  test("expired or malformed links cannot be exchanged", async () => {
    const store = await fixture();
    const { token } = await issueReturnLink(store,
      { contactId, engagementId, email }, { clock: clock(10000) });
    await expect(exchangeReturnLink(store, token,
      { clock: clock(10000 + LINK_TTL_MS) })).rejects.toMatchObject({status:401});
    await expect(exchangeReturnLink(store, "bad")).rejects.toMatchObject({status:401});
  });

  test("session expires and can be explicitly revoked", async () => {
    const store = await fixture();
    const link = await issueReturnLink(store,
      { contactId, engagementId, email }, { clock: clock(10000) });
    const session = await exchangeReturnLink(store, link.token,
      { clock: clock(11000) });
    await expect(getProspectContext(store, session.sessionToken,
      { clock: clock(11000 + SESSION_TTL_MS) })).rejects.toMatchObject({status:401});
    expect(await revokeSession(store, session.sessionToken,
      { clock: clock(12000) })).toBe(true);
    await expect(getProspectContext(store, session.sessionToken,
      { clock: clock(12001) })).rejects.toMatchObject({status:401});
  });

  test("rejects mismatched contact data and never allows arbitrary prospect selection", async () => {
    const store = await fixture();
    await expect(issueReturnLink(store,
      { contactId, engagementId: anotherEngagement, email }))
      .rejects.toMatchObject({status:404});
    await expect(issueReturnLink(store,
      { contactId, engagementId, email:"other@example.test" }))
      .rejects.toMatchObject({status:404});
    const link = await issueReturnLink(store, { contactId, engagementId, email });
    const session = await exchangeReturnLink(store, link.token);
    const recordId = (await store.list("prospectsessions"))[0].id;
    const row = await store.get("prospectsessions", recordId);
    await store.replace("prospectsessions", recordId,
      { ...row.value, engagementId: anotherEngagement }, row.version);
    await expect(getProspectContext(store, session.sessionToken))
      .rejects.toMatchObject({status:403});
  });
});
