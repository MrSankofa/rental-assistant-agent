#!/usr/bin/env python3
"""One-off staging fictional prospect + browser return link, no email/provider calls.

Run only in Cloud Shell, with --issue and explicit approval.
Writes credentials only into a chmod-0600 local file. No tokens in logs.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

PROJECT = "altruistic-platform"
DATABASE = "rental-email-staging"
SCOPE = "rental-staging"
APPROVAL = "CREATE_ONE_FICTIONAL_PROSPECT_RETURN_LINK"
EMAIL = "phase21-fictional-prospect@example.test"
NAME = "Phase Twentyone Fictional"
TARGET = "ziegler"
BASE = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
    f"/databases/{DATABASE}/documents/scopes/{SCOPE}"
)

def digest(value):
    return hashlib.sha256(value.encode("utf8")).hexdigest()

def identity():
    contact_id = "c_" + digest(SCOPE + "|" + EMAIL)[:40]
    engagement_id = "e_" + digest(contact_id + "|rental|" + TARGET)[:40]
    return contact_id, engagement_id

def access_token():
    return subprocess.check_output(
        ["gcloud", "auth", "print-access-token"], text=True
    ).strip()

def request(method, url, bearer, payload=None):
    headers = {"Authorization": "Bearer " + bearer}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf8")
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return 404, None
        if error.code == 409:
            return 409, None
        raise RuntimeError(f"Firestore {method} returned HTTP {error.code}") from None

def encoded(value):
    return {"fields": {"payload": {"stringValue": json.dumps(value)}}}

def get(bearer, collection, identifier):
    status, doc = request("GET", BASE + "/" + collection + "/" + identifier, bearer)
    if status == 404:
        return None
    return json.loads(doc["fields"]["payload"]["stringValue"])

def create(bearer, collection, identifier, value):
    url = BASE + "/" + collection + "?documentId=" + urllib.parse.quote(identifier)
    status, _ = request("POST", url, bearer, encoded(value))
    return status != 409

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue", action="store_true")
    parser.add_argument("--origin", required=True,
                        help="Exact HTTPS Cloud Shell preview origin")
    args = parser.parse_args()
    if not args.issue or os.getenv("P21_FIXTURE_APPROVAL") != APPROVAL:
        sys.exit("REFUSED: explicit fictional staging approval required")
    if not re.fullmatch(r"https://8081-cs-[a-z0-9-]+\.cs-[a-z0-9-]+\.cloudshell\.dev", args.origin):
        sys.exit("REFUSED: unexpected Cloud Shell preview origin")
    if subprocess.check_output(
        ["gcloud", "config", "get-value", "project"], text=True
    ).strip() != PROJECT:
        sys.exit("REFUSED: unexpected GCP project")
    if subprocess.check_output(
        ["git", "branch", "--show-current"], text=True
    ).strip() != "feature/persistent-agent-phases-21-22":
        sys.exit("REFUSED: unexpected source branch")
    if subprocess.check_output(["git", "status", "--porcelain"], text=True).strip():
        sys.exit("REFUSED: dirty worktree")
    bearer = access_token()
    contact_id, engagement_id = identity()
    now = datetime.now(timezone.utc)
    at = now.isoformat()
    contact = {
        "id": contact_id, "name": NAME, "email": EMAIL, "phone": "",
        "preferredChannel": "email",
        "consent": {"recording": True, "email": False, "sms": False,
                    "at": at, "source": "phase21-fictional-test"},
        "createdAt": at, "updatedAt": at
    }
    engagement = {
        "id": engagement_id, "contactId": contact_id, "domain": "rental",
        "targetId": TARGET, "source": "phase21-fictional-test",
        "interest": "Return conversation test", "stage": "CONTACT_CAPTURED",
        "nextAction": "Staff review intake", "nextActionOwner": "staff",
        "nextActionAt": at, "createdAt": at, "updatedAt": at,
        "history": [{"at": at, "actor": "test-fixture",
                     "stage": "CONTACT_CAPTURED"}]
    }
    # Never overwrite another record. Reuse only the exact fictional fixture.
    for collection, identifier, expected, safe_fields in (
        ("contacts", contact_id, contact, ("id", "name", "email")),
        ("engagements", engagement_id, engagement,
         ("id", "contactId", "domain", "targetId", "source")),
    ):
        existing = get(bearer, collection, identifier)
        if existing is not None and any(
            existing.get(key) != expected[key] for key in safe_fields
        ):
            sys.exit("REFUSED: existing non-fixture CRM record")
        if existing is None and not create(bearer, collection, identifier, expected):
            sys.exit("REFUSED: concurrent fixture creation")

    raw = secrets.token_urlsafe(32)
    link_id = "rl_" + digest(raw)
    expires = (now + timedelta(hours=48)).isoformat()
    record = {
        "id": link_id, "contactId": contact_id,
        "engagementId": engagement_id,
        "createdAt": at, "expiresAt": expires, "consumedAt": None,
    }
    if not create(bearer, "returnlinks", link_id, record):
        sys.exit("REFUSED: token collision")

    # Keep the return credential off terminal output and all Cloud Run logs.
    out = pathlib.Path.home() / ".p21-fictional-return-url"
    fd = os.open(str(out), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(args.origin + "/#resume=" + raw + "\n")
    os.chmod(out, 0o600)
    print("PHASE21_FICTIONAL_FIXTURE_CREATED_PASS")
    print("Return link file:", out)
    print("Open it locally; do not paste the URL or token into chat.")
    print("Link expiration (UTC):", expires)

if __name__ == "__main__":
    main()
