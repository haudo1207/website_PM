"""
Confirms (or refutes) the hypothesis behind the 403 "Permission denied on
resource Space (or it might not exist)" seen when PATCHing
Space.config.accessType even though tokeninfo shows the token DOES carry
the meetings.space.created write scope: that only the account that actually
CREATED a given Meet Space (or a host/co-host it granted) may write its
config — holding the right scope is necessary but not sufficient.

Step A — look across candidate workspaces for an EXISTING DONE meeting
whose frozen organizer_google_email matches that workspace's CURRENT real
Google account. "Current real account" is read live via Google's userinfo
endpoint on the freshly-exchanged token, NOT the possibly-NULL/stale
WorkspaceGoogleAccount.google_email column — a workspace can have been
reconnected to a different account since any given old meeting was created,
which is exactly the sptech.teampro@gmail.com-vs-mkt.szone@gmail.com
mismatch this script is designed to rule out.

Step B — if no such meeting exists for ANY candidate workspace, falls back
to creating a brand-new, tiny (15-minute) real Calendar/Meet event through
the EXACT SAME service function the app's own "Tạo link Google Meet" button
calls (create_google_meet_link, services/meeting_sync.py) — so the new
Space is genuinely created by the very token about to be tested. This path
writes NOTHING to this app's own database (create_google_meet_link never
inserts a Meeting row by itself) and deletes the Calendar event again at
the end via cancel_google_meet_event. The only thing left behind on
failure to clean up is an orphaned Meet Space on Google's side — harmless,
same as any ended meeting's.

Either way, runs the same GET + PATCH config.accessType probe as
test_meet_space_write_scope.py against whichever Space was selected and
prints every HTTP status + body — no guessing.

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container> python < confirm_space_owner_patch.py
    # or pin specific workspace codes to try, in order:
    docker exec -i <backend_container> python < confirm_space_owner_patch.py mkt sale sz
"""
import datetime
import sys

import requests

from app.database import SessionLocal
from app.models.meeting import Meeting
from app.models.system_category import Workspace
from app.models.workspace_google_account import WorkspaceGoogleAccount
from app.routers.meetings import _host_workspace_id_for_meeting
from app.services.meeting_sync import (
    get_workspace_google_access_token,
    create_google_meet_link,
    cancel_google_meet_event,
)


def _current_email(token):
    r = requests.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if r.ok:
        return (r.json().get("email") or "").strip().lower()
    print(f"  userinfo failed: {r.status_code} {r.text[:200]}")
    return None


def _probe_space(token, space_name):
    print(f"\nDerived space name: {space_name}")
    headers = {"Authorization": f"Bearer {token}"}

    print("\n--- GET the Meet Space (read-only) ---")
    get_resp = requests.get(f"https://meet.googleapis.com/v2/{space_name}", headers=headers, timeout=15)
    print(f"GET status: {get_resp.status_code}")
    print(get_resp.text)

    print("\n--- PATCH config.accessType ---")
    patch_resp = requests.patch(
        f"https://meet.googleapis.com/v2/{space_name}",
        params={"updateMask": "config.accessType"},
        headers={**headers, "Content-Type": "application/json"},
        json={"config": {"accessType": "TRUSTED"}},
        timeout=15,
    )
    print(f"PATCH status: {patch_resp.status_code}")
    print(patch_resp.text)
    return patch_resp.status_code


