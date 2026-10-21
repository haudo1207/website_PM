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
import hmac
import logging
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.meeting import Meeting
from ..models.system_category import Workspace
from ..models.workspace_google_account import WorkspaceGoogleAccount
from ..services.meeting_sync import _resolve_meeting_workspace_id, get_workspace_google_access_token, resolve_workspace_id_by_google_email
from ..utils.timezone import VN_TZ as _VN_TZ

logger = logging.getLogger("meeting_bot")
router = APIRouter()

# How far ahead the bot should be told about a meeting, so its browser
# profile has time to open the join link and get admitted through before
# the actual start time. Tightened from 10 to 2 (chốt 2026-09-14, "Bot Join
# window" rule): the bot should only ever be handed a meeting close to its
# actual start, not one still ~10 minutes out. 2 minutes still leaves ~5-6
# poll cycles (poll interval ~20s) to open the tab, load Meet, and get the
# CDP join click to land before start_time. GRACE_MINUTES_AFTER_START below
# is deliberately left untouched — it's a separate post-start catch-up net
# (VPS restart / missed poll right at start), not the "how early can the bot
# see this" gate this constant controls.
LOOKAHEAD_MINUTES = 2
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
    if not hmac.compare_digest((x_meeting_bot_token or "").encode(), expected.encode()):
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
            Meeting.deleted_at.is_(None),
            Meeting.meeting_url.isnot(None),
            Meeting.meeting_url.ilike("%meet.google.com%"),
            Meeting.meeting_date >= window_start.date(),
            Meeting.meeting_date <= window_end.date(),
        )
        # LOOKAHEAD_MINUTES is wide enough that two due meetings for the same
        # mailbox can legitimately both be "due" in the same response (back-
        # to-back or overlapping meetings). Without this, `.all()` returns
        # DB/insertion order, not start-time order — the extension's
        # pollOnce() opens whichever one is first in this list, so an
        # unordered result could pick the LATER meeting before the one
        # that's actually starting sooner. Order by start time so "due
        # first" always means "starts first."
        .order_by(Meeting.meeting_date, Meeting.start_time)
        .all()
    )

    due = []
    for m in candidates:
        if not m.start_time:
            continue
        start_dt = datetime.datetime.combine(m.meeting_date, m.start_time, tzinfo=_VN_TZ)
        if not (window_start <= start_dt <= window_end):
            continue

        end_dt = None
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
            # Planned end (chốt 2026-09-14, Bot Join window Rule 3): the
            # extension's content.js uses this — NOT actual-end detection —
            # to decide when to give up waiting for a FIRST participant to
            # ever show up. Once a real participant has been observed, this
            # value is ignored (see content.js's everHadParticipant flag) and
            # only actual-end (Leave button gone / solo timeout) matters.
            "end_at": end_dt.isoformat() if end_dt else None,
            "organizer_google_email": mailbox,
        })

    return {"due": due}


# Reverse of _workspace_google_email: given a mailbox, which workspace's
# Drive should own the upload — prefers the connected OAuth override, falls
# back to the display hint. A meeting's organizer_google_email is frozen at
# creation time and is very often the ONLY signal available (project_id can
# be None — "company-wide" meetings, or test rows), so this must be tried
# before the project→workspace path, matching the same priority /queue
# already uses for the reverse direction. Canonical implementation now lives
# in meeting_sync.py (chốt 2026-09-14, shared with meetings.py's Host-field
# work) — re-exported under this name so existing call sites below don't
# need to change.
_resolve_workspace_id_by_email = resolve_workspace_id_by_google_email


# Fixed name, not configurable per workspace — every workspace gets its own
# folder with this same name in its own Drive (each workspace has a
# separate Google account, so there's no naming collision to worry about).
RECORDINGS_FOLDER_NAME = "Meeting Host Bot Recordings"


