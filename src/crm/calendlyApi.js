"use strict";

const fail = (message) =>
  Object.assign(new Error(message), { status: 503 });

const EVENT =
  /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+$/;

const INVITEE =
  /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+\/invitees\/[A-Za-z0-9-]+$/;

// Inject fetch for isolated tests.
// Never log or return the API access token.
function makeCalendlyApi({
  token,
  fetchFn = globalThis.fetch
}) {
  if (typeof token !== "string" ||
      token.length < 16 ||
      typeof fetchFn !== "function") {
    throw fail("Calendly API configuration unavailable");
  }

  async function get(uri, pattern) {
    if (typeof uri !== "string" || !pattern.test(uri)) {
      throw fail("Untrusted Calendly resource URI");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetchFn(uri, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw fail("Calendly resource lookup failed");
      }

      const result = await response.json();

      if (!result ||
          !result.resource ||
          result.resource.uri !== uri) {
        throw fail("Calendly response reference mismatch");
      }

      return result.resource;
    } catch (_) {
      throw fail("Calendly resource lookup failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async fetchProviderResources({
      scheduledEventUri,
      inviteeUri
    }) {
      if (!EVENT.test(scheduledEventUri || "") ||
          !INVITEE.test(inviteeUri || "") ||
          !inviteeUri.startsWith(scheduledEventUri + "/invitees/")) {
        throw fail("Invalid Calendly resource relationship");
      }

      const scheduledEvent = await get(
        scheduledEventUri, EVENT
      );

      const invitee = await get(inviteeUri, INVITEE);

      if (invitee.event !== scheduledEvent.uri) {
        throw fail("Calendly appointment mismatch");
      }

      return { scheduledEvent, invitee };
    }
  };
}

module.exports = { makeCalendlyApi };
