"use strict";

const EVENT_TYPE =
  /^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9-]+$/;

const USER =
  /^https:\/\/api\.calendly\.com\/users\/[A-Za-z0-9-]+$/;

// This validator uses application-controlled configuration,
// not identifiers received from webhook payloads.
function verifyCalendlyOwnership({
  scheduledEvent,
  expectedEventTypeUri,
  expectedHostUri
}) {
  const reject = reason => ({
    verified: false,
    reason
  });

  if (!EVENT_TYPE.test(expectedEventTypeUri || "") ||
      !USER.test(expectedHostUri || "")) {
    return reject("ownership-configuration-missing");
  }

  if (!scheduledEvent ||
      scheduledEvent.event_type !== expectedEventTypeUri) {
    return reject("event-type-mismatch");
  }

  if (!Array.isArray(scheduledEvent.event_memberships) ||
      scheduledEvent.event_memberships.length === 0) {
    return reject("host-membership-unavailable");
  }

  const hosts = scheduledEvent.event_memberships.map(
    membership => membership && membership.user
  );

  if (hosts.some(host =>
    typeof host !== "string" || !USER.test(host)
  )) {
    return reject("invalid-host-membership");
  }

  // Initial release supports one explicitly configured host.
  // Multi-host events require a separate approved policy.
  if (hosts.length !== 1 || hosts[0] !== expectedHostUri) {
    return reject("host-mismatch");
  }

  return {
    verified: true,
    propertyId: "ziegler",
    eventTypeUri: expectedEventTypeUri,
    hostUri: expectedHostUri
  };
}

module.exports = { verifyCalendlyOwnership };
