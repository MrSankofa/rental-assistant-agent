"use strict";

const { makeCalendlyApi } = require("./calendlyApi");

const eventUri =
  "https://api.calendly.com/scheduled_events/test-123";
const inviteeUri = eventUri + "/invitees/test-456";
const token = "fictional-test-token-123456789";

const event = {
  uri: eventUri,
  event_type:
    "https://api.calendly.com/event_types/test-type",
  status: "active",
  start_time: "2026-11-02T18:00:00Z",
  end_time: "2026-11-02T18:30:00Z"
};

const invitee = {
  uri: inviteeUri,
  event: eventUri,
  email: "fictional@example.test",
  status: "active"
};

function fixture() {
  const fetchFn = jest.fn(async uri => ({
    ok: true,
    json: async () => ({
      resource: uri === eventUri ? event : invitee
    })
  }));

  return {
    fetchFn,
    client: makeCalendlyApi({ token, fetchFn })
  };
}

test("retrieves event and invitee using trusted URIs", async () => {
  const { client, fetchFn } = fixture();

  const result = await client.fetchProviderResources({
    scheduledEventUri: eventUri,
    inviteeUri
  });

  expect(result.scheduledEvent.uri).toBe(eventUri);
  expect(result.invitee.uri).toBe(inviteeUri);
  expect(fetchFn).toHaveBeenCalledTimes(2);

  for (const call of fetchFn.mock.calls) {
    expect(call[1].method).toBe("GET");
    expect(call[1].redirect).toBe("error");
    expect(call[1].headers.Authorization)
      .toBe("Bearer " + token);
  }
});

test("rejects mismatched event and invitee references", async () => {
  const { client, fetchFn } = fixture();

  await expect(client.fetchProviderResources({
    scheduledEventUri: eventUri,
    inviteeUri:
      "https://api.calendly.com/scheduled_events/other-123/invitees/test-456"
  })).rejects.toHaveProperty("status", 503);

  expect(fetchFn).not.toHaveBeenCalled();
});

test("rejects unsafe URLs before making requests", async () => {
  const { client, fetchFn } = fixture();

  await expect(client.fetchProviderResources({
    scheduledEventUri:
      "https://api.calendly.com.attacker.test/scheduled_events/test-123",
    inviteeUri
  })).rejects.toHaveProperty("status", 503);

  expect(fetchFn).not.toHaveBeenCalled();
});

test("rejects provider response URI mismatch", async () => {
  const fetchFn = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      resource: { uri: "https://example.test/invalid" }
    })
  }));

  const client = makeCalendlyApi({ token, fetchFn });

  await expect(client.fetchProviderResources({
    scheduledEventUri: eventUri,
    inviteeUri
  })).rejects.toHaveProperty("status", 503);
});

test("rejects unsuccessful provider responses", async () => {
  const fetchFn = jest.fn(async () => ({
    ok: false,
    status: 403
  }));

  const client = makeCalendlyApi({ token, fetchFn });

  await expect(client.fetchProviderResources({
    scheduledEventUri: eventUri,
    inviteeUri
  })).rejects.toHaveProperty("status", 503);
});

test("rejects provider invitee linked to another event", async () => {
  const fetchFn = jest.fn(async uri => ({
    ok: true,
    json: async () => ({
      resource: uri === eventUri
        ? event
        : {
            ...invitee,
            event:
              "https://api.calendly.com/scheduled_events/other-123"
          }
    })
  }));

  const client = makeCalendlyApi({ token, fetchFn });

  await expect(client.fetchProviderResources({
    scheduledEventUri: eventUri,
    inviteeUri
  })).rejects.toHaveProperty("status", 503);
});
