"""
Read-only — finds one sample DONE meeting (with a live google_event_id, so
it's usable by test_meet_space_write_scope.py) per recently re-consented
Workspace.

Uses the SAME resolver every Calendar-mutating code path uses
(_host_workspace_id_for_meeting, meetings.py), not a guess off
organizer_google_email directly — two workspaces can share the same real
Google mailbox, so a plain email match can point at the wrong Workspace.

By default, picks the 4 WorkspaceGoogleAccount rows with the most recent
updated_at (a re-consent updates google_email/tokens, bumping onupdate=now())
that have a live refresh_token. Pass explicit codes to target specific
workspaces instead:
    docker exec -i <backend_container> python < find_sample_meetings_per_workspace.py mkt infra sale dev

No writes anywhere in this file.
"""
import sys

from app.database import SessionLocal
from app.models.workspace_google_account import WorkspaceGoogleAccount
from app.models.system_category import Workspace
from app.models.meeting import Meeting
from app.routers.meetings import _host_workspace_id_for_meeting


def main():
    db = SessionLocal()
    try:
        codes = [c.strip().lower() for c in sys.argv[1:] if c.strip()]
        if codes:
            targets = (
                db.query(Workspace)
                .filter(Workspace.code.in_(codes))
                .all()
            )
        else:
            rows = (
                db.query(WorkspaceGoogleAccount)
                .filter(WorkspaceGoogleAccount.refresh_token.isnot(None))
                .order_by(WorkspaceGoogleAccount.updated_at.desc())
                .limit(4)
                .all()
            )
            ws_ids = [r.workspace_id for r in rows]
            targets = db.query(Workspace).filter(Workspace.id.in_(ws_ids)).all()
            # keep most-recently-updated order
            targets.sort(key=lambda w: ws_ids.index(w.id))

        if not targets:
            print("No matching workspaces found.")
            return

        print(f"{'workspace_code':<16} {'meeting_id':<12} {'status':<10} organizer_google_email")
        print("-" * 80)

        for ws in targets:
            candidates = (
                db.query(Meeting)
                .filter(
                    Meeting.status == "DONE",
                    Meeting.google_event_id.isnot(None),
                    Meeting.deleted_at.is_(None),
                )
                .order_by(Meeting.meeting_date.desc())
                .all()
            )
            found = None
            for m in candidates:
                if _host_workspace_id_for_meeting(db, m) == ws.id:
                    found = m
                    break

            if found:
                print(f"{ws.code:<16} {found.id:<12} {found.status:<10} {found.organizer_google_email}")
            else:
                print(f"{ws.code:<16} {'(none found)':<12} {'-':<10} -")
    finally:
        db.close()


if __name__ == "__main__":
    main()
