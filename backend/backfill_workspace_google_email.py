"""
One-time backfill: for every WorkspaceGoogleAccount row that has a live
refresh_token but no stored google_email (root cause — see comment below),
exchange the refresh_token for a fresh access_token and call Google's own
userinfo endpoint to fetch the real email, then write it back.

Root cause this fixes: the OAuth callback (main.py's google_callback_public)
only started fetching+storing google_email at connect time in a later
version of this code. Any workspace connected BEFORE that still has
refresh_token set (the connection itself is live and working — meeting
creation already uses it fine via get_workspace_google_access_token) but
google_email = NULL. is_workspace_google_connected()'s "connected" flag was
always correctly True for these rows, but callers that read .get("google_email")
as a stand-in for "is this usable" wrongly treated them as disconnected
(fixed separately in meetings.py's check_meeting_conflict/retry_meeting_link
with an expected_google_email-based best-effort fallback) — this script
fixes the actual data so the real email is available going forward instead
of relying on that fallback.

This WRITES to the database (only the google_email column, one row per
fix — never touches access_token/refresh_token). Uses the SAME userinfo
call the live OAuth connect flow already performs successfully for new
connections (oauth2/v2/userinfo), so no new consent/scope is needed.

Usage (inside a backend container, which has the real stored tokens):
    docker exec -i <backend_container_name> python < backfill_workspace_google_email.py
"""
import requests

from app.database import SessionLocal
from app.models.workspace_google_account import WorkspaceGoogleAccount
from app.models.system_category import Workspace
from app.services.meeting_sync import get_workspace_google_access_token


def main():
    db = SessionLocal()
    try:
        rows = (
            db.query(WorkspaceGoogleAccount)
            .filter(WorkspaceGoogleAccount.refresh_token.isnot(None), WorkspaceGoogleAccount.google_email.is_(None))
            .all()
        )
        print(f"Found {len(rows)} workspace_google_accounts row(s) with a refresh_token but no google_email.")
        if not rows:
            return

        for wga in rows:
            ws = db.query(Workspace).filter(Workspace.id == wga.workspace_id).first()
            label = f"workspace_id={wga.workspace_id}" + (f" ({ws.code})" if ws else "")
            print(f"\n--- {label} ---")
            try:
                token = get_workspace_google_access_token(db, wga.workspace_id)
            except Exception as e:
                print(f"  SKIP: could not refresh access token — {e!r}")
                continue

            try:
                resp = requests.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
            except Exception as e:
                print(f"  SKIP: userinfo request failed — {e!r}")
                continue

            if not resp.ok:
                print(f"  SKIP: userinfo returned {resp.status_code}: {resp.text[:300]}")
                continue

            email = resp.json().get("email")
            if not email:
                print(f"  SKIP: userinfo responded OK but had no 'email' field: {resp.text[:300]}")
                continue

            wga.google_email = email
            db.commit()
            print(f"  OK: backfilled google_email = {email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
