"""
Read-mostly probe for the account-level restriction found between
mkt.szone@gmail.com (PATCH config.accessType works, 200) and
projectaadminsz@gmail.com (same PATCH, on a Space it created itself via
v2, always 403) — both workspaces (sale, infra) sharing this second
account behave the same way, pointing at something specific to THAT
Google account rather than anything in this app's code/architecture.

For each given workspace code, in order:
  1. GET userinfo (oauth2/v1/userinfo) — confirms the real email/verified
     status for the token actually in use.
  2. GET people.googleapis.com/v1/people/me?personFields=organizations —
     a personal Gmail account returns an empty/absent `organizations`
     list; a Google Workspace (org-managed) account typically returns at
     least one entry with a domain. This is the main signal for "is this
     actually a personal Gmail, or an org-managed Workspace account".
  3. GET admin/directory/v1/users/{email} — included only to rule it out
     explicitly; expected to fail (403/404) for a personal account, since
     that API requires domain-admin privileges this token almost
     certainly doesn't have. Printed either way, not interpreted as an
     error.
  4. Creates a brand-new Space directly via v2 (so ownership is
     unambiguous — THIS exact token created THIS exact Space), prints the
     full GET response for manual side-by-side diffing against another
     workspace's run of this same script.
  5. PATCHes config.accessType on that Space (expected: 200 for an
     unrestricted account, 403 for a restricted one).
  6. PATCHes config.moderation on the SAME Space (different field) — if
     this ALSO 403s the same way, the restriction is account/org-wide, not
     specific to accessType.

Nothing here touches this app's own database. The only side effect is
leaving a small orphaned test Space on Google's side per workspace run
(Meet API v2 has no delete endpoint — same as every other probe this
session) — harmless.

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container> python - mkt sale infra < diagnose_account_restriction.py
"""
import json
import sys

import requests

from app.database import SessionLocal
from app.models.system_category import Workspace
from app.services.meeting_sync import get_workspace_google_access_token


def _pretty(resp):
    print(f"status: {resp.status_code}")
    try:
        print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
    except Exception:
        print(resp.text[:1000])


def run_for_workspace(db, ws_code: str):
    ws = db.query(Workspace).filter(Workspace.code == ws_code).first()
    if not ws:
        print(f"No workspace with code='{ws_code}'")
        return
    try:
        token = get_workspace_google_access_token(db, ws.id)
    except Exception as e:
        print(f"  FAILED to get access token for '{ws_code}': {e!r}")
        return
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    print(f"\n{'#' * 70}")
    print(f"# Workspace '{ws_code}' (id={ws.id})")
    print(f"{'#' * 70}")

    print("\n--- STEP 1: userinfo ---")
    r1 = requests.get("https://www.googleapis.com/oauth2/v1/userinfo", params={"alt": "json"}, headers=headers, timeout=10)
    _pretty(r1)
    email = r1.json().get("email") if r1.ok else None

    print("\n--- STEP 2: people.googleapis.com organizations ---")
    r2 = requests.get(
        "https://people.googleapis.com/v1/people/me",
        params={"personFields": "organizations"},
        headers=headers,
        timeout=10,
    )
    _pretty(r2)
    if r2.ok and r2.json().get("organizations"):
        print("--> HAS an 'organizations' entry — looks like an org-managed Workspace account.")
    else:
        print("--> NO 'organizations' entry — looks like a plain personal Gmail account.")

    print("\n--- STEP 3: admin/directory (expected to fail for a personal account) ---")
    if email:
        r3 = requests.get(f"https://www.googleapis.com/admin/directory/v1/users/{email}", headers=headers, timeout=10)
        _pretty(r3)
    else:
        print("Skipped — no email resolved from step 1.")

    print("\n--- STEP 4: create a brand-new Space via v2 (unambiguous ownership) ---")
    create_resp = requests.post("https://meet.googleapis.com/v2/spaces", headers=headers, json={}, timeout=15)
    _pretty(create_resp)
    if not create_resp.ok:
        print("ABORTING this workspace — could not even create a Space.")
        return
    space_name = create_resp.json().get("name")
    get_resp = requests.get(f"https://meet.googleapis.com/v2/{space_name}", headers=headers, timeout=15)
    print(f"\nFull GET {space_name}:")
    _pretty(get_resp)

    print(f"\n--- STEP 5: PATCH config.accessType on {space_name} ---")
    patch_access = requests.patch(
        f"https://meet.googleapis.com/v2/{space_name}",
        params={"updateMask": "config.accessType"},
        headers=headers,
        json={"config": {"accessType": "OPEN"}},
        timeout=15,
    )
    _pretty(patch_access)

    print(f"\n--- STEP 6: PATCH config.moderation on the SAME {space_name} ---")
    patch_mod = requests.patch(
        f"https://meet.googleapis.com/v2/{space_name}",
        params={"updateMask": "config.moderation"},
        headers=headers,
        json={"config": {"moderation": "ON"}},
        timeout=15,
    )
    _pretty(patch_mod)

    print(f"\n=== SUMMARY for '{ws_code}' ({email}) ===")
    print(f"accessType PATCH: {patch_access.status_code}  |  moderation PATCH: {patch_mod.status_code}")
    if patch_access.status_code == patch_mod.status_code == 200:
        print("Both succeeded — this account can write this Space's config generally.")
    elif patch_access.status_code != 200 and patch_mod.status_code != 200:
        print("BOTH blocked the same way — looks like an account/org-wide restriction, not specific to accessType.")
    else:
        print("MIXED result — accessType and moderation behave differently; worth a closer look at each error body above.")


def main():
    codes = [c.strip().lower() for c in sys.argv[1:] if c.strip()]
    if not codes:
        print("Usage: diagnose_account_restriction.py <workspace_code> [workspace_code ...]")
        return
    db = SessionLocal()
    try:
        for code in codes:
            run_for_workspace(db, code)
    finally:
        db.close()


if __name__ == "__main__":
    main()
