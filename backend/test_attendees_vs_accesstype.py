"""
Tests the "attendees[] on the Calendar event changes the Space's
permission model" hypothesis — calls the REAL production functions
directly (create_google_meet_shared, sync_google_meet_attendees), no
reimplemented logic, same pattern confirm_space_owner_patch.py's Step B
used previously.

Real production sequence being mirrored exactly:
  1. generate-link calls create_google_meet_shared(attendees_emails=[]) —
     the Space/event is ALWAYS created with zero attendees at this point.
  2. Only later (after "Tạo meeting" creates the Meeting row, or when
     editing an existing meeting's member list) does
     _sync_meeting_calendar_attendees() call sync_google_meet_attendees()
     to PATCH the event's attendees[] with the real participant list —
     this is almost certainly what the earlier failed production test
     actually had (an EXISTING meeting, edited via "Lưu thay đổi", whose
     Calendar event already carries real MeetingMember emails), not a
     freshly-generated link with zero attendees.

This script reproduces BOTH states for the SAME Space and tries
PATCH config.accessType at each one:
  A) right after creation, zero attendees (matches test_space_v2_architecture.py)
  B) right after patching in 1-2 real attendee emails (matches a
     production meeting someone actually added members to)

Then, for comparison, runs a SECOND, independent Space through the exact
same two steps but with attendees_emails staying empty throughout step B
too — confirms whether attendees specifically (not just "a second PATCH
call happened") made the difference.

Cleans up every test Calendar event at the end via cancel_google_meet_event
(same as every other probe this session) — the only thing possibly left
behind is an orphaned test Space on Google's side (harmless, Meet API v2
has no delete endpoint).

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container> python - <workspace_code> <test_email_1> [test_email_2] < test_attendees_vs_accesstype.py
"""
import datetime
import sys

import requests

from app.database import SessionLocal
from app.models.system_category import Workspace
from app.services.meeting_sync import (
    create_google_meet_shared,
    sync_google_meet_attendees,
    get_workspace_google_access_token,
    cancel_google_meet_event,
)


def _patch_access_type(token, meeting_code, label):
    print(f"\n--- PATCH config.accessType ({label}) ---")
    resp = requests.patch(
        f"https://meet.googleapis.com/v2/spaces/{meeting_code}",
        params={"updateMask": "config.accessType"},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"config": {"accessType": "OPEN"}},
        timeout=15,
    )
    print(f"status: {resp.status_code}")
    print(resp.text[:500])
    return resp.status_code


def run_case(db, ws, token, label, attendees_for_create, attendees_for_patch):
    print(f"\n{'=' * 70}")
    print(f"CASE: {label}")
    print(f"{'=' * 70}")

    now_vn = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
    start = now_vn
    end = start + datetime.timedelta(minutes=15)

    print(f"Step 1: create_google_meet_shared(attendees_emails={attendees_for_create!r}) ...")
    result = create_google_meet_shared(
        meeting_id=int(now_vn.timestamp()),
        title=f"[TEST - an toan xoa] attendees-vs-accessType ({label})",
        creator_name="Test",
        creator_email="test@example.com",
        start_iso=start.isoformat(),
        end_iso=end.isoformat(),
        attendees_emails=attendees_for_create,
        db=db,
        workspace_id=ws.id,
    )
    google_event_id = result.get("google_event_id")
    meeting_code = result.get("meeting_code")
    print(f"  Created: google_event_id={google_event_id}, meeting_code={meeting_code}, "
          f"meet_space_owned_by_app={result.get('meet_space_owned_by_app')}")

    if not meeting_code:
        print("  ABORT this case — no meeting_code resolved.")
        return google_event_id, None

    status_a = _patch_access_type(token, meeting_code, "right after creation, before any attendees PATCH")

    if attendees_for_patch is not None:
        print(f"\nStep 2: sync_google_meet_attendees(attendees={attendees_for_patch!r}) — mirrors a real "
              f"member being added to this meeting in production ...")
        ok = sync_google_meet_attendees(db, google_event_id, attendees_for_patch, workspace_id=ws.id)
        print(f"  sync_google_meet_attendees returned: {ok}")
        status_b = _patch_access_type(token, meeting_code, "AFTER attendees[] patched onto the event")
    else:
        status_b = None

    print(f"\n>>> SUMMARY for '{label}': before-attendees PATCH={status_a}, after-attendees PATCH={status_b}")
    return google_event_id, meeting_code


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print("Usage: test_attendees_vs_accesstype.py <workspace_code> <test_email_1> [test_email_2]")
        return
    ws_code = args[0].strip().lower()
    test_emails = args[1:3]

    db = SessionLocal()
    created_events = []
    try:
        ws = db.query(Workspace).filter(Workspace.code == ws_code).first()
        if not ws:
            print(f"No workspace with code='{ws_code}'")
            return
        try:
            token = get_workspace_google_access_token(db, ws.id)
        except Exception as e:
            print(f"FAILED to get access token for workspace '{ws_code}': {e!r}")
            return

        # Case 1: real production sequence — created with zero attendees,
        # THEN attendees added via a second PATCH, exactly like
        # generate-link followed by a member being added.
        eid1, code1 = run_case(
            db, ws, token,
            label="zero attendees at create, then REAL attendees added via sync_google_meet_attendees",
            attendees_for_create=[],
            attendees_for_patch=test_emails,
        )
        if eid1:
            created_events.append(eid1)

        # Case 2: control — same two-step shape, but attendees stay empty
        # both times. Isolates "a second PATCH happened" from "attendees
        # specifically were added".
        eid2, code2 = run_case(
            db, ws, token,
            label="zero attendees at create, then a second (still-empty) attendees PATCH",
            attendees_for_create=[],
            attendees_for_patch=[],
        )
        if eid2:
            created_events.append(eid2)

        print(f"\n{'#' * 70}")
        print("CLEANUP")
        print(f"{'#' * 70}")
        for eid in created_events:
            print(f"Deleting test Calendar event {eid} ...")
            try:
                cancel_google_meet_event(db, eid, workspace_id=ws.id)
                print("  Deleted OK.")
            except Exception as e:
                print(f"  Delete failed (non-fatal — delete manually if needed): {e!r}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
