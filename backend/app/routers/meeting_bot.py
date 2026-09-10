"""Internal API for the Meeting Host Bot (Chrome extension running on a VPS,
one signed-in Google profile per operational mailbox — see
meeting-bot-extension/README.md).

Mirrors the auth pattern already used for the Zalo sidecar
(routers/zalo.py's /internal/* endpoints, X-Zalo-Worker-Token): a single
shared bearer token in X-Meeting-Bot-Token, checked per-request, no user
login involved. Deliberately its own router (not mounted under meetings.py's
router, which requires get_current_user for every route) so the extension
never needs a portal user session.
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
import datetime
import logging

from ..config import settings
from ..database import get_db
from ..models.meeting import Meeting
from ..services.meeting_sync import _resolve_meeting_workspace_id
from ..models.system_category import Workspace
from ..models.workspace_google_account import WorkspaceGoogleAccount
from ..utils.timezone import VN_TZ as _VN_TZ

logger = logging.getLogger("meeting_bot")
router = APIRouter()

# How far ahead the bot should be told about a meeting, so its browser
# profile has time to open the join link and get admitted through before
# the actual start time.
LOOKAHEAD_MINUTES = 10
# How long after start_time a meeting still counts as "join me" — covers
# meetings the bot missed picking up right at start (VPS restart, etc.) and
# ones with no end_time set.
GRACE_MINUTES_AFTER_START = 90


def _check_bot_token(x_meeting_bot_token: str = Header(default=None)):
    expected = (settings.MEETING_BOT_TOKEN or "").strip()
    if expected and x_meeting_bot_token != expected:
        raise HTTPException(status_code=403, detail="Forbidden")


def _workspace_google_email(db: Session, workspace_id: int) -> str | None:
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
    ~60s) for the Chrome profile signed in as `google_email`. Returns the
    Google Meet meetings that mailbox should join-as-host right now.

    Matching order per meeting:
    1. `organizer_google_email` — frozen ground truth of who actually
       created the Calendar event (see meeting_sync.create_google_meet_shared),
       set once the link exists. Preferred whenever present.
    2. Fallback to the owning workspace's configured mailbox, for meetings
       whose link predates that column or wasn't Google-Meet-generated.
    """
    now = datetime.datetime.now(_VN_TZ)
    today = now.date()
    window_start = now - datetime.timedelta(minutes=GRACE_MINUTES_AFTER_START)
    window_end = now + datetime.timedelta(minutes=LOOKAHEAD_MINUTES)

    candidates = (
        db.query(Meeting)
        .filter(
            Meeting.status.in_(["UPCOMING", "ONGOING"]),
            Meeting.meeting_url.isnot(None),
            Meeting.meeting_url.ilike("%meet.google.com%"),
            Meeting.meeting_date >= (window_start.date()),
            Meeting.meeting_date <= (window_end.date()),
        )
        .all()
    )

    due = []
    for m in candidates:
        start_dt = datetime.datetime.combine(m.meeting_date, m.start_time, tzinfo=_VN_TZ)
        if not (window_start <= start_dt <= window_end):
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
        })

    return {"due": due}
