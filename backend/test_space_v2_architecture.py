"""
Standalone, isolated probe — does NOT touch create_google_meet_shared(),
sync_google_meet_attendees(), retry_meeting_link(), or any other production
code path. Everything here is its own throwaway HTTP calls against Google's
APIs, used purely to gather evidence before deciding whether a future
migration (create the Space directly via Meet API v2, instead of letting
Calendar create one implicitly via conferenceData.createRequest) is worth
doing.

Answers, empirically:
  1. Can this app create a Space directly (POST meet.googleapis.com/v2/spaces)?
  2. Can a Calendar event be made to show a Space created this way as its
     Google Meet link — and if so, which approach actually works:
       a. plain text in location/description
       b. a hand-built conferenceData (NOT createRequest) pointing at the
          already-created Space
  3. NOW that the app itself created the Space, does PATCH config.accessType
     finally return 200 (confirms the "only the creator/host may write
     config" hypothesis from the previous probe)?
  4. Does a Space created this way get the same artifactConfig defaults
     (transcriptionConfig/smartNotesConfig/recordingConfig) as a Space
     created the OLD way (via Calendar's createRequest)? Prints both GET
     responses side by side — no interpretation, just the raw JSON.
  5. Can't literally "join" a call from a script (no browser/WebRTC) — this
     prints the exact Calendar event resource Google stored instead
     (conferenceData/entryPoints/hangoutLink), so you can compare its shape
     against a normal, already-working meeting's event (also printed) and
     judge whether Calendar/Gmail would render a normal "Tham gia bằng
     Google Meet" button for it.
  6. Cleanup: deletes the test Calendar event(s). Also tries DELETE on the
     Space itself — Meet API v2 has no documented spaces.delete endpoint as
     of this writing, so this is expected to fail; printed anyway rather
     than assumed. A leftover orphaned test Space is harmless either way
     (same as any ended meeting's).

Usage (inside the backend container, which has the real stored tokens — note
the "python - <args>" form, required to pass arguments while the script
itself is piped in over stdin):
    docker exec -i <backend_container> python - <workspace_code> [existing_meeting_id] < test_space_v2_architecture.py

    workspace_code: which workspace's token creates the new test Space/event
                     (e.g. mkt, sale, infra, dev, sz) — required.
    existing_meeting_id: optional — a specific DONE meeting (old,
                     Calendar-created Space) to compare artifactConfig
                     against. If omitted, picks the most recent DONE
                     meeting whose host resolves to the SAME workspace.
"""
import datetime
import json
import sys

import requests

from app.database import SessionLocal
from app.models.meeting import Meeting
from app.models.system_category import Workspace
from app.routers.meetings import _host_workspace_id_for_meeting
from app.services.meeting_sync import get_workspace_google_access_token, cancel_google_meet_event


def _pretty(resp):
    print(f"status: {resp.status_code}")
    try:
        print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
    except Exception:
        print(resp.text)


