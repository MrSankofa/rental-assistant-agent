"use strict";

const { FirestoreStore } = require("./storage");

const makeStore = () => new FirestoreStore({
  projectId: "altruistic-platform",
  databaseId: "rental-email-staging",
  scope: "rental-staging",
  fetchFn: jest.fn()
});

const claim = {
  createdAt: "2026-10-23T15:00:00.000Z",
  expiresAt: "2026-10-24T15:00:00.000Z"
};

describe("Firestore replay claim TTL serialization", () => {
  test("replay claims contain a native timestamp", () => {
    const doc = makeStore().encode(
      claim,
      "turnstile-replay-claims"
    );

    expect(doc.fields.expiresAt).toEqual({
      timestampValue: claim.expiresAt
    });

    expect(JSON.parse(doc.fields.payload.stringValue))
      .toEqual(claim);
  });

  test("ordinary CRM documents retain their original format", () => {
    const doc = makeStore().encode(claim, "crm-contacts");

    expect(Object.keys(doc.fields)).toEqual(["payload"]);
  });

  test("invalid replay expiration is rejected", () => {
    const store = makeStore();

    expect(() => store.encode(
      { expiresAt: "invalid" },
      "turnstile-replay-claims"
    )).toThrow("Invalid replay claim expiration");
  });

  test("create sends the native timestamp to Firestore", async () => {
    const store = makeStore();
    const request = jest.spyOn(store, "request")
      .mockResolvedValue({});

    const created = await store.create(
      "turnstile-replay-claims",
      "0123456789abcdef",
      claim
    );

    expect(created).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);

    const [method, url, body] = request.mock.calls[0];

    expect(method).toBe("POST");
    expect(url).toContain("rental-email-staging");
    expect(url).toContain("turnstile-replay-claims");
    expect(body.fields.expiresAt).toEqual({
      timestampValue: claim.expiresAt
    });
  });
});
