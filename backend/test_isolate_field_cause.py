"""
Isolates WHICH of the 3 real structural differences found between
create_google_meet_shared()'s v2 branch and test_space_v2_architecture.py's
Step 2b (the one that PATCHed 200) is actually responsible for the 403:
  - "description" field
  - explicit empty "attendees": [] (vs the key omitted entirely)
  - "extendedProperties.private.markee_meeting_id"

Creates 4 INDEPENDENT Spaces via Meet API v2 (one per variant, so no
variant's result can be contaminated by Google's state from a previous
one), builds a Calendar event for each using the SAME conferenceId/
entryPoints shape already confirmed correct (never conferenceData.
createRequest), varying ONLY the field under test, then immediately
PATCHes config.accessType on that Space and records the status.

  VARIANT A (baseline, exactly test_space_v2_architecture.py's 2b):
    summary + start + end + conferenceData only.
  VARIANT B: baseline + attendees: [] (empty list, key present).
  VARIANT C: baseline + description (arbitrary text).
  VARIANT D: baseline + extendedProperties.private.markee_meeting_id.

Cleans up every test Calendar event at the end via cancel_google_meet_event
— the only thing possibly left behind is up to 4 orphaned test Spaces on
Google's side (harmless, Meet API v2 has no delete endpoint).

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container> python - <workspace_code> < test_isolate_field_cause.py
"""
import datetime
import sys

import requests

from app.database import SessionLocal
from app.models.system_category import Workspace
from app.services.meeting_sync import get_workspace_google_access_token, cancel_google_meet_event


def create_space(headers):
    resp = requests.post("https://meet.googleapis.com/v2/spaces", headers=headers, json={}, timeout=15)
    if not resp.ok:
        raise RuntimeError(f"Space creation failed: {resp.status_code} {resp.text}")
    space = resp.json()
    meeting_uri = space.get("meetingUri") or ""
    meeting_code = meeting_uri.rstrip("/").rsplit("/", 1)[-1] if meeting_uri else ""
    if not meeting_code:
        raise RuntimeError(f"No usable meetingUri: {space}")
    return meeting_uri, meeting_code


def run_variant(headers, label, extra_fields):
    print(f"\n{'=' * 70}")
    print(f"VARIANT {label}")
    print(f"{'=' * 70}")

    meeting_uri, meeting_code = create_space(headers)
    print(f"Created Space: meetingUri={meeting_uri}, meeting_code={meeting_code}")

    now_vn = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
    start = now_vn
    end = start + datetime.timedelta(minutes=15)

    body = {
        "summary": f"[TEST - an toan xoa] isolate-field-cause (variant {label})",
        "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": "Asia/Ho_Chi_Minh"},
        "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": "Asia/Ho_Chi_Minh"},
        "conferenceData": {
            "conferenceId": meeting_code,
            "conferenceSolution": {"key": {"type": "hangoutsMeet"}},
            "entryPoints": [{"entryPointType": "video", "uri": meeting_uri, "label": meeting_code}],
        },
    }
    body.update(extra_fields)
    print(f"Event body: {body}")

    event_resp = requests.post(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        params={"conferenceDataVersion": 1, "sendUpdates": "none"},
        headers=headers,
        json=body,
        timeout=15,
    )
    print(f"Calendar insert status: {event_resp.status_code}")
    if not event_resp.ok:
        print(f"Calendar insert FAILED, body: {event_resp.text[:500]}")
        return None, None

    event_id = event_resp.json().get("id")

    patch_resp = requests.patch(
        f"https://meet.googleapis.com/v2/spaces/{meeting_code}",
        params={"updateMask": "config.accessType"},
        headers=headers,
        json={"config": {"accessType": "OPEN"}},
        timeout=15,
    )
    print(f"PATCH config.accessType status: {patch_resp.status_code}")
    print(f"PATCH body: {patch_resp.text[:500]}")

    return event_id, patch_resp.status_code


def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: test_isolate_field_cause.py <workspace_code>")
        return
    ws_code = args[0].strip().lower()

    db = SessionLocal()
    created_events = []
    results = []
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
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        variants = [
            ("A (baseline, matches 2b exactly)", {}),
            ("B (+ attendees: [])", {"attendees": []}),
            ("C (+ description)", {"description": "Người tạo: Test (test@example.com)\nTạo từ Markee Work Portal"}),
            ("D (+ extendedProperties.markee_meeting_id)", {"extendedProperties": {"private": {"markee_meeting_id": "999999"}}}),
        ]

        for label, extra in variants:
            try:
                event_id, status = run_variant(headers, label, extra)
            except Exception as e:
                print(f"Variant {label} raised: {e!r}")
                event_id, status = None, f"ERROR: {e!r}"
            if event_id:
                created_events.append(event_id)
            results.append((label, status))

        print(f"\n{'#' * 70}")
        print("SUMMARY")
        print(f"{'#' * 70}")
        print(f"{'Variant':<45} {'PATCH status'}")
        print("-" * 60)
        for label, status in results:
            print(f"{label:<45} {status}")

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