def _get_or_create_recordings_folder(access_token: str) -> Optional[str]:
    """Finds (or creates, on first call) a folder to keep recordings out of
    the Drive root for easier browsing — purely organizational, NOT required
    for n8n's own discovery (confirmed live: n8n's "W3. Search Video By Tag"
    searches all of Drive by filename with no folder restriction, and
    "2. GDrive Download" fetches by file id directly — folder placement
    doesn't affect either). Best-effort: returns None on any failure, and
    the caller uploads to Drive root instead rather than blocking the
    recording from being saved at all.

    Only ever finds folders THIS app itself created: the drive.file scope
    means Drive Search literally cannot see any pre-existing folder in the
    user's Drive that wasn't created by (or explicitly opened with) this
    app, so there's no risk of colliding with some unrelated folder the
    account owner already has with the same name.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = requests.get(
            "https://www.googleapis.com/drive/v3/files",
            headers=headers,
            params={
                "q": f"name='{RECORDINGS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
                "fields": "files(id)",
                "pageSize": 1,
            },
            timeout=10,
        )
        resp.raise_for_status()
        files = resp.json().get("files") or []
        if files:
            return files[0]["id"]

        create_resp = requests.post(
            "https://www.googleapis.com/drive/v3/files",
            headers={**headers, "Content-Type": "application/json"},
            json={"name": RECORDINGS_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
            timeout=10,
        )
        create_resp.raise_for_status()
        return create_resp.json().get("id")
    except Exception:
        return None


@router.post("/ended")
def report_meeting_ended(
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(_check_bot_token),
):
    """Bot-reported actual-end signal — the ONLY thing that marks a
    web-created meeting DONE (chốt 2026-09-13). end_time is a planned end
    only; a meeting genuinely still in the Meet call past its planned
    end_time must stay ONGOING. Only the bot itself, watching the real Meet
    tab, knows when the call has actually ended (its own UI showing "Meeting
    ended" / "You left the meeting" / back at meet.google.com/home) — this
    must NOT be called just because end_time passed, a Join/Host/Admit
    attempt failed, the bot crashed, or the VPS restarted. Any of those stay
    silently in whatever status the meeting was already in; they are
    recovery/error conditions, not "the meeting ended."

    Body: {"meeting_id": int, "google_email": str}
    """
    meeting_id = body.get("meeting_id")
    google_email = (body.get("google_email") or "").strip().lower()
    if not meeting_id or not google_email:
        raise HTTPException(status_code=400, detail="meeting_id và google_email là bắt buộc")

    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # organizer_google_email is the frozen ground truth when present, but
    # (like /queue and drive-token above) a meeting whose link predates that
    # column, or wasn't Google-Meet-generated, needs to fall back to the
    # owning workspace's configured mailbox instead of outright rejecting —
    # an empty organizer must NOT mean "no bot may ever report this ended."
    organizer = (meeting.organizer_google_email or "").strip().lower()
    if not organizer:
        workspace_id = _resolve_meeting_workspace_id(db, meeting)
        organizer = (_workspace_google_email(db, workspace_id) or "").strip().lower()
    if not organizer or organizer != google_email:
        raise HTTPException(
            status_code=403,
            detail=f"google_email không khớp organizer của meeting #{meeting_id}",
        )

    if meeting.status == "CANCELLED":
        return {"success": True, "changed": False, "status": meeting.status, "reason": "meeting is CANCELLED"}
    if meeting.status == "DONE":
        return {"success": True, "changed": False, "status": meeting.status, "reason": "already DONE"}

    logger.warning(
        f"MEETING_STATUS_DONE source=meeting_bot_ended meeting_id={meeting.id} google_email={google_email}"
    )
    meeting.status = "DONE"
    db.commit()
    return {"success": True, "changed": True, "status": "DONE"}


@router.get("/drive-token")
def get_drive_upload_token(
    meeting_id: int,
    google_email: Optional[str] = None,
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

    # Only the bot signed in as this meeting's mailbox gets a Drive token for
    # it — the bot token is shared by every bot, so without this any of them
    # could fetch any Workspace's Drive token by guessing meeting ids.
    # Transitional: bots on an older extension don't send google_email yet;
    # they're still served (with a warning) until every bot is updated.
    expected_mailbox = meeting.organizer_google_email or _workspace_google_email(db, workspace_id)
    if google_email:
        if expected_mailbox and google_email.strip().lower() != expected_mailbox.strip().lower():
            raise HTTPException(status_code=403, detail="Bot này không phải hộp thư tổ chức của cuộc họp.")
    else:
        logger.warning("drive-token for meeting %s called without google_email (old extension?)", meeting_id)
    try:
        access_token = get_workspace_google_access_token(db, workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không lấy được Google access token: {exc}")

    title = (meeting.title or "Meeting").replace("\n", " ").replace("\r", " ").strip()
    drive_filename = f"[MK-{meeting.id}] {title}.mp4"
    folder_id = _get_or_create_recordings_folder(access_token)

    return {"access_token": access_token, "drive_filename": drive_filename, "folder_id": folder_id}
