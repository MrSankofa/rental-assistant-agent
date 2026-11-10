#!/usr/bin/env python3
"""Create exactly one fictional owner-inbox showing for controlled Resend acceptance.

Local Cloud Shell only. No messages, Calendly event or provider calls.
Refuse to overwrite any existing records.
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
BRANCH = "feature/persistent-agent-phases-21-22"
EMAIL = "brett@altruisticdevelopment.com"
SOURCE = "phase22-owner-email-test"
APPROVAL = "CREATE_ONE_PHASE22_OWNER_INBOX_FIXTURE"
BASE = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}/"
        f"databases/{DATABASE}/documents/scopes/{SCOPE}")
sha = lambda x: hashlib.sha256(x.encode("utf8")).hexdigest()[:40]
CONTACT_ID = "c_" + sha("phase22-owner-isolated-contact-v2|" + EMAIL)
ENGAGEMENT_ID = "e_" + sha("phase22-owner-isolated-engagement-v2|" + CONTACT_ID)
BOOKING_ID = "b_" + sha("phase22-owner-isolated-booking-v2")

def command(*arguments):
    return subprocess.check_output(arguments, text=True).strip()

def req(method, collection, identifier, bearer, value=None):
    base = f"{BASE}/{collection}"
    url = f"{base}/{identifier}" if method == "GET" else (
        base + "?documentId=" + urllib.parse.quote(identifier))
    headers = {"Authorization": "Bearer " + bearer}
    data = None
    if value is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps({"fields": {"payload": {
            "stringValue": json.dumps(value)
        }}}).encode("utf8")
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as reply:
            result = json.load(reply)
            return json.loads(result["fields"]["payload"]["stringValue"]) if method == "GET" else True
    except urllib.error.HTTPError as error:
        if error.code == 404 and method == "GET":
            return None
        raise RuntimeError(f"Firestore {method} rejected with HTTP {error.code}") from None

def main():
    if sys.argv[1:] != ["--create"] or os.environ.get("P22_OWNER_FIXTURE_APPROVAL") != APPROVAL:
        sys.exit("REFUSED: owner fixture approval not provided")
    if command("gcloud", "config", "get-value", "project") != PROJECT:
        sys.exit("REFUSED: incorrect GCP project")
    if command("git", "branch", "--show-current") != BRANCH:
        sys.exit("REFUSED: incorrect source branch")
    if command("git", "status", "--porcelain"):
        sys.exit("REFUSED: dirty source checkout")

    bearer = command("gcloud", "auth", "print-access-token")
    now = datetime.now(timezone.utc)
    start = now + timedelta(hours=12)
    fmt = lambda t: t.isoformat().replace("+00:00", "Z")
    at = fmt(now)
    rows = [
        ("contacts", {
            "id": CONTACT_ID, "name": "Phase Twenty Two Owner Test",
            "email": EMAIL, "phone": "", "preferredChannel": "email",
            "consent": {"recording": True, "email": True, "sms": False,
                        "at": at, "source": SOURCE},
            "createdAt": at, "updatedAt": at
        }),
        ("engagements", {
            "id": ENGAGEMENT_ID, "contactId": CONTACT_ID,
            "domain": "rental", "targetId": "ziegler",
            "source": SOURCE, "stage": "TOUR_SCHEDULED",
            "nextAction": "Fictional owner email acceptance",
            "nextActionOwner": "staff", "nextActionAt": at,
            "createdAt": at, "updatedAt": at,
            "history": [{"at": at, "actor": "test-fixture",
                         "stage": "TOUR_SCHEDULED"}]
        }),
        ("bookings", {
            "id": BOOKING_ID, "engagementId": ENGAGEMENT_ID,
            "propertyId": "ziegler", "provider": "calendly",
            "status": "scheduled", "crmSyncStatus": "completed",
            "source": SOURCE, "createdAt": at,
            "startsAt": fmt(start), "endsAt": fmt(start + timedelta(minutes=30))
        })
    ]
    # Versioned fixture-specific IDs isolate this record from existing owner
    # contacts. Refuse to overwrite even another test fixture.
    for collection, record in rows:
        if req("GET", collection, record["id"], bearer) is not None:
            sys.exit("REFUSED: record already exists; no changes made")

    for collection, record in rows:
        req("POST", collection, record["id"], bearer, record)

    print("PHASE22_OWNER_FIXTURE_CREATED_PASS")
    print("Booking ID:", BOOKING_ID)
    print("Fictional tour starts (UTC):", fmt(start))
    print("No email sent; no Calendly booking created")
    print("Next: execute review-only planner and confirm owner task before delivery")

if __name__ == "__main__":
    main()
