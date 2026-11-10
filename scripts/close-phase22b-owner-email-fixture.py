#!/usr/bin/env python3
"""Close only the known Phase 22B owner email test tour after acceptance."""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROJECT = "altruistic-platform"
DATABASE = "rental-email-staging"
SCOPE = "rental-staging"
ID = "b_1f5d234c57d772e4a5cfe911eb2e87bb4564b072"
APPROVAL = "CLOSE_PHASE22B_OWNER_TEST_BOOKING_ONLY"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/scopes/{SCOPE}"
def cmd(*args):
    return subprocess.check_output(args, text=True).strip()
def main():
    if sys.argv[1:] != ["--close"] or os.getenv("P22B_OWNER_CLEANUP_APPROVAL") != APPROVAL:
        sys.exit("REFUSED: explicit fixture cleanup approval required")
    if cmd("gcloud", "config", "get-value", "project") != PROJECT or (
        cmd("git", "branch", "--show-current") != "feature/persistent-agent-phases-21-22"):
        sys.exit("REFUSED: project or branch mismatch")
    token = cmd("gcloud", "auth", "print-access-token")
    headers = {"Authorization": "Bearer " + token}
    url = BASE + "/bookings/" + ID
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as result:
        document = json.load(result)
    booking = json.loads(document["fields"]["payload"]["stringValue"])
    if (booking.get("id") != ID or booking.get("source") != "phase22-owner-email-test"
            or booking.get("provider") != "calendly"
            or booking.get("propertyId") != "ziegler"
            or booking.get("crmSyncStatus") != "completed"):
        sys.exit("REFUSED: unexpected booking record")
    if booking.get("status") == "cancelled":
        print("PHASE22B_FIXTURE_ALREADY_CLOSED_PASS")
        return
    if booking.get("status") != "scheduled":
        sys.exit("REFUSED: booking in unexpected state")
    booking["status"] = "cancelled"
    booking["updatedAt"] = datetime.now(timezone.utc).isoformat()
    query = urllib.parse.urlencode({
        "updateMask.fieldPaths": "payload",
        "currentDocument.updateTime": document["updateTime"]
    })
    body = json.dumps({"fields": {"payload": {
        "stringValue": json.dumps(booking)
    }}}).encode()
    headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(
            url + "?" + query, headers=headers, data=body, method="PATCH"
        ), timeout=20):
            pass
    except urllib.error.HTTPError as error:
        sys.exit(f"SAFETY_STOP: concurrency or storage error HTTP {error.code}")
    print("PHASE22B_OWNER_BOOKING_CLOSED_PASS")
    print("Booking:", ID)
    print("No additional emails sent by cleanup")
if __name__ == "__main__":
    main()