def main():
    db = SessionLocal()
    try:
        codes = [c.strip().lower() for c in sys.argv[1:] if c.strip()]
        if codes:
            workspaces = db.query(Workspace).filter(Workspace.code.in_(codes)).all()
            workspaces.sort(key=lambda w: codes.index(w.code))
        else:
            rows = (
                db.query(WorkspaceGoogleAccount)
                .filter(WorkspaceGoogleAccount.refresh_token.isnot(None))
                .all()
            )
            ws_ids = [r.workspace_id for r in rows]
            workspaces = db.query(Workspace).filter(Workspace.id.in_(ws_ids)).all()

        if not workspaces:
            print("No candidate workspaces found/given.")
            return

        print(f"Candidate workspaces: {[w.code for w in workspaces]}")

        # ---- Step A: existing meeting whose organizer == this workspace's LIVE current account ----
        for ws in workspaces:
            print(f"\n=== Checking workspace '{ws.code}' (id={ws.id}) ===")
            try:
                token = get_workspace_google_access_token(db, ws.id)
            except Exception as e:
                print(f"  SKIP: could not get access token — {e!r}")
                continue

            live_email = _current_email(token)
            print(f"  Live current account (userinfo): {live_email}")
            if not live_email:
                print("  SKIP: could not resolve current account email.")
                continue

            candidates = (
                db.query(Meeting)
                .filter(
                    Meeting.status == "DONE",
                    Meeting.google_event_id.isnot(None),
                    Meeting.deleted_at.is_(None),
                    Meeting.organizer_google_email.isnot(None),
                )
                .order_by(Meeting.meeting_date.desc())
                .all()
            )
            match = None
            for m in candidates:
                if (m.organizer_google_email or "").strip().lower() != live_email:
                    continue
                if _host_workspace_id_for_meeting(db, m) != ws.id:
                    continue
                match = m
                break

            if not match:
                print(f"  No DONE meeting found where organizer_google_email == live account "
                      f"AND host resolves to '{ws.code}'.")
                continue

            print(f"  MATCH: meeting id={match.id}, organizer={match.organizer_google_email}, "
                  f"meeting_url={match.meeting_url}")
            meeting_code = (match.meeting_url or "").rstrip("/").rsplit("/", 1)[-1]
            if not meeting_code:
                print("  Could not derive Meet space code from meeting_url — skipping.")
                continue
            space_name = f"spaces/{meeting_code}"
            status = _probe_space(token, space_name)
            print(f"\n=== RESULT (existing meeting id={match.id}, workspace={ws.code}) ===")
            if status == 200:
                print("SUCCESS (200): same-owner Space CAN be PATCHed — confirms the ownership hypothesis.")
            else:
                print(f"STILL FAILS ({status}): ownership hypothesis NOT confirmed by this case — "
                      f"needs further investigation.")
            return

        # ---- Step B: fallback — brand-new real test Space via the app's own create-link flow ----
        print("\nNo existing meeting satisfied the 'same current owner' condition for any candidate "
              "workspace. Falling back to creating a NEW real test meeting via create_google_meet_link() "
              "(the exact function 'Tạo link Google Meet' uses) ...")

        for ws in workspaces:
            try:
                token = get_workspace_google_access_token(db, ws.id)
            except Exception as e:
                print(f"  SKIP workspace '{ws.code}': could not get access token — {e!r}")
                continue

            now_vn = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
            start_iso = now_vn.strftime("%Y-%m-%dT%H:%M:00Z")
            print(f"\n=== Creating test meeting under workspace '{ws.code}' ===")
            try:
                result = create_google_meet_link(
                    db, None, "[TEST - an toan xoa] Space owner PATCH probe", start_iso, 15, ws.id
                )
            except Exception as e:
                print(f"  SKIP: create_google_meet_link failed — {e!r}")
                continue

            google_event_id = result.get("id")
            join_url = result.get("join_url")
            organizer = result.get("organizer_google_email")
            print(f"  Created: google_event_id={google_event_id}, organizer_google_email={organizer}, "
                  f"join_url={join_url}")

            meeting_code = (join_url or "").rstrip("/").rsplit("/", 1)[-1]
            if not meeting_code:
                print("  Could not derive Meet space code from join_url — skipping probe/cleanup.")
                continue
            space_name = f"spaces/{meeting_code}"
            status = _probe_space(token, space_name)

            print("\n--- Cleanup: deleting the test Calendar event ---")
            try:
                cancel_google_meet_event(db, google_event_id, workspace_id=ws.id)
                print("  Deleted OK.")
            except Exception as e:
                print(f"  Cleanup failed (non-fatal — delete manually if needed): {e!r}")

            print(f"\n=== RESULT (brand-new same-owner Space, workspace={ws.code}) ===")
            if status == 200:
                print("SUCCESS (200): a Space created by THIS SAME token CAN be PATCHed — "
                      "confirms the ownership hypothesis.")
            else:
                print(f"STILL FAILS ({status}) even on a brand-new same-owner Space — ownership "
                      f"hypothesis is NOT the (sole) cause, investigate further.")
            return

        print("\nNo workspace had a usable access token — could not even attempt the fallback.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
