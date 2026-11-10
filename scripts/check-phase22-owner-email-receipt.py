#!/usr/bin/env python3
"""Read-only acceptance for the Phase22 owner email task and redeemed return link.

No tokens, message contents, or recipient addresses are printed.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "altruistic-platform"
DATABASE = "rental-email-staging"
SCOPE = "rental-staging"
TASK_ID = "pm_dec914a6456404ef11468d621d0b0d7b1312a5a5"
BOOKING_ID = "b_1f5d234c57d772e4a5cfe911eb2e87bb4564b072"
EXPECTED_PROVIDER_ID = "01a1c72a-09af-70b0-8dde-6c7c5f2a33d9"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/scopes/{SCOPE}"

def cmd(*args):
    return subprocess.check_output(args, text=True).strip()

def main():
    if cmd("gcloud", "config", "get-value", "project") != PROJECT:
        sys.exit("SAFETY_STOP: wrong project")
    if cmd("git", "branch", "--show-current") != "feature/persistent-agent-phases-21-22":
        sys.exit("SAFETY_STOP: wrong branch")
    token = cmd("gcloud", "auth", "print-access-token")
    def get(collection, identifier):
        url = BASE + "/" + collection + "/" + identifier
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(request, timeout=20) as reply:
                record = json.load(reply)
        except urllib.error.HTTPError as error:
            sys.exit(f"SAFETY_STOP: {collection} HTTP {error.code}")
        return json.loads(record["fields"]["payload"]["stringValue"])

    task = get("tasks", TASK_ID)
    assert task["id"] == TASK_ID
    assert task["type"] == "TOUR_CONFIRMATION"
    assert task["source"] == "prospect-tour-planner"
    assert task["bookingId"] == BOOKING_ID
    assert task["status"] == "owner-delivery-accepted", "Receipt not accepted"
    delivery = task["ownerDelivery"]
    assert delivery["status"] == "accepted"
    assert delivery["providerId"] == EXPECTED_PROVIDER_ID
    assert delivery["idempotencyKey"] == "p22-owner-" + TASK_ID

    booking = get("bookings", BOOKING_ID)
    assert booking["source"] == "phase22-owner-email-test"
    assert booking["status"] == "scheduled"

    print("PHASE22B_PROVIDER_RECEIPT_PERSISTED_PASS")
    print("Confirmation status: owner-delivery-accepted")
    print("Provider ID matches expected")
    print("Single-claim idempotency key matches expected")
    print("No provider request or Firestore write performed")

if __name__ == "__main__":
    main()
