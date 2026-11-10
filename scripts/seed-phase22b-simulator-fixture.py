#!/usr/bin/env python3
"""Create ONE fictional, explicitly opted-in tour in isolated Firestore staging.

No provider calls, no emails, no bookings sent to Calendly.
The existing review-only planner creates the two tasks separately.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

PROJECT = "altruistic-platform"
DATABASE = "rental-email-staging"
SCOPE = "rental-staging"
APPROVAL = "CREATE_PHASE22B_SIMULATION_FIXTURE_ONLY"
BRANCH = "feature/persistent-agent-phases-21-22"
SOURCE = "phase22-fictional-test"
EMAIL = "phase22b-simulator-fixture@example.test"
BASE = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/documents/scopes/{SCOPE}")

def sha(value):
    return hashlib.sha256(value.encode("utf8")).hexdigest()[:40]

CONTACT_ID = "c_" + sha(SCOPE + "|" + EMAIL)
ENGAGEMENT_ID = "e_" + sha(CONTACT_ID + "|rental|ziegler")
BOOKING_ID = "b_" + sha("phase22b-simulator-fixture-v1")

def command(*args):
    return subprocess.check_output(args, text=True).strip()

def firestore(method, collection, record_id, bearer, payload=None):
    url = BASE + "/" + collection
    if method == "GET":
        url += "/" + record_id
    elif method == "POST":
        url += "?documentId=" + urllib.parse.quote(record_id)
    else:
        raise ValueError("Unsupported method")
    headers = {"Authorization": "Bearer " + bearer}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps({"fields": {
            "payload": {"stringValue": json.dumps(payload)}
        }}).encode("utf8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
            return json.loads(result["fields"]["payload"]["stringValue"]) if method == "GET" else True
    except urllib.error.HTTPError as error:
        if method == "GET" and error.code == 404:
            return None
        if method == "POST" and error.code == 409:
            raise RuntimeError("Concurrent fixture creation or ID collision") from None
        raise RuntimeError(f"Firestore {method} failed HTTP {error.code}") from None

def main():
    if len(sys.argv) != 2 or sys.argv[1] != "--create" or os.environ.get("P22B_FIXTURE_APPROVAL") != APPROVAL:
        sys.exit("REFUSED: explicit fictional fixture approval required")
    if command("gcloud", "config", "get-value", "project") != PROJECT:
        sys.exit("REFUSED: unexpected GCP project")
    if command("git", "branch", "--show-current") != BRANCH:
        sys.exit("REFUSED: unexpected branch")
    if command("git", "status", "--porcelain"):
        sys.exit("REFUSED: dirty working tree")

    bearer = command("gcloud", "auth", "print-access-token")
    now = datetime.now(timezone.utc)
    start = now + timedelta(hours=12)
    end = start + timedelta(minutes=30)
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    created = stamp(now)

    rows = [
        ("contacts", {
            "id": CONTACT_ID, "name": "Phase Twenty Two B Fictional",
            "email": EMAIL, "phone": "", "preferredChannel": "email",
            "consent": {"recording": True, "email": True, "sms": False,
                        "at": created, "source": SOURCE},
            "createdAt": created, "updatedAt": created
        }),
        ("engagements", {
            "id": ENGAGEMENT_ID, "contactId": CONTACT_ID,
            "domain": "rental", "targetId": "ziegler", "source": SOURCE,
            "stage": "TOUR_SCHEDULED", "nextAction": "Attend fictional showing",
            "nextActionOwner": "staff", "nextActionAt": created,
            "createdAt": created, "updatedAt": created,
            "history": [{"at": created, "actor": "test-fixture",
                         "stage": "TOUR_SCHEDULED"}]
        }),
        ("bookings", {
            "id": BOOKING_ID, "engagementId": ENGAGEMENT_ID,
            "propertyId": "ziegler", "provider": "calendly",
            "status": "scheduled", "crmSyncStatus": "completed",
            "source": SOURCE, "createdAt": created,
            "startsAt": stamp(start), "endsAt": stamp(end)
        })
    ]

    # All-or-nothing preflight against an existing fixture ID. This is
    # deliberately a one-shot test; never reset statuses after delivery.
    for collection, record in rows:
        if firestore("GET", collection, record["id"], bearer) is not None:
            sys.exit("REFUSED: fixture ID already exists; no records changed")

    for collection, record in rows:
        firestore("POST", collection, record["id"], bearer, record)

    print("PHASE22B_FICTIONAL_BOOKING_CREATED_PASS")
    print("Booking ID:", BOOKING_ID)
    print("Start UTC:", stamp(start))
    print("Email address uses reserved .test domain; no provider configured")
    print("Next: run the existing review-only tour planner job")

if __name__ == "__main__":
    main()
