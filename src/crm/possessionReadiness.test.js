"use strict";

const {
  evaluatePossessionReadiness: evaluate
} = require("./possessionReadiness");

function fixture() {
  return {
    id: "e_fictional_phase24_readiness",
    domain: "rental",
    targetId: "ziegler",
    stage: "APPROVED",
    handoff: {
      decision: {status: "approved"}
    },
    parallelMoveIn: {
      tracks: {
        lease: {status: "signed"},
        rentredi: {status: "invited"},
        rent: {status: "verified"},
        deposit: {status: "verified"},
        disclosures: {status: "delivered"},
        possession: {status: "lawful-ready"}
      }
    }
  };
}

describe("Phase 24D possession readiness", () => {
  test("complete tracks require separate owner decision", () => {
    const result = evaluate(fixture());

    expect(result.eligibleForOwnerReview).toBe(true);
    expect(result.keysAuthorized).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test("reported payment is not verified payment", () => {
    const engagement = fixture();

    engagement.parallelMoveIn.tracks.deposit.status =
      "received";

    const result = evaluate(engagement);

    expect(result.eligibleForOwnerReview).toBe(false);
    expect(result.missing).toContain(
      "Deposit independently verified"
    );
    expect(result.keysAuthorized).toBe(false);
  });

  test("missing disclosure or signature blocks eligibility", () => {
    const engagement = fixture();

    delete engagement.parallelMoveIn.tracks.disclosures;
    engagement.parallelMoveIn.tracks.lease.status = "sent";

    const result = evaluate(engagement);

    expect(result.eligibleForOwnerReview).toBe(false);
    expect(result.missing).toContain(
      "Lease signature verified"
    );
    expect(result.missing).toContain(
      "Required disclosures confirmed"
    );
  });

  test("closed, unapproved, and invalid records blocked", () => {
    const closed = fixture();
    closed.stage = "WITHDRAWN";

    expect(evaluate(closed).eligibleForOwnerReview)
      .toBe(false);

    const unapproved = fixture();
    unapproved.handoff.decision.status = "denied";

    expect(evaluate(unapproved).eligibleForOwnerReview)
      .toBe(false);

    expect(evaluate(null).keysAuthorized).toBe(false);
    expect(evaluate({domain:"community"}).blocked).toBe(true);
  });

  test("readiness never changes the engagement", () => {
    const engagement = fixture();
    const before = JSON.stringify(engagement);

    evaluate(engagement);

    expect(JSON.stringify(engagement)).toBe(before);
  });
});
