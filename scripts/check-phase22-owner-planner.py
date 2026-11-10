#!/usr/bin/env python3
"""Read-only owner-fixture and planner task acceptance, without PII output."""
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT="altruistic-platform"
DATABASE="rental-email-staging"
SCOPE="rental-staging"
BOOKING_ID="b_1f5d234c57d772e4a5cfe911eb2e87bb4564b072"
BASE=f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/scopes/{SCOPE}"
SOURCE="phase22-owner-email-test"
def cmd(*args):
    return subprocess.check_output(args,text=True).strip()
def main():
    if cmd("gcloud","config","get-value","project")!=PROJECT:
        sys.exit("SAFETY_STOP: wrong GCP project")
    if cmd("git","branch","--show-current")!="feature/persistent-agent-phases-21-22":
        sys.exit("SAFETY_STOP: wrong branch")
    token=cmd("gcloud","auth","print-access-token")
    def get(collection,id):
        request=urllib.request.Request(
            BASE+"/"+collection+"/"+id,headers={"Authorization":"Bearer "+token})
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                doc=json.load(response)
        except urllib.error.HTTPError as error:
            sys.exit(f"SAFETY_STOP: {collection} read HTTP {error.code}")
        return json.loads(doc["fields"]["payload"]["stringValue"])
    booking=get("bookings",BOOKING_ID)
    assert booking["id"]==BOOKING_ID and booking["source"]==SOURCE
    assert booking["status"]=="scheduled" and booking["crmSyncStatus"]=="completed"
    engagement=get("engagements",booking["engagementId"])
    contact=get("contacts",engagement["contactId"])
    assert engagement["source"]==SOURCE
    assert engagement["id"]==booking["engagementId"]
    assert engagement["stage"]=="TOUR_SCHEDULED"
    assert engagement["contactId"]==contact["id"]
    assert contact["email"]=="brett@altruisticdevelopment.com"
    assert contact["consent"]["email"] is True
    assert contact["consent"]["recording"] is True
    for type in ("TOUR_CONFIRMATION","TOUR_REMINDER"):
        raw="|".join(("prospect-tour-messages-v1",BOOKING_ID,
                      booking["startsAt"],type))
        task_id="pm_"+hashlib.sha256(raw.encode()).hexdigest()[:40]
        task=get("tasks",task_id)
        assert (task["id"]==task_id and task["type"]==type
                and task["source"]=="prospect-tour-planner"
                and task["policyVersion"]=="prospect-tour-messages-v1"
                and task["bookingId"]==BOOKING_ID
                and task["engagementId"]==engagement["id"]
                and task["recipientContactId"]==contact["id"]
                and task["status"]=="pending-approval"
                and task["approved"] is False
                and task["deliveryEnabled"] is False
                and task["automatedDelivery"] is False)
        print(type,"task:",task_id,"status:",task["status"])
        if type=="TOUR_CONFIRMATION":
            print("OWNER_CONFIRMATION_TASK_ID="+task_id)
    print("PHASE22_OWNER_PLANNER_PREFLIGHT_PASS")
    print("No emails or Firestore writes performed")
if __name__=="__main__":
    main()
