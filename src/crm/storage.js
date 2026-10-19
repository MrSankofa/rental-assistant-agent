"use strict";
const copy = value => JSON.parse(JSON.stringify(value));

class StoreConflict extends Error {
  constructor(message = "Concurrent modification") {
    super(message);
    this.name = "StoreConflict";
  }
}

// Only for unit tests and local demonstrations. Never use in production.
class MemoryStore {
  constructor() { this.rows = new Map(); }
  key(collection, id) { return collection + "/" + id; }
  async get(collection, id) {
    const row = this.rows.get(this.key(collection, id));
    return row ? { value: copy(row.value), version: String(row.version) } : null;
  }
  async create(collection, id, value) {
    const key = this.key(collection, id);
    if (this.rows.has(key)) return false;
    this.rows.set(key, { value: copy(value), version: 1 });
    return true;
  }
  async replace(collection, id, value, expectedVersion) {
    const key = this.key(collection, id);
    const current = this.rows.get(key);
    if (!current || String(current.version) !== String(expectedVersion)) throw new StoreConflict();
    this.rows.set(key, { value: copy(value), version: current.version + 1 });
  }
  async list(collection, limit = 200) {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(collection + "/"))
      .slice(0, limit)
      .map(([, row]) => copy(row.value));
  }
}

// Firestore REST uses the Cloud Run service account via the metadata server.
// Documents store one JSON payload to avoid implicit schema migration surprises.
class FirestoreStore {
  constructor({ projectId, scope, databaseId = "(default)", emulatorHost = "", fetchFn = globalThis.fetch }) {
    if (typeof fetchFn !== "function") throw new Error("Firestore requires Node.js 18 or newer");
    if (!/^[a-z0-9-]{5,63}$/.test(projectId || "")) throw new Error("Invalid project");
    if (!/^[a-z0-9-]{2,40}$/.test(scope || "")) throw new Error("Invalid CRM scope");
    // Reject unsafe and empty names before constructing a Firestore request URL.
    if (databaseId !== "(default)" &&
        (typeof databaseId !== "string" ||
         !/^[a-z][a-z0-9-]{2,60}[a-z0-9]$/.test(databaseId))) {
      throw new Error("Invalid Firestore database ID");
    }
    this.databaseId = databaseId;
    this.fetchFn = fetchFn;
    this.token = null;
    this.tokenUntil = 0;
    this.base = (emulatorHost ? "http://" + emulatorHost : "https://firestore.googleapis.com") +
      "/v1/projects/" + projectId + "/databases/" + databaseId + "/documents/scopes/" + scope;
    this.emulator = Boolean(emulatorHost);
  }
  async bearer() {
    if (this.emulator) return "";
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    const response = await this.fetchFn(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } }
    );
    if (!response.ok) throw new Error("Cloud Run credentials unavailable");
    const data = await response.json();
    this.token = data.access_token;
    this.tokenUntil = Date.now() + Math.max(60, (data.expires_in || 3600) - 120) * 1000;
    return this.token;
  }
  path(collection, id = "") {
    if (!/^[a-z][a-z0-9-]{2,40}$/.test(collection) ||
        (id && !/^[a-zA-Z0-9_-]{8,120}$/.test(id))) throw new Error("Invalid document path");
    return this.base + "/" + collection + (id ? "/" + id : "");
  }
  async request(method, url, body) {
    const token = await this.bearer();
    const response = await this.fetchFn(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (response.status === 404) return { missing: true };
    if (response.status === 409 || response.status === 412) throw new StoreConflict();
    if (!response.ok) throw new Error("Firestore " + method + " failed with " + response.status);
    return response.json();
  }
  decode(doc) {
    if (!doc || !doc.fields || !doc.fields.payload) throw new Error("Invalid CRM document");
    return { value: JSON.parse(doc.fields.payload.stringValue), version: doc.updateTime };
  }
  encode(value) {
    return { fields: { payload: { stringValue: JSON.stringify(value) } } };
  }
  async get(collection, id) {
    const doc = await this.request("GET", this.path(collection, id));
    return doc.missing ? null : this.decode(doc);
  }
  async create(collection, id, value) {
    try {
      await this.request("POST", this.path(collection) + "?documentId=" + encodeURIComponent(id), this.encode(value));
      return true;
    } catch (error) {
      if (error instanceof StoreConflict) return false;
      throw error;
    }
  }
  async replace(collection, id, value, expectedVersion) {
    if (!expectedVersion) throw new StoreConflict();
    const url = this.path(collection, id) + "?updateMask.fieldPaths=payload&currentDocument.updateTime=" +
      encodeURIComponent(expectedVersion);
    const result = await this.request("PATCH", url, this.encode(value));
    if (result.missing) throw new StoreConflict();
  }
  async list(collection, limit = 200) {
    const records = [];
    let nextToken = "";
    do {
      const remaining = Math.min(limit - records.length, 100);
      const url = this.path(collection) + "?pageSize=" + remaining +
        (nextToken ? "&pageToken=" + encodeURIComponent(nextToken) : "");
      const result = await this.request("GET", url);
      if (result.missing) return records;
      for (const doc of result.documents || []) records.push(this.decode(doc).value);
      nextToken = result.nextPageToken || "";
    } while (nextToken && records.length < limit);
    return records;
  }
}

function makeStore(env = process.env) {
  if (env.CRM_BACKEND === "memory") {
    if (env.NODE_ENV === "production") throw new Error("In-memory CRM forbidden in production");
    return new MemoryStore();
  }
  if (env.CRM_BACKEND === "firestore") {
    return new FirestoreStore({
      projectId: env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT || "altruistic-platform",
      scope: env.CRM_SCOPE || "rental-mvp",
      // Preserve (default) for existing clients; reject explicitly invalid IDs.
      databaseId: env.CRM_DATABASE === undefined ? "(default)" : env.CRM_DATABASE,
      emulatorHost: env.FIRESTORE_EMULATOR_HOST || ""
    });
  }
  return null;
}

module.exports = { FirestoreStore, MemoryStore, StoreConflict, makeStore };
