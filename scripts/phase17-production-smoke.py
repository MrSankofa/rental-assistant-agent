#!/usr/bin/env python3
"""Read-only production verification plus a rejected intake request.

Never creates a prospect, sends email, or changes CRM state.
"""
import hashlib
import json
import subprocess
import urllib.error
import urllib.request

PROJECT = "altruistic-platform"
DB = "rental-leads-prod"
SCOPE = "rental-live"
ORIGIN = (
    "https://rental-assistant-live-candidate-"
    "mucnnafpaa-ul.a.run.app"
)
BASE = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
    f"/databases/{DB}/documents/scopes/{SCOPE}"
)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()[:40]


def get_json(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected HTTP {response.status}")
        return json.load(response)


def firestore_token():
    return subprocess.check_output(
        ["gcloud", "auth", "print-access-token"],
        text=True
    ).strip()


def document(collection, document_id, token):
    url = f"{BASE}/{collection}/{document_id}"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    print("===== 1. PUBLIC HEALTH =====")
    status = get_json(ORIGIN + "/api/crm/status")

    assert status["publicIntakeEnabled"] is True
    assert status["realIntakeEnabled"] is True
    assert status["stagingTestMode"] is False
    assert status.get("turnstileSiteKey")
    assert status["privacyUrl"] == (
        "https://altruisticdevelopment.com/privacy/"
    )
    print("PRODUCTION_HEALTH_AND_INTAKE_CONFIG_PASS")

    print("===== 2. EXISTING TEST FIXTURE =====")
    email = input("Existing Phase 17 test email: ").strip().lower()

    if not email or "@" not in email:
        raise RuntimeError("Invalid test email")

    contact_id = "c_" + digest(SCOPE + "|" + email)
    engagement_id = "e_" + digest(
        contact_id + "|rental|ziegler"
    )

    token = firestore_token()

    before_contact = document("contacts", contact_id, token)
    before_engagement = document(
        "engagements", engagement_id, token
    )

    contact = json.loads(
        before_contact["fields"]["payload"]["stringValue"]
    )
    engagement = json.loads(
        before_engagement["fields"]["payload"]["stringValue"]
    )

    assert contact["id"] == contact_id
    assert contact["email"].lower() == email
    assert contact["consent"]["email"] is False
    assert engagement["contactId"] == contact_id
    assert engagement["targetId"] == "ziegler"
    assert engagement["stage"] == "TOUR_CANCELLED"

    print("PRODUCTION_EXISTING_FIXTURE_PASS")
    print("PRODUCTION_NO_EMAIL_CONSENT_PASS")

    print("===== 3. REJECT UNTRUSTED INTAKE ORIGIN =====")

    payload = {
        "name": "Fictional Smoke",
        "email": "fictional-smoke@example.test",
        "phone": "",
        "domain": "rental",
        "targetId": "ziegler",
        "interest": "Tour inquiry",
        "consent": {
            "recording": True,
            "email": False,
            "sms": False
        },
        "turnstileToken": ""
    }

    request = urllib.request.Request(
        ORIGIN + "/api/crm/intake",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Origin": "https://untrusted.example",
            "Content-Type": "application/json"
        }
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raise RuntimeError(
                f"Unsafe request unexpectedly returned {response.status}"
            )
    except urllib.error.HTTPError as error:
        if error.code != 403:
            raise RuntimeError(
                f"Expected 403, received {error.code}"
            ) from error

    print("PRODUCTION_UNTRUSTED_ORIGIN_REJECTED_PASS")

    print("===== 4. VERIFY TEST FIXTURE UNCHANGED =====")

    after_contact = document("contacts", contact_id, token)
    after_engagement = document(
        "engagements", engagement_id, token
    )

    assert before_contact == after_contact
    assert before_engagement == after_engagement

    print("PRODUCTION_TEST_FIXTURE_UNCHANGED_PASS")
    print("PHASE17_REUSABLE_PRODUCTION_SMOKE_PASS")


if __name__ == "__main__":
    main()
