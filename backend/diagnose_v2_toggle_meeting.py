"""
Read-only — no writes anywhere. Diagnostic for the "Google từ chối yêu cầu"
toggle failure investigation (2026-10-28):

1. Looks up a meeting by a fragment of its meeting_url (the Meet space
   code, e.g. "ytg-spjq-cfk") — prints meet_space_owned_by_app,
   meet_access_type, organizer_google_email, meeting_url, and the
   workspace actually resolved as its host (via the same
   _host_workspace_id_for_meeting() every Calendar-mutating code path uses).

2. For any DONE meeting with a google_event_id, prints whether it has
   transcript/ai_summary populated (n8n's post-meeting sync writes those) —
   cheap signal for whether the AI pipeline processed it normally,
   regardless of which Space-creation path (old Calendar createRequest vs
   new Meet API v2) made that meeting's Space.

Usage (inside the backend container, which has the real stored tokens):
    docker exec -i <backend_container> python - "ytg-spjq-cfk" < diagnose_v2_toggle_meeting.py
    (the fragment is optional — omit it to skip step 1 and only run step 2)
"""
import sys

from app.database import SessionLocal
from app.models.meeting import Meeting
from app.routers.meetings import _host_workspace_id_for_meeting


def main():
    fragment = sys.argv[1].strip() if len(sys.argv) > 1 else None
    db = SessionLocal()
    try:
        print("=" * 70)
        print("STEP 1 — meeting by meeting_url fragment")
        print("=" * 70)
        if not fragment:
            print("No fragment given — skipped.")
        else:
            rows = db.query(Meeting).filter(Meeting.meeting_url.ilike(f"%{fragment}%")).all()
            if not rows:
                print(f"No meeting found with meeting_url containing '{fragment}'.")
                print("(If the user never finished clicking \"Tạo meeting\" for that attempt, "
                      "this is expected — no Meeting row exists for a link that was only "
                      "generated, never submitted.)")
            for m in rows:
                workspace_id = _host_workspace_id_for_meeting(db, m)
                print(f"\nmeeting id={m.id}")
                print(f"  title={m.title!r}")
                print(f"  status={m.status}")
                print(f"  meeting_url={m.meeting_url!r}")
                print(f"  organizer_google_email={m.organizer_google_email!r}")
                print(f"  meet_space_owned_by_app={m.meet_space_owned_by_app!r}")
                print(f"  meet_access_type={m.meet_access_type!r}")
                print(f"  resolved host workspace_id={workspace_id!r}")

        print("\n" + "=" * 70)
        print("STEP 2 — DONE meetings: transcript/ai_summary presence (sanity check only)")
        print("=" * 70)
        done_rows = (
            db.query(Meeting)
            .filter(Meeting.status == "DONE", Meeting.google_event_id.isnot(None), Meeting.deleted_at.is_(None))
            .order_by(Meeting.id.desc())
            .limit(10)
            .all()
        )
        if not done_rows:
            print("No DONE meeting with a google_event_id found at all.")
        v2_done = [m for m in done_rows if m.meet_space_owned_by_app]
        if not v2_done:
            print("None of the last 10 DONE meetings have meet_space_owned_by_app=True — "
                  "there is likely no DONE meeting yet created under the v2 flag to check "
                  "transcript sync behavior against. Listing the last 10 DONE meetings anyway "
                  "for reference:")
            for m in done_rows:
                print(f"  id={m.id} meet_space_owned_by_app={m.meet_space_owned_by_app!r} "
                      f"has_transcript={bool(m.transcript)} has_ai_summary={bool(m.ai_summary)}")
        else:
            for m in v2_done:
                print(f"id={m.id} (v2-owned) has_transcript={bool(m.transcript)} "
                      f"has_ai_summary={bool(m.ai_summary)} "
                      f"ai_summary_keys={list(m.ai_summary.keys()) if isinstance(m.ai_summary, dict) else None}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
