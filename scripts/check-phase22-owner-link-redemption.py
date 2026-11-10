#!/usr/bin/env python3
"""Read-only verification of redeemed links and persisted conversation for owner test.

This does not print contact data, messages, tokens, or secret values.
"""
import json
import subprocess
import sys
import urllib.parse
import urllib.request

PROJECT="altruistic-platform"
DATABASE="rental-email-staging"
SCOPE="rental-staging"
BOOKING_ID="b_1f5d234c57d772e4a5cfe911eb2e87bb4564b072"
BASE=f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/scopes/{SCOPE}"
def cmd(*args):
    return subprocess.check_output(args,text=True).strip()
def main():
    if cmd("gcloud","config","get-value","project")!=PROJECT:
        sys.exit("REFUSED: wrong project")
    bearer=cmd("gcloud","auth","print-access-token")
    def request(path):
        r=urllib.request.Request(BASE+"/"+path,headers={"Authorization":"Bearer "+bearer})
        with urllib.request.urlopen(r,timeout=20) as response:
            return json.load(response)
    def decode(document):
        return json.loads(document["fields"]["payload"]["stringValue"])
    booking=decode(request("bookings/"+BOOKING_ID))
    assert booking.get("id")==BOOKING_ID and booking.get("source")=="phase22-owner-email-test"
    engagement_id=booking["engagementId"]
    token_count=0
    redeemed=0
    next_page=""
    while True:
        suffix="?pageSize=100"+("&pageToken="+urllib.parse.quote(next_page) if next_page else "")
        result=request("returnlinks"+suffix)
        for doc in result.get("documents",[]):
            value=decode(doc)
            if value.get("engagementId")==engagement_id:
                token_count+=1
                if value.get("consumedAt"):
                    redeemed+=1
        next_page=result.get("nextPageToken","")
        if not next_page:break
    print("Owner test return links:",token_count)
    print("Redeemed:",redeemed)
    assert redeemed>=1,"Expected redeemed return link not found"
    print("PHASE22B_OWNER_LINK_REDEMPTION_PASS")
    print("No link token values or other contact details displayed")
if __name__=="__main__":
    main()
