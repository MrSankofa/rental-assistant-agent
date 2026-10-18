const { FirestoreStore, StoreConflict } = require("./storage");

function response(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe("Firestore REST persistence adapter", () => {
  const projectId = "altruistic-platform";
  const scope = "crm-staging";
  const docId = "c_1234567890abcdef";
  const prefix = "http://localhost:8080/v1/projects/altruistic-platform/databases/(default)/documents/scopes/crm-staging";
  test("creates a document with scoped path and reads persisted payload", async () => {
    const data = { id: docId, name: "Fictional Prospect" };
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(response(200, {
        name: prefix + "/contacts/" + docId,
        updateTime: "2026-10-18T19:00:00.000000Z",
        fields: { payload: { stringValue: JSON.stringify(data) } }
      }))
      .mockResolvedValueOnce(response(200, {
        name: prefix + "/contacts/" + docId,
        updateTime: "2026-10-18T19:00:00.000000Z",
        fields: { payload: { stringValue: JSON.stringify(data) } }
      }));
    const store = new FirestoreStore({ projectId, scope, emulatorHost: "localhost:8080", fetchFn });
    expect(await store.create("contacts", docId, data)).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe(prefix + "/contacts?documentId=" + docId);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).fields.payload.stringValue).toEqual(JSON.stringify(data));
    expect((await store.get("contacts", docId)).value).toEqual(data);
    expect(fetchFn.mock.calls[1][0]).toBe(prefix + "/contacts/" + docId);
  });
  test("returns false for duplicate writes, protects versioned updates", async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(response(412))
      .mockResolvedValueOnce(response(200, {
        updateTime: "2026-10-18T19:00:01Z",
        fields: { payload: { stringValue: "{}" } }
      }));
    const store = new FirestoreStore({ projectId, scope, emulatorHost: "localhost:8080", fetchFn });
    expect(await store.create("contacts", docId, {})).toBe(false);
    await expect(store.replace("contacts", docId, { status: "new" }, "old-version")).rejects.toBeInstanceOf(StoreConflict);
    await store.replace("contacts", docId, { status: "new" }, "valid-version");
    expect(fetchFn.mock.calls[2][0]).toContain("currentDocument.updateTime=valid-version");
    expect(fetchFn.mock.calls[2][1].method).toBe("PATCH");
  });
  test("lists contacts from scoped collection", async () => {
    const value = { id: docId };
    const fetchFn = jest.fn().mockResolvedValueOnce(response(200, {
      documents: [{ fields: { payload: { stringValue: JSON.stringify(value) } }, updateTime: "t" }]
    }));
    const store = new FirestoreStore({ projectId, scope, emulatorHost: "localhost:8080", fetchFn });
    expect(await store.list("contacts")).toEqual([value]);
    expect(fetchFn.mock.calls[0][0]).toContain("/contacts?pageSize=100");
  });
  test("does not permit unsupported collection or document identifiers", async () => {
    const store = new FirestoreStore({ projectId, scope, emulatorHost: "localhost:8080", fetchFn: jest.fn() });
    expect(() => store.path("../secrets", docId)).toThrow("Invalid document path");
    expect(() => store.path("contacts", "../escape")).toThrow("Invalid document path");
  });
  test("requires a modern runtime for actual Firestore access", () => {
    expect(() => new FirestoreStore({ projectId, scope, fetchFn: null })).toThrow(
      "Firestore requires Node.js 18 or newer"
    );
  });
});
