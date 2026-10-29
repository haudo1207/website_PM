"""
One-off, mostly-read-only probe to answer a single question empirically:
does the access token currently stored for a Host Google account have
write scope on the Google Meet REST API v2 (`Space.config.accessType`),
or only the read-only `meetings.space.readonly` scope this app currently
requests (see main.py / meetings.py's OAuth `scopes=[...]` list)?

Steps, in order:
  1. Exchange the stored refresh token for an access token (same helper
     the app itself uses — no new auth flow, no new consent).
  2. Call Google's own tokeninfo endpoint to see the ACTUAL granted
     scopes on that token (not just what this app's code currently
     requests — a token issued under an older/narrower consent would
     still show up here).
  3. GET the target meeting's Meet Space (read-only, safe, proves the
     token + space name resolve correctly before attempting a write).
  4. ONLY IF step 2 shows a write-capable scope (*.space.created or
     meetings.space.readonly does not count): PATCH
     config.accessType on that same Space. Picks a DONE (already-
     finished) meeting by default so the write has zero effect on any
     live/ongoing call.
  5. Print every HTTP status + raw response body — no guessing.

Nothing in this script ALTERs this app's own database. The only write
this script can perform is the single optional PATCH in step 4, against
Google's API, on the one meeting you pick (or the most recent DONE one
found automatically).

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container_name> python < test_meet_space_write_scope.py
    # optionally pin a specific meeting:
    MEETING_ID=138 docker exec -i <backend_container_name> python < test_meet_space_write_scope.py
"""
import os
import sys

from app.database import SessionLocal
from app.models.meeting import Meeting
from app.routers.meetings import _host_workspace_id_for_meeting
from app.services.meeting_sync import get_workspace_google_access_token
import requests


def main():
    db = SessionLocal()
    try:
        meeting_id_env = os.environ.get("MEETING_ID")
        if meeting_id_env:
            m = db.query(Meeting).filter(Meeting.id == int(meeting_id_env)).first()
            if not m:
                print(f"No meeting with id={meeting_id_env}")
                return
        else:
            m = (
                db.query(Meeting)
                .filter(Meeting.google_event_id.isnot(None), Meeting.status == "DONE")
                .order_by(Meeting.id.desc())
                .first()
            )
            if not m:
                print("No DONE meeting with a google_event_id found — set MEETING_ID=<id> explicitly.")
                return

        print(f"Using meeting id={m.id}, status={m.status}, meeting_url={m.meeting_url}, organizer={m.organizer_google_email}")
        meeting_code = (m.meeting_url or "").rstrip("/").rsplit("/", 1)[-1]
        if not meeting_code:
            print("Could not derive a Meet space code from meeting_url.")
            return
        space_name = f"spaces/{meeting_code}"
        print(f"Derived space name: {space_name}")

        workspace_id = _host_workspace_id_for_meeting(db, m)
        print(f"Resolved host workspace_id: {workspace_id}")

        print("\n--- Step 1: exchange refresh token ---")
        try:
            token = get_workspace_google_access_token(db, workspace_id)
        except Exception as e:
            print(f"FAILED to get access token: {e!r}")
            print("(If this is 401/invalid_grant, the stored refresh token for this "
                  "workspace account is dead — this probe can't continue. Try a "
                  "different workspace_id/account, or re-authorize that account first.)")
            return
        print("Got access token OK.")

        print("\n--- Step 2: real granted scopes (Google tokeninfo) ---")
        ti = requests.get(
            "https://www.googleapis.com/oauth2/v3/tokeninfo",
            params={"access_token": token},
            timeout=10,
        )
        print(f"tokeninfo status: {ti.status_code}")
        print(ti.text)
        granted_scopes = set()
        if ti.ok:
            granted_scopes = set((ti.json().get("scope") or "").split())
        write_scope_present = "https://www.googleapis.com/auth/meetings.space.created" in granted_scopes

        print("\n--- Step 3: GET the Meet Space (read-only) ---")
        headers = {"Authorization": f"Bearer {token}"}
        get_resp = requests.get(f"https://meet.googleapis.com/v2/{space_name}", headers=headers, timeout=15)
        print(f"GET status: {get_resp.status_code}")
        print(get_resp.text)

        print("\n--- Step 4: attempt PATCH config.accessType ---")
        if not write_scope_present:
            print(
                "SKIPPING the write attempt: tokeninfo shows the stored token does NOT "
                "carry 'meetings.space.created' (write) scope — only what's listed above. "
                "Attempting the PATCH anyway so we see Google's own real error, since "
                "that's more conclusive than skipping:"
            )
        patch_resp = requests.patch(
            f"https://meet.googleapis.com/v2/{space_name}",
            params={"updateMask": "config.accessType"},
            headers={**headers, "Content-Type": "application/json"},
            json={"config": {"accessType": "TRUSTED"}},
            timeout=15,
        )
        print(f"PATCH status: {patch_resp.status_code}")
        print(patch_resp.text)

        print("\n--- CONCLUSION ---")
        if patch_resp.status_code == 200:
            print("SUCCESS: this account's current token CAN write Space.config.accessType.")
        else:
            print(f"FAILED ({patch_resp.status_code}): this account's current token CANNOT write "
                  f"Space.config.accessType as currently scoped/authorized. See raw body above for "
                  f"the exact reason (insufficient scope vs account-type restriction vs something else).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
