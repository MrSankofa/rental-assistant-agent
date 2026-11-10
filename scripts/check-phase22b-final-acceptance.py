#!/usr/bin/env python3
"""Phase 22B read-only closeout: cancelled owner booking, cancelled unused reminder,
accepted confirmation receipt. This script never prints tokens or customer details.
"""
import json
import subprocess
import sys
import urllib.request
PROJECT="altruistic-platform"
DATABASE="rental-email-staging"
SCOPE="rental-staging"
BOOKING="b_1f5d234c57d772e4a5cfe911eb2e87bb4564b072"
CONFIRMATION="pm_dec914a6456404ef11468d621d0b0d7b1312a5a5"
REMINDER="pm_2d89c22cfce52f42313ee3077f4c5709e95b4aa7"
RECEIPT="01a1c72a-09af-70b0-8dde-6c7c5f2a33d9"
BASE=f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/scopes/{SCOPE}/"
def cmd(*args):
    return subprocess.check_output(args,text=True).strip()
def main():
    if cmd("gcloud","config","get-value","project")!=PROJECT:
        sys.exit("SAFETY_STOP: wrong project")
    token=cmd("gcloud","auth","print-access-token")
    def get(collection,identifier):
        request=urllib.request.Request(BASE+collection+"/"+identifier,headers={
            "Authorization":"Bearer "+token})
        with urllib.request.urlopen(request,timeout=20) as response:
            doc=json.load(response)
        return json.loads(doc["fields"]["payload"]["stringValue"])
    booking=get("bookings",BOOKING)
    assert booking["source"]=="phase22-owner-email-test"
    assert booking["status"]=="cancelled"
    confirmation=get("tasks",CONFIRMATION)
    assert confirmation["status"]=="owner-delivery-accepted"
    assert confirmation["ownerDelivery"]["status"]=="accepted"
    assert confirmation["ownerDelivery"]["providerId"]==RECEIPT
    reminder=get("tasks",REMINDER)
    assert reminder["status"]=="cancelled", "Planner must cancel the unused reminder"
    assert reminder["bookingId"]==BOOKING
    print("PHASE22B_CLOSED_BOOKING_PASS")
    print("PHASE22B_ACCEPTED_PROVIDER_RECEIPT_RETAINED_PASS")
    print("PHASE22B_UNUSED_REMINDER_CANCELLED_PASS")
    print("PHASE22B_FINAL_DATA_ACCEPTANCE_PASS")
if __name__=="__main__":
    main()
