"""Internal API for the Meeting Host Bot (Chrome extension running on a VPS,
one signed-in Google profile per operational mailbox — see
extensions/meeting-host-bot/README.md).

Mirrors the auth pattern already used for the Zalo sidecar
(routers/zalo.py's /internal/* endpoints, X-Zalo-Worker-Token): a single
shared bearer token in X-Meeting-Bot-Token, checked per-request, no user
login involved. Deliberately its own router (not mounted under meetings.py's
router, which requires get_current_user for every route) so the extension
never needs a portal user session.
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.meeting import Meeting
from ..models.system_category import Workspace
from ..models.workspace_google_account import WorkspaceGoogleAccount
from ..services.meeting_sync import _resolve_meeting_workspace_id, get_workspace_google_access_token
from ..utils.timezone import VN_TZ as _VN_TZ

router = APIRouter()

# How far ahead the bot should be told about a meeting, so its browser
# profile has time to open the join link and get admitted through before
# the actual start time.
LOOKAHEAD_MINUTES = 10
# How long after start_time a meeting still counts as "join me" when it has
# no end_time — covers meetings the bot missed picking up right at start
# (VPS restart, etc.). Meetings that DO have an end_time are cut off there
# instead (see the per-row check below) — more precise than a blanket grace
# period, and stops the bot re-opening a Meet tab for a short meeting that
# legitimately ended a while ago.
GRACE_MINUTES_AFTER_START = 90


def _check_bot_token(x_meeting_bot_token: Optional[str] = Header(default=None)):
    expected = (settings.MEETING_BOT_TOKEN or "").strip()
    if not expected:
        # Fail closed: an unset token must never be treated as "auth
        # disabled" — verified live against an earlier deploy of this same
        # endpoint that an unset MEETING_BOT_TOKEN let ANY caller list every
        # upcoming meeting's title + join link with zero credentials.
        raise HTTPException(status_code=503, detail="MEETING_BOT_TOKEN chưa được cấu hình trên server.")
    if x_meeting_bot_token != expected:
        raise HTTPException(status_code=403, detail="Forbidden")


def _workspace_google_email(db: Session, workspace_id: Optional[int]) -> Optional[str]:
    """Which Google mailbox is responsible for this workspace's meetings:
    prefer the actually-connected override (WorkspaceGoogleAccount.google_email)
    over the display-only Workspace.expected_google_email hint."""
    if not workspace_id:
        return None
    wga = db.query(WorkspaceGoogleAccount).filter(
        WorkspaceGoogleAccount.workspace_id == workspace_id
    ).first()
    if wga and wga.google_email:
        return wga.google_email
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    return ws.expected_google_email if ws else None


@router.get("/queue")
def get_bot_queue(
    google_email: str,
    db: Session = Depends(get_db),
    _=Depends(_check_bot_token),
):
    """Called by the extension's background service worker (polling every
    ~15-30s) for the Chrome profile signed in as `google_email`. Returns the
    Google Meet meetings that mailbox should join-as-host right now.

    Matching order per meeting:
    1. `organizer_google_email` — frozen ground truth of who actually
       created the Calendar event (see meeting_sync.create_google_meet_shared),
       set once the link exists. Preferred whenever present.
    2. Fallback to the owning workspace's configured mailbox, for meetings
       whose link predates that column or wasn't Google-Meet-generated.
    """
    now = datetime.datetime.now(_VN_TZ)
    window_start = now - datetime.timedelta(minutes=GRACE_MINUTES_AFTER_START)
    window_end = now + datetime.timedelta(minutes=LOOKAHEAD_MINUTES)

    candidates = (
        db.query(Meeting)
        .filter(
            Meeting.status.in_(["UPCOMING", "ONGOING"]),
            Meeting.meeting_url.isnot(None),
            Meeting.meeting_url.ilike("%meet.google.com%"),
            Meeting.meeting_date >= window_start.date(),
            Meeting.meeting_date <= window_end.date(),
        )
        .all()
    )

    due = []
    for m in candidates:
        if not m.start_time:
            continue
        start_dt = datetime.datetime.combine(m.meeting_date, m.start_time, tzinfo=_VN_TZ)
        if not (window_start <= start_dt <= window_end):
            continue

        if m.end_time:
            end_dt = datetime.datetime.combine(m.meeting_date, m.end_time, tzinfo=_VN_TZ)
            if m.end_time < m.start_time:
                end_dt += datetime.timedelta(days=1)
            if now >= end_dt:
                continue

        mailbox = m.organizer_google_email
        if not mailbox:
            workspace_id = _resolve_meeting_workspace_id(db, m)
            mailbox = _workspace_google_email(db, workspace_id)
        if not mailbox or mailbox.strip().lower() != google_email.strip().lower():
            continue

        due.append({
            "meeting_id": m.id,
            "title": m.title,
            "join_url": m.meeting_url,
            "start_at": start_dt.isoformat(),
            "organizer_google_email": mailbox,
        })

    return {"due": due}


def _resolve_workspace_id_by_email(db: Session, google_email: Optional[str]) -> Optional[int]:
    """Reverse of _workspace_google_email: given a mailbox, which workspace's
    Drive should own the upload — prefers the connected OAuth override,
    falls back to the display hint. A meeting's organizer_google_email is
    frozen at creation time and is very often the ONLY signal available
    (project_id can be None — "company-wide" meetings, or test rows), so
    this must be tried before the project→workspace path, matching the
    same priority /queue already uses for the reverse direction.
    """
    if not google_email:
        return None
    email = google_email.strip().lower()
    wga = db.query(WorkspaceGoogleAccount).filter(
        func.lower(WorkspaceGoogleAccount.google_email) == email
    ).first()
    if wga:
        return wga.workspace_id
    ws = db.query(Workspace).filter(func.lower(Workspace.expected_google_email) == email).first()
    return ws.id if ws else None


@router.get("/drive-token")
def get_drive_upload_token(
    meeting_id: int,
    db: Session = Depends(get_db),
    _=Depends(_check_bot_token),
):
    """Short-lived Google Drive access token + target filename for the
    recorder VPS to upload a finished recording directly to Drive — see
    extensions/meeting-host-bot/recorder_service.py. Deliberately hands out
    only a Bearer access token (already refreshed here, ~1h validity),
    never the underlying refresh_token/client_secret: the VPS talks to
    googleapis.com directly with it, the video bytes never touch this
    backend.

    Filename MUST contain "MK-{meeting_id}" — that exact substring is what
    n8n's "W3. Search Video By Tag" node searches all of Drive for (see
    Meeting_AI_Summary_dev.json), matching the same [MK-{id}] tag already
    put in the Calendar event title by create_google_meet_shared. No new
    DB column needed for this — the tag has always just been meeting_id.
    """
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Confirmed live 2026-09-12: a meeting with organizer_google_email set
    # but project_id=None (e.g. this exact test row) made
    # _resolve_meeting_workspace_id return None, silently falling back to
    # the shared operational account's token (wrong Drive entirely — that
    # account's grant didn't even have the drive.file scope). Try the
    # organizer's own workspace first.
    workspace_id = _resolve_workspace_id_by_email(db, meeting.organizer_google_email)
    if workspace_id is None:
        workspace_id = _resolve_meeting_workspace_id(db, meeting)
    try:
        access_token = get_workspace_google_access_token(db, workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không lấy được Google access token: {exc}")

    title = (meeting.title or "Meeting").replace("\n", " ").replace("\r", " ").strip()
    drive_filename = f"[MK-{meeting.id}] {title}.mp4"

    return {"access_token": access_token, "drive_filename": drive_filename}
