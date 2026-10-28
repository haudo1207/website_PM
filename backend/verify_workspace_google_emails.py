"""
Read-only — no writes anywhere. Final verification after (a) re-consenting
all 4 workspaces and (b) running backfill_workspace_google_email.py: for
every workspace with a live refresh_token, compares 3 independent sources
of "which Google account is actually connected":

  1. Workspace.expected_google_email  — what the admin typed in "Quản lý
     Workspace" (a label/hint, never used for auth).
  2. WorkspaceGoogleAccount.google_email — what's stored in the DB (should
     now be populated/correct after the backfill script ran).
  3. live_email — the REAL account right now, read fresh via
     get_workspace_google_access_token() + Google's own userinfo endpoint.
     This is the only source that can't be stale, so it's the ground truth
     the other two are checked against.

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container> python < verify_workspace_google_emails.py
"""
import requests

from app.database import SessionLocal
from app.models.system_category import Workspace
from app.models.workspace_google_account import WorkspaceGoogleAccount
from app.services.meeting_sync import get_workspace_google_access_token


def _live_email(token):
    r = requests.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if r.ok:
        return (r.json().get("email") or "").strip().lower() or None
    return f"ERROR {r.status_code}: {r.text[:150]}"


def _norm(v):
    return (v or "").strip().lower() or None


def main():
    db = SessionLocal()
    try:
        rows = (
            db.query(WorkspaceGoogleAccount)
            .filter(WorkspaceGoogleAccount.refresh_token.isnot(None))
            .all()
        )
        if not rows:
            print("No workspace has a live refresh_token.")
            return

        results = []
        for wga in rows:
            ws = db.query(Workspace).filter(Workspace.id == wga.workspace_id).first()
            code = ws.code if ws else f"(workspace_id={wga.workspace_id}, not found)"
            expected = _norm(ws.expected_google_email) if ws else None
            db_email = _norm(wga.google_email)

            try:
                token = get_workspace_google_access_token(db, wga.workspace_id)
                live = _live_email(token)
            except Exception as e:
                live = f"ERROR: {e!r}"

            live_norm = live if (live is None or live.startswith("ERROR")) else _norm(live)
            values = {expected, db_email, live_norm}
            match = len(values) == 1 and None not in values and not str(live_norm).startswith("ERROR")

            results.append((code, expected, db_email, live_norm, match))

        col = "{:<16} {:<32} {:<32} {:<32} {}"
        print(col.format("workspace_code", "expected_google_email", "google_email (DB)", "live_email (userinfo)", "RESULT"))
        print("-" * 130)
        for code, expected, db_email, live, match in results:
            print(col.format(
                str(code),
                str(expected or "(null)"),
                str(db_email or "(null)"),
                str(live or "(null)"),
                "MATCH" if match else "MISMATCH",
            ))

        print()
        n_mismatch = sum(1 for r in results if not r[4])
        if n_mismatch:
            print(f"{n_mismatch} workspace(s) MISMATCH — see table above for which column(s) disagree.")
        else:
            print("All workspaces MATCH across all 3 sources.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