def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: test_space_v2_architecture.py <workspace_code> [existing_meeting_id]")
        return
    ws_code = args[0].strip().lower()
    pinned_meeting_id = int(args[1]) if len(args) > 1 else None

    db = SessionLocal()
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
        print(f"Using workspace '{ws_code}' (id={ws.id}) — token OK.\n")

        # ---- Step 1: create a Space directly via Meet API v2 ----
        print("=" * 70)
        print("STEP 1 — POST https://meet.googleapis.com/v2/spaces")
        print("=" * 70)
        create_resp = requests.post("https://meet.googleapis.com/v2/spaces", headers=headers, json={}, timeout=15)
        _pretty(create_resp)
        if not create_resp.ok:
            print("\nABORTING — could not create a Space at all, nothing further to test.")
            return
        space = create_resp.json()
        space_name = space.get("name")  # "spaces/xxxxxxx"
        meeting_uri = space.get("meetingUri")  # "https://meet.google.com/xxx-xxxx-xxx"
        meeting_code = (meeting_uri or "").rstrip("/").rsplit("/", 1)[-1]
        print(f"\n--> space_name={space_name}, meetingUri={meeting_uri}, meeting_code={meeting_code}")

        # ---- Step 2a: attach via plain text location/description ----
        print("\n" + "=" * 70)
        print("STEP 2a — Calendar event with Meet link in location/description (plain text)")
        print("=" * 70)
        now_vn = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
        start = now_vn
        end = start + datetime.timedelta(minutes=15)
        event_body_a = {
            "summary": "[TEST - an toan xoa] Space v2 architecture test (2a: plain text)",
            "description": f"Link Google Meet: {meeting_uri}",
            "location": meeting_uri,
            "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": "Asia/Ho_Chi_Minh"},
            "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": "Asia/Ho_Chi_Minh"},
        }
        resp_2a = requests.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            params={"sendUpdates": "none"},
            headers=headers,
            json=event_body_a,
            timeout=15,
        )
        _pretty(resp_2a)
        event_id_a = resp_2a.json().get("id") if resp_2a.ok else None
        has_native_conference_2a = bool(resp_2a.ok and resp_2a.json().get("conferenceData"))
        has_hangout_link_2a = bool(resp_2a.ok and resp_2a.json().get("hangoutLink"))
        print(f"\n--> event has conferenceData: {has_native_conference_2a}, hangoutLink: {has_hangout_link_2a}")
        print("    (plain text in location/description NEVER produces a native conferenceData/hangoutLink —\n"
              "     Calendar has no way to know a URL in free text is a Meet link; this is expected either way.)")

        # ---- Step 2b: attach via hand-built conferenceData (NOT createRequest) ----
        print("\n" + "=" * 70)
        print("STEP 2b — Calendar event with hand-built conferenceData pointing at the existing Space")
        print("=" * 70)
        event_body_b = {
            "summary": "[TEST - an toan xoa] Space v2 architecture test (2b: conferenceData)",
            "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": "Asia/Ho_Chi_Minh"},
            "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": "Asia/Ho_Chi_Minh"},
            "conferenceData": {
                "conferenceId": meeting_code,
                "conferenceSolution": {
                    "key": {"type": "hangoutsMeet"},
                },
                "entryPoints": [
                    {"entryPointType": "video", "uri": meeting_uri, "label": meeting_code},
                ],
            },
        }
        resp_2b = requests.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            params={"conferenceDataVersion": 1, "sendUpdates": "none"},
            headers=headers,
            json=event_body_b,
            timeout=15,
        )
        _pretty(resp_2b)
        event_id_b = resp_2b.json().get("id") if resp_2b.ok else None
        if resp_2b.ok:
            has_native_conference_2b = bool(resp_2b.json().get("conferenceData"))
            has_hangout_link_2b = bool(resp_2b.json().get("hangoutLink"))
            print(f"\n--> event has conferenceData: {has_native_conference_2b}, hangoutLink: {has_hangout_link_2b}")
        else:
            print("\n--> 2b REJECTED by Google — hand-built conferenceData for an externally-created "
                  "Space is not accepted this way (see exact error above).")

        # ---- Step 3: PATCH config.accessType on the NEW Space (app is the owner now) ----
        print("\n" + "=" * 70)
        print("STEP 3 — PATCH config.accessType on the Space this app just created")
        print("=" * 70)
        patch_resp = requests.patch(
            f"https://meet.googleapis.com/v2/{space_name}",
            params={"updateMask": "config.accessType"},
            headers=headers,
            json={"config": {"accessType": "TRUSTED"}},
            timeout=15,
        )
        _pretty(patch_resp)
        if patch_resp.status_code == 200:
            print("\n--> SUCCESS (200): confirms the earlier hypothesis — PATCH works once the app "
                  "itself is the Space's owner/creator.")
        else:
            print(f"\n--> STILL FAILS ({patch_resp.status_code}) even as the direct creator — the "
                  "ownership hypothesis alone does not explain the original 403; investigate further.")

        # ---- Step 4: compare artifactConfig — new v2-created Space vs an OLD Calendar-created one ----
        print("\n" + "=" * 70)
        print("STEP 4 — artifactConfig: new Space (v2-created) vs old Space (Calendar-created)")
        print("=" * 70)
        print("\n--- NEW Space (just created via v2) ---")
        get_new = requests.get(f"https://meet.googleapis.com/v2/{space_name}", headers=headers, timeout=15)
        _pretty(get_new)

        if pinned_meeting_id:
            old_m = db.query(Meeting).filter(Meeting.id == pinned_meeting_id).first()
        else:
            old_m = None
            for m in (
                db.query(Meeting)
                .filter(Meeting.status == "DONE", Meeting.google_event_id.isnot(None), Meeting.deleted_at.is_(None))
                .order_by(Meeting.meeting_date.desc())
                .all()
            ):
                if _host_workspace_id_for_meeting(db, m) == ws.id:
                    old_m = m
                    break

        if old_m:
            old_code = (old_m.meeting_url or "").rstrip("/").rsplit("/", 1)[-1]
            print(f"\n--- OLD Space (meeting id={old_m.id}, Calendar-created, space code={old_code}) ---")
            if old_code:
                get_old = requests.get(f"https://meet.googleapis.com/v2/spaces/{old_code}", headers=headers, timeout=15)
                _pretty(get_old)
            else:
                print("Could not derive old space code from meeting_url.")
        else:
            print("\nNo old DONE meeting found for this workspace to compare against — "
                  "pass an explicit meeting id as the 2nd argument to compare.")

        # ---- Step 5: print the raw Calendar event resource(s) for manual judgment ----
        print("\n" + "=" * 70)
        print("STEP 5 — raw Calendar event shape (can't literally 'join' from a script)")
        print("=" * 70)
        print("Printed above in steps 2a/2b already — look for 'conferenceData' and 'hangoutLink' keys.")
        print("A normal, working Google Meet event (created the OLD way) always has BOTH a top-level "
              "'hangoutLink' and a 'conferenceData.entryPoints[].uri' — that's what makes Calendar/Gmail "
              "render the native 'Tham gia bằng Google Meet' button. Compare 2a/2b's output above against "
              "that expectation.")
        if old_m and old_m.google_event_id:
            print(f"\n--- For reference: OLD event resource (meeting id={old_m.id}) ---")
            get_old_event = requests.get(
                f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{old_m.google_event_id}",
                headers=headers,
                timeout=15,
            )
            _pretty(get_old_event)

        # ---- Step 6: cleanup ----
        print("\n" + "=" * 70)
        print("STEP 6 — cleanup")
        print("=" * 70)
        for label, eid in (("2a", event_id_a), ("2b", event_id_b)):
            if not eid:
                continue
            print(f"\nDeleting test Calendar event {label} (id={eid}) ...")
            try:
                cancel_google_meet_event(db, eid, workspace_id=ws.id)
                print("  Deleted OK.")
            except Exception as e:
                print(f"  Delete failed (non-fatal — delete manually if needed): {e!r}")

        print(f"\nAttempting DELETE on the Space itself ({space_name}) — Meet API v2 has no documented "
              "spaces.delete endpoint, so this is expected to fail; trying anyway instead of assuming:")
        del_resp = requests.delete(f"https://meet.googleapis.com/v2/{space_name}", headers=headers, timeout=15)
        _pretty(del_resp)
        print("\n(If this failed, the Space is simply left orphaned on Google's side — harmless, same as "
              "any ended meeting's Space.)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
