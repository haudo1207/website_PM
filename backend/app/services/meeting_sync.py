"""
Meeting Sync Services — Zoom link generation, Google Meet link generation,
Zoom Cloud Recording sync, Google Meet transcript sync, and AI summarization pipeline.

Ported from feature/meeting-logs branch (Next.js monolith) to FastAPI backend.
"""
import os
import re
import json
import datetime
import tempfile
import logging
import requests
from typing import Optional
from zoneinfo import ZoneInfo

from ..config import settings
from ..models.google_token import GoogleToken
from ..models.workspace_google_account import WorkspaceGoogleAccount
from ..models.system_category import Workspace
from ..models.user import User

logger = logging.getLogger("meeting_sync")

_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _now_vn() -> datetime.datetime:
    """Naive Vietnam wall-clock 'now' — meeting_date/start_time/end_time are
    stored as naive Vietnam local values, never UTC. Plain datetime.datetime.now()
    would silently use the SERVER's OS timezone instead (UTC in this deployment,
    ~7h behind Vietnam), making just-ended meetings look like they haven't
    started yet."""
    return datetime.datetime.now(_VN_TZ).replace(tzinfo=None)

# ═══════════════════════════════════════════════════════════
# ZOOM — Server-to-Server OAuth + Meeting Creation + Sync
# ═══════════════════════════════════════════════════════════

def get_zoom_access_token() -> str:
    """Get Zoom access token using Server-to-Server OAuth (Account Credentials)."""
    account_id = settings.ZOOM_ACCOUNT_ID
    client_id = settings.ZOOM_CLIENT_ID
    client_secret = settings.ZOOM_CLIENT_SECRET

    if not all([account_id, client_id, client_secret]):
        raise ValueError("Thiếu cấu hình Zoom (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)")

    import base64
    auth_str = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

    resp = requests.post(
        f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={account_id}",
        headers={
            "Authorization": f"Basic {auth_str}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise ValueError(f"Không thể lấy Zoom token: {resp.text}")

    return resp.json()["access_token"]


def create_zoom_meeting(topic: str, start_time: str, duration_minutes: int = 60) -> dict:
    """
    Create a scheduled Zoom meeting and return { join_url, id }.
    start_time: ISO 8601 format, e.g. "2026-07-13T10:00:00Z"
    """
    token = get_zoom_access_token()

    resp = requests.post(
        "https://api.zoom.us/v2/users/me/meetings",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "topic": topic or "New Meeting",
            "type": 2,  # Scheduled meeting
            "start_time": start_time,
            "duration": duration_minutes,
            "settings": {
                "host_video": True,
                "participant_video": True,
                "join_before_host": True,
                "mute_upon_entry": True,
                "watermark": False,
                "use_pmi": False,
                "approval_type": 2,
                "audio": "both",
                "auto_recording": "none",
            },
        },
        timeout=15,
    )
    if resp.status_code not in (200, 201):
        raise ValueError(f"Zoom API error: {resp.text}")

    data = resp.json()
    return {"join_url": data["join_url"], "id": data["id"]}


def sync_zoom_meeting(meeting_url: str, meeting_info: dict) -> dict:
    """
    Sync a Zoom meeting: fetch transcript/recording/summary and run AI summarization.
    Returns { transcript, summary, status } or raises on error.
    """
    # Extract meeting ID from Zoom link
    match = re.search(r"/j/(\d+)", meeting_url or "")
    if not match:
        raise ValueError("Link Zoom không đúng định dạng (/j/ID)")

    zoom_meeting_id = match.group(1)
    
    # Check if meeting has ended by time or status
    is_ended = False
    try:
        meeting_date = meeting_info.get("meeting_date")
        start_time = meeting_info.get("start_time")
        duration = int(meeting_info.get("duration") or 60)
        if meeting_date and start_time:
            start_dt = datetime.datetime.combine(meeting_date, start_time)
            end_dt = start_dt + datetime.timedelta(minutes=duration)
            if _now_vn() >= end_dt:
                is_ended = True
    except Exception:
        pass

    try:
        token = get_zoom_access_token()

        zoom_resp = requests.get(
            f"https://api.zoom.us/v2/meetings/{zoom_meeting_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if zoom_resp.status_code == 200:
            zoom_data = zoom_resp.json()
            if zoom_data.get("status") == "ended":
                is_ended = True

        if not is_ended and meeting_info.get("status") not in ("DONE", "ĐÃ DIỄN RA"):
            raise ValueError("Cuộc họp chưa kết thúc trên Zoom. Chỉ có thể đồng bộ sau khi cuộc họp đã kết thúc.")

        # ── Try Method 1: Zoom Cloud Recording Transcript (VTT) ──
        try:
            rec_resp = requests.get(
                f"https://api.zoom.us/v2/meetings/{zoom_meeting_id}/recordings",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            if rec_resp.status_code == 200:
                rec_data = rec_resp.json()
                files = rec_data.get("recording_files", [])

                transcript_file = next((f for f in files if f.get("file_type") == "TRANSCRIPT"), None)
                if transcript_file and transcript_file.get("download_url"):
                    dl_resp = requests.get(
                        f"{transcript_file['download_url']}?access_token={token}",
                        timeout=30,
                    )
                    if dl_resp.status_code == 200:
                        plain_transcript = _parse_vtt(dl_resp.text)
                        summary = summarize_with_ai(plain_transcript, meeting_info)
                        return {"transcript": plain_transcript, "summary": summary, "status": "DONE"}
        except Exception as e:
            logger.warning(f"Zoom transcript fetch failed: {e}")

        # ── Try Method 2: Zoom Native AI Meeting Summary ──
        try:
            summary_resp = requests.get(
                f"https://api.zoom.us/v2/meetings/{zoom_meeting_id}/meeting_summary",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            if summary_resp.status_code == 200:
                summary_data = summary_resp.json()
                if summary_data.get("summary_details"):
                    return {
                        "transcript": summary_data["summary_details"],
                        "summary": [summary_data["summary_details"]],
                        "status": "DONE",
                    }
        except Exception as e:
            logger.warning(f"Zoom AI Summary fetch failed: {e}")

        # ── Try Method 3: AssemblyAI Pipeline (download audio → transcribe → summarize) ──
        try:
            rec_resp = requests.get(
                f"https://api.zoom.us/v2/meetings/{zoom_meeting_id}/recordings",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            if rec_resp.status_code == 200:
                rec_data = rec_resp.json()
                files = rec_data.get("recording_files", [])
                media_file = next((f for f in files if f.get("file_type") == "M4A"), None) or \
                             next((f for f in files if f.get("file_type") == "MP4"), None)

                if media_file and media_file.get("download_url"):
                    download_url = f"{media_file['download_url']}?access_token={token}"
                    transcript = transcribe_with_assemblyai(download_url)
                    summary = summarize_with_ai(transcript, meeting_info)
                    return {"transcript": transcript, "summary": summary, "status": "DONE"}
        except Exception as e:
            logger.warning(f"AssemblyAI pipeline failed: {e}")

    except Exception as e:
        logger.warning(f"Zoom API sync error: {e}")

    # ── Fallback Method 4: Existing Transcript on Meeting ──
    existing_transcript = meeting_info.get("transcript")
    if existing_transcript and existing_transcript.strip():
        summary = summarize_with_ai(existing_transcript, meeting_info)
        return {"transcript": existing_transcript, "summary": summary, "status": "DONE"}

    raise ValueError(
        "Không tìm thấy file Transcript, AI Summary hoặc Video/Audio (M4A/MP4) để xử lý từ Zoom. "
        "Hãy dán nội dung transcript trực tiếp vào ô biên bản cuộc họp hoặc kiểm tra tính năng Cloud Recording trên Zoom."
    )


# ═══════════════════════════════════════════════════════════
# GOOGLE MEET — OAuth + Calendar + Drive Transcript Sync
# ═══════════════════════════════════════════════════════════

def _get_google_credentials(db, user_id: int = 1, workspace_id: int = None):
    """
    Get valid google.oauth2.credentials.Credentials.
    Uses shared operational account (mkt.szone@gmail.com), unless workspace_id
    resolves to a workspace with its own connected Google account override.
    """
    from google.oauth2.credentials import Credentials
    token = get_workspace_google_access_token(db, workspace_id)
    return Credentials(token=token)


def _load_google_tokens(db, user_id: int) -> Optional[dict]:
    """Load Google OAuth tokens from PostgreSQL database with user/member resolution."""
    if not user_id:
        return None
    try:
        from ..models.user import User
        from ..models.google_token import GoogleToken
        
        # 1. Search directly by User ID
        gtoken = db.query(GoogleToken).filter(GoogleToken.user_id == user_id).first()
        
        # 2. Search by User linked to Member ID (since meeting.created_by stores member_id)
        if not gtoken:
            user = db.query(User).filter(User.member_id == user_id).first()
            if user:
                gtoken = db.query(GoogleToken).filter(GoogleToken.user_id == user.id).first()

        # 3. Fallback to any connected Google account token in system
        if not gtoken:
            gtoken = db.query(GoogleToken).first()

        if gtoken:
            return {
                "access_token": gtoken.access_token,
                "refresh_token": gtoken.refresh_token,
            }
    except Exception as e:
        logger.warning(f"Error loading google tokens: {e}")

    # Fallback to local file for compatibility / initial migration
    token_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "google-tokens.json")
    if os.path.exists(token_path):
        try:
            with open(token_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def _save_google_tokens(db, user_id: int, tokens: dict):
    """Save Google OAuth tokens to PostgreSQL database."""
    if not user_id:
        return
    from ..models.user import User
    from ..models.google_token import GoogleToken
    gtoken = db.query(GoogleToken).filter(GoogleToken.user_id == user_id).first()
    if not gtoken:
        gtoken = GoogleToken(user_id=user_id)
        db.add(gtoken)
    
    gtoken.access_token = tokens.get("access_token")
    if tokens.get("refresh_token"):
        gtoken.refresh_token = tokens.get("refresh_token")
    db.commit()


_google_token_cache = {"token": None, "exp": 0}

class GoogleTokenDead(Exception):
    """Raised when Google Refresh Token is invalid or revoked (invalid_grant)."""
    pass

def get_shared_google_access_token(db=None) -> str:
    """
    Get access token for the shared operational Google account (mkt.szone@gmail.com).
    Caches the access token for 55 minutes per Spec Chapter 03.
    Catches invalid_grant errors and alerts operators.
    """
    import time
    if _google_token_cache["token"] and time.time() < _google_token_cache["exp"]:
        return _google_token_cache["token"]

    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    refresh_token = settings.GOOGLE_REFRESH_TOKEN

    # If GOOGLE_REFRESH_TOKEN is not set in settings, fallback to database tokens
    if not refresh_token:
        session = db
        close_session_at_end = False
        if not session:
            try:
                from ..database import SessionLocal
                session = SessionLocal()
                close_session_at_end = True
            except Exception:
                session = None

        if session:
            try:
                tok = session.query(GoogleToken).filter(GoogleToken.refresh_token != None, GoogleToken.refresh_token != "").order_by(GoogleToken.id.desc()).first()
                if tok:
                    refresh_token = tok.refresh_token
                    settings.GOOGLE_REFRESH_TOKEN = refresh_token
            except Exception as e:
                logger.warning(f"Error querying GoogleToken from DB: {e}")
            finally:
                if close_session_at_end:
                    session.close()

    missing = []
    if not client_id:
        missing.append("GOOGLE_CLIENT_ID")
    if not client_secret:
        missing.append("GOOGLE_CLIENT_SECRET")
    if not refresh_token:
        missing.append("GOOGLE_REFRESH_TOKEN")

    if missing:
        msg = f"Thiếu cấu hình {', '.join(missing)} trong .env hoặc Database. Vui lòng bấm 'Kết nối tài khoản Google Công ty' để cấp lại quyền."
        logger.warning(msg)
        raise ValueError(msg)

    data = _exchange_refresh_token(client_id, client_secret, refresh_token)
    token = data["access_token"]
    expires_in = data.get("expires_in", 3600)

    _google_token_cache["token"] = token
    _google_token_cache["exp"] = time.time() + expires_in - 300  # Cache 55 minutes
    return token


def _exchange_refresh_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    """Shared Google OAuth refresh_token -> access_token exchange, used by both the
    default shared account and per-workspace account token getters."""
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=10
    )

    if resp.status_code == 400 and "invalid_grant" in resp.text:
        logger.critical("GOOGLE REFRESH TOKEN DA CHET (invalid_grant) - Xem runbook chuong 03")
        raise GoogleTokenDead("Refresh token Google đã hết hạn hoặc bị thu hồi (invalid_grant). Vui lòng cấp lại quyền.")

    resp.raise_for_status()
    return resp.json()


_workspace_google_token_cache: dict = {}


def _load_workspace_google_tokens(db, workspace_id: int) -> Optional["WorkspaceGoogleAccount"]:
    """Load the WorkspaceGoogleAccount override row for a workspace, if any."""
    if not db or not workspace_id:
        return None
    try:
        return db.query(WorkspaceGoogleAccount).filter(WorkspaceGoogleAccount.workspace_id == workspace_id).first()
    except Exception as e:
        logger.warning(f"Error loading WorkspaceGoogleAccount for workspace {workspace_id}: {e}")
        return None


def _save_workspace_google_tokens(db, workspace_id: int, tokens: dict, google_email: str = None):
    """Save/update the Google OAuth tokens overriding the shared account for a workspace."""
    if not db or not workspace_id:
        return
    wga = db.query(WorkspaceGoogleAccount).filter(WorkspaceGoogleAccount.workspace_id == workspace_id).first()
    if not wga:
        wga = WorkspaceGoogleAccount(workspace_id=workspace_id)
        db.add(wga)

    wga.access_token = tokens.get("access_token")
    if tokens.get("refresh_token"):
        wga.refresh_token = tokens.get("refresh_token")
    if google_email:
        wga.google_email = google_email
    db.commit()


def get_workspace_google_access_token(db=None, workspace_id: int = None) -> str:
    """
    Get an access token for the Google account that should be used for a given
    workspace. Falls back to the shared operational account (get_shared_google_access_token)
    whenever no workspace is given, or the workspace has no connected override account —
    this makes the override purely additive and safe for every other workspace.
    """
    import time
    if workspace_id is None:
        return get_shared_google_access_token(db)

    wga = _load_workspace_google_tokens(db, workspace_id)
    if not wga or not wga.refresh_token:
        return get_shared_google_access_token(db)

    cached = _workspace_google_token_cache.get(workspace_id)
    if cached and time.time() < cached["exp"]:
        return cached["token"]

    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    if not client_id or not client_secret:
        raise ValueError("Thiếu cấu hình GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET trong .env")

    data = _exchange_refresh_token(client_id, client_secret, wga.refresh_token)
    token = data["access_token"]
    expires_in = data.get("expires_in", 3600)

    _workspace_google_token_cache[workspace_id] = {"token": token, "exp": time.time() + expires_in - 300}
    return token


def is_workspace_google_connected(db, workspace_id: int) -> dict:
    """Strictly check whether a workspace has its OWN connected Google account
    override — unlike get_workspace_google_access_token, this does NOT fall
    back to the shared account, so the UI can tell "infra has its own account
    connected" apart from "infra has no override, but the shared one still works".
    """
    wga = _load_workspace_google_tokens(db, workspace_id)
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first() if db else None
    return {
        "connected": bool(wga and wga.refresh_token),
        "google_email": wga.google_email if wga else None,
        # Display-only hint (Workspace.expected_google_email) — which mailbox
        # the "Connect" button should be used with, shown before anyone has
        # actually connected anything yet.
        "expected_google_email": ws.expected_google_email if ws else None,
    }


def create_google_meet_shared(meeting_id: int, title: str, creator_name: str, creator_email: str, start_iso: str, end_iso: str, attendees_emails: list, db=None, workspace_id: int = None) -> dict:
    """
    Create Google Meet event using shared operational account (mkt.szone@gmail.com).
    Calls Google Calendar API events.insert with conferenceDataVersion=1. sendUpdates=none:
    the event still shows on each attendee's own Google Calendar (attendees[] controls that,
    independently of sendUpdates), but Google won't email them an invite notice.
    """
    token = get_workspace_google_access_token(db, workspace_id)

    body = {
        "summary": f"[MK-{meeting_id}] {title}",
        "description": f"Người tạo: {creator_name} ({creator_email})\nTạo từ Markee Work Portal",
        "start": {"dateTime": start_iso, "timeZone": "Asia/Ho_Chi_Minh"},
        "end": {"dateTime": end_iso, "timeZone": "Asia/Ho_Chi_Minh"},
        "attendees": [{"email": e} for e in attendees_emails if e],
        "conferenceData": {
            "createRequest": {
                "requestId": f"mk-{meeting_id}-{os.urandom(3).hex()}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"}
            }
        },
        "extendedProperties": {
            "private": {
                "markee_meeting_id": str(meeting_id)
            }
        }
    }

    resp = requests.post(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        params={"conferenceDataVersion": 1, "sendUpdates": "none"},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        json=body,
        timeout=15
    )

    if not resp.ok:
        logger.error(f"Google Calendar insert failed: status={resp.status_code}, body={resp.text}")
        raise ValueError(f"Google Calendar insert failed: {resp.text}")

    data = resp.json()
    
    # Handle pending statusCode per Spec Chapter 07
    create_req_status = data.get("conferenceData", {}).get("createRequest", {}).get("status", {}).get("statusCode")
    if create_req_status != "success":
        import time
        time.sleep(2)
        event_id = data.get("id")
        if event_id:
            get_resp = requests.get(
                f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            if get_resp.ok:
                data = get_resp.json()

    entry_points = data.get("conferenceData", {}).get("entryPoints", [])
    meet_link = entry_points[0].get("uri") if entry_points else ""
    meeting_code = data.get("conferenceData", {}).get("conferenceId", "")

    return {
        "google_event_id": data.get("id"),
        "meet_link": meet_link or f"https://meet.google.com/{meeting_code}" if meeting_code else "",
        "meeting_code": meeting_code,
        "mk_tag": meeting_id,
        # Ground truth for "who can actually admit people from the waiting
        # room" — Calendar's own record of who organizes this exact event,
        # straight from the API response (whichever token/account actually
        # created it). Do NOT substitute a live-recomputed workspace lookup
        # here: that reflects CURRENT connection status, which can drift from
        # whatever account genuinely organized this event back when it was
        # created (e.g. workspace connected later) — see meeting_to_dict's
        # host_google_email, which must prefer this frozen value once stored.
        "organizer_google_email": data.get("organizer", {}).get("email"),
    }


def update_google_meet_event(db, google_event_id: str, start_iso: str, end_iso: str, workspace_id: int = None) -> None:
    """
    Reschedule an existing Google Calendar event (created via
    create_google_meet_shared) to a new start/end time — events.patch on the
    SAME event, so editing a meeting's time doesn't leave Calendar stale or
    create a duplicate event. sendUpdates=none, matching create-time behavior:
    no invite/update email is sent. Raises on failure; callers treat this as
    best-effort (see update_meeting in routers/meetings.py).
    """
    token = get_workspace_google_access_token(db, workspace_id)
    body = {
        "start": {"dateTime": start_iso, "timeZone": "Asia/Ho_Chi_Minh"},
        "end": {"dateTime": end_iso, "timeZone": "Asia/Ho_Chi_Minh"},
    }
    resp = requests.patch(
        f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{google_event_id}",
        params={"sendUpdates": "none"},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        json=body,
        timeout=15
    )
    if not resp.ok:
        logger.error(f"Google Calendar patch failed: status={resp.status_code}, body={resp.text}")
        raise ValueError(f"Google Calendar patch failed: {resp.text}")


def rename_google_meet_event_tag(db, google_event_id: str, meeting_id: int, title: str, workspace_id: int = None) -> None:
    """
    Patch a Calendar event's summary to "[MK-{meeting_id}] {title}" once the
    real Meeting row id is known. create_google_meet_shared/create_google_meet_link
    are called before any Meeting row exists, so the event is first created with a
    throwaway placeholder tag (see create_google_meet_link) — Google Meet's native
    recording/notetaker names its own Drive output after this event summary, so
    without this rename it forever carries the placeholder instead of the real id,
    making it undiscoverable by n8n's "[MK-{id}]" Drive search (which uses the real
    id, matching our own recorder_service.py's upload tag). Best-effort: must not
    break meeting creation, so any failure here is logged and swallowed.
    """
    if not google_event_id:
        return
    try:
        token = get_workspace_google_access_token(db, workspace_id)
        resp = requests.patch(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{google_event_id}",
            params={"sendUpdates": "none"},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"summary": f"[MK-{meeting_id}] {title}"},
            timeout=10,
        )
        if not resp.ok:
            logger.warning(f"rename_google_meet_event_tag failed (non-fatal): {resp.status_code} {resp.text}")
    except Exception as e:
        logger.warning(f"rename_google_meet_event_tag failed (non-fatal): {e}")


def cancel_google_meet_event(db, google_event_id: str, workspace_id: int = None) -> None:
    """Cancel a Calendar event when its Meeting is soft-deleted while still
    UPCOMING (chốt 2026-09-13's Delete Meeting design) — best-effort, same
    pattern as rename_google_meet_event_tag: any failure is logged and
    swallowed, never raised, so a Calendar API hiccup can't block or roll
    back the soft-delete the user already performed. events.delete (not a
    'cancelled' status patch) since nothing reads this event back afterward."""
    if not google_event_id:
        return
    try:
        token = get_workspace_google_access_token(db, workspace_id)
        resp = requests.delete(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{google_event_id}",
            params={"sendUpdates": "none"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if not resp.ok and resp.status_code != 410:  # 410 Gone = already deleted/cancelled, fine
            logger.warning(f"cancel_google_meet_event failed (non-fatal): {resp.status_code} {resp.text}")
    except Exception as e:
        logger.warning(f"cancel_google_meet_event failed (non-fatal): {e}")


def is_google_connected(db, user_id: int, workspace_id: int = None) -> bool:
    """Check if Google Calendar & Drive API connection is active with valid refresh token."""
    try:
        get_workspace_google_access_token(db, workspace_id)
        return True
    except Exception:
        pass

    tokens = _load_google_tokens(db, user_id)
    if tokens and tokens.get("refresh_token"):
        return True

    return False


def create_google_meet_link(db, user_id: int, topic: str, start_time: str, duration_minutes: int = 60, workspace_id: int = None) -> dict:
    """
    Create a Google Calendar event with Google Meet link.
    Uses shared operational account (mkt.szone@gmail.com), unless workspace_id
    resolves to a workspace with its own connected Google account override.
    Attributes creator_name and creator_email from current user in DB.
    """
    creator_name = "Portal User"
    creator_email = "user@company.com"
    if db and user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            creator_name = user.full_name or user.email.split("@")[0]
            creator_email = user.email

    try:
        # start_time arrives as Vietnam wall-clock time with a misleading trailing "Z"
        # (it is NOT actually UTC). Strip it and keep the value naive/local: Google
        # Calendar interprets a dateTime with no UTC offset using the accompanying
        # "timeZone" field (Asia/Ho_Chi_Minh) as the wall-clock time — if we instead
        # attach a "+00:00" offset here, Google treats it as a real UTC instant and the
        # event renders 7 hours later than intended.
        naive_start_time = start_time[:-1] if start_time.endswith("Z") else start_time
        start = datetime.datetime.fromisoformat(naive_start_time)
        end = start + datetime.timedelta(minutes=duration_minutes)
        res = create_google_meet_shared(
            meeting_id=int(datetime.datetime.now().timestamp()),
            title=topic or "Cuộc họp mới",
            creator_name=creator_name,
            creator_email=creator_email,
            start_iso=start.isoformat(),
            end_iso=end.isoformat(),
            # No attendees: adding the creator's own email here is what makes the
            # event auto-appear on their personal Google Calendar/Gmail (and can
            # trigger their own account's notification-email settings, which
            # sendUpdates=none below cannot suppress) — omitted on purpose.
            attendees_emails=[],
            db=db,
            workspace_id=workspace_id
        )
        if res.get("meet_link"):
            return {
                "join_url": res["meet_link"],
                "id": res.get("google_event_id"),
                "mk_tag": res.get("mk_tag"),
                "organizer_google_email": res.get("organizer_google_email"),
            }
        else:
            raise ValueError("Google Calendar không trả về meet_link hợp lệ")
    except Exception as e:
        logger.error(f"Google Calendar Meet creation failed: {e}")
        raise ValueError(f"Không thể khởi tạo cuộc họp Google Meet: {e}")


N8N_NOTIFY_MAX_ATTEMPTS = 3


def notify_n8n_meeting_created(db, m, workspace_id: int = None) -> None:
    """
    Fire-and-forget webhook to n8n right after a meeting's Google Meet link is
    created, so n8n can search Drive directly for the recording tagged
    "[MK-{m.id}]" (see create_google_meet_shared) instead of blindly polling
    every "Google Meet" folder for the most recent videos. Best-effort in the
    sense that a failure here must never be able to break meeting creation —
    the Meeting row always persists regardless of what happens in this call.

    n8n_notify_status tracking (chốt 2026-09-13): this used to be truly
    fire-and-forget — a failure only logged a warning, with no visible sign
    anywhere that a meeting never actually reached n8n (this exact class of
    bug — wrong webhook URL, workspace misconfig, n8n down — was hit live
    multiple times in production debugging). Now: PENDING -> SENT on success;
    on failure, stays PENDING (picked up again by retry_pending_n8n_notifies,
    the 30s auto-sync loop's sibling) until N8N_NOTIFY_MAX_ATTEMPTS is
    exhausted, then FAILED — a queryable, visible terminal state instead of a
    silently swallowed log line.

    meeting_url is passed through as-is (2026-09-13, P1): n8n used to re-derive
    the real Meet link itself by matching a Calendar event's "created" timestamp
    against the Drive video's subfolder — a fragile workaround. The backend
    already knows the real URL at creation time, so n8n's Calendar-lookup step
    is no longer needed.
    """
    # Route by the Workspace's own n8n_webhook_url (set via the Workspace admin
    # UI/API, e.g. Settings > Workspaces) — each workspace can point at its own
    # n8n workflow + Google account credentials with zero code/env changes.
    # A workspace with nothing configured falls back to the shared DEFAULT
    # workflow/account.
    url = settings.N8N_MEETING_WEBHOOK_URL_DEFAULT
    if workspace_id is not None and db is not None:
        ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
        if ws and ws.n8n_webhook_url:
            url = ws.n8n_webhook_url

    if not url:
        m.n8n_notify_status = "FAILED"
        m.n8n_notify_last_error = "no n8n_webhook_url configured (workspace or default)"
        if db is not None:
            db.commit()
        return

    m.n8n_notify_attempts = (m.n8n_notify_attempts or 0) + 1
    try:
        requests.post(
            url,
            json={
                "mk_tag": m.id,
                "title": m.title,
                "meeting_date": m.meeting_date.isoformat() if hasattr(m.meeting_date, "isoformat") else m.meeting_date,
                "start_time": m.start_time.isoformat() if hasattr(m.start_time, "isoformat") else m.start_time,
                "meeting_url": m.meeting_url,
            },
            timeout=5,
        )
        m.n8n_notify_status = "SENT"
        m.n8n_notify_last_error = None
    except Exception as e:
        logger.warning(f"notify_n8n_meeting_created failed (attempt {m.n8n_notify_attempts}/{N8N_NOTIFY_MAX_ATTEMPTS}) for meeting {m.id}: {e}")
        m.n8n_notify_last_error = str(e)[:1000]
        m.n8n_notify_status = "FAILED" if m.n8n_notify_attempts >= N8N_NOTIFY_MAX_ATTEMPTS else "PENDING"
    if db is not None:
        db.commit()
    if m.n8n_notify_status == "FAILED":
        try:
            from .telegram import send_group_message
            send_group_message(
                f"⚠️ <b>Meeting #{m.id}</b> \"{m.title}\" không thể gửi webhook cho n8n "
                f"sau {m.n8n_notify_attempts} lần thử — bản ghi cuộc họp sẽ KHÔNG được "
                f"n8n tự động xử lý (tóm tắt AI/ghi log). Kiểm tra n8n_webhook_url của "
                f"workspace hoặc trạng thái n8n."
            )
        except Exception as e:
            logger.warning(f"Failed to send n8n-notify-failed Telegram alert for meeting {m.id}: {e}")


def retry_pending_n8n_notifies(db) -> int:
    """Companion to the 30s auto-sync loop (see main.py's start_auto_sync_loop):
    re-attempts notify_n8n_meeting_created for every meeting still stuck at
    n8n_notify_status='PENDING' after its first attempt failed. Returns the
    count retried this pass. Meetings created with no Google Meet link never
    get a first attempt at all (n8n_notify_status stays at its 'PENDING'
    column default forever) — harmless, since PENDING here just means "never
    applicable", not "known to have failed"; only meetings that actually went
    through create_meeting's notify call and failed have n8n_notify_attempts > 0.
    """
    from ..models.meeting import Meeting
    from ..utils.access import workspace_id_for_project
    from ..models.project import Project

    pending = (
        db.query(Meeting)
        .filter(Meeting.n8n_notify_status == "PENDING", Meeting.n8n_notify_attempts > 0)
        .all()
    )
    for m in pending:
        proj = db.query(Project).filter(Project.id == m.project_id).first() if m.project_id else None
        workspace_id = workspace_id_for_project(db, proj)
        notify_n8n_meeting_created(db, m, workspace_id)
    return len(pending)


def sync_google_meet(db, user_id: int, meeting_url: str, meeting_info: dict, workspace_id: int = None) -> dict:
    """
    Sync a Google Meet meeting by searching for transcript on Google Drive.
    Returns { transcript, summary, status } or raises on error.
    """
    transcript_text = None

    if is_google_connected(db, user_id, workspace_id):
        match = re.search(r"meet\.google\.com/([a-z-]+)", meeting_url or "")
        meeting_code = match.group(1) if match else ""
        if meeting_code:
            # Try the Meet API first — it exposes the raw caption-level transcript
            # (same data as the recording player's "Search transcript" panel: full
            # dialogue with per-line timestamps), which is far more complete than
            # the "Notes by Gemini" companion Doc the Drive search below finds.
            try:
                api_data = _fetch_meet_api_transcript(db, meeting_code, workspace_id)
                if api_data and api_data.get("text"):
                    transcript_text = api_data["text"]
            except Exception as e:
                logger.warning(f"Fetch Google Meet transcript via Meet API failed: {e}")

            if not transcript_text:
                try:
                    transcript_data = _fetch_google_meet_transcript(db, user_id, meeting_code, workspace_id)
                    if transcript_data and transcript_data.get("text"):
                        transcript_text = transcript_data["text"]
                except Exception as e:
                    logger.warning(f"Fetch Google Meet transcript from Drive failed: {e}")

    # Fallback: Use existing transcript stored on meeting if Drive transcript not found
    if not transcript_text:
        existing = meeting_info.get("transcript")
        if existing and existing.strip():
            transcript_text = existing

    if not transcript_text:
        raise ValueError(
            "Không tìm thấy file transcript cho cuộc họp này trên Google Drive. "
            "Hãy dán trực tiếp nội dung biên bản cuộc họp (transcript) để hệ thống tự động sinh AI Summary."
        )

    summary = summarize_with_ai(transcript_text, meeting_info)
    return {
        "transcript": transcript_text,
        "summary": summary,
        "status": "DONE",
    }


def _fetch_meet_api_transcript(db, meeting_code: str, workspace_id: int = None) -> Optional[dict]:
    """
    Fetch the raw caption-level transcript via the Google Meet API
    (scope: meetings.space.readonly) — spaces -> conferenceRecords ->
    transcripts -> entries. This is the same underlying data shown in the
    recording player's "Search transcript" panel (full dialogue, per-line
    timestamps, per-speaker), independent from and richer than the
    "Notes by Gemini" companion Doc that _fetch_google_meet_transcript()
    finds on Drive. Returns None (never raises past logging) so callers can
    fall back to the Drive-doc method — e.g. when the Meet API isn't enabled
    yet, the OAuth token predates this scope, or no transcript exists.
    """
    token = get_workspace_google_access_token(db, workspace_id)
    headers = {"Authorization": f"Bearer {token}"}

    space_resp = requests.get(f"https://meet.googleapis.com/v2/spaces/{meeting_code}", headers=headers, timeout=15)
    if space_resp.status_code != 200:
        logger.warning(f"[MeetAPI] spaces.get({meeting_code}) failed: {space_resp.status_code} {space_resp.text[:200]}")
        return None
    space_name = space_resp.json().get("name")
    if not space_name:
        return None

    records_resp = requests.get(
        "https://meet.googleapis.com/v2/conferenceRecords",
        headers=headers,
        params={"filter": f'space.name="{space_name}"'},
        timeout=15,
    )
    if records_resp.status_code != 200:
        logger.warning(f"[MeetAPI] conferenceRecords.list failed: {records_resp.status_code} {records_resp.text[:200]}")
        return None
    records = records_resp.json().get("conferenceRecords", [])
    if not records:
        return None
    conference_name = records[0].get("name")  # most recent first
    if not conference_name:
        return None

    transcripts_resp = requests.get(f"https://meet.googleapis.com/v2/{conference_name}/transcripts", headers=headers, timeout=15)
    if transcripts_resp.status_code != 200:
        logger.warning(f"[MeetAPI] transcripts.list failed: {transcripts_resp.status_code} {transcripts_resp.text[:200]}")
        return None
    transcripts = transcripts_resp.json().get("transcripts", [])
    if not transcripts:
        return None
    transcript_name = transcripts[0].get("name")

    entries = []
    page_token = None
    while True:
        params = {"pageSize": 100}
        if page_token:
            params["pageToken"] = page_token
        entries_resp = requests.get(f"https://meet.googleapis.com/v2/{transcript_name}/entries", headers=headers, params=params, timeout=15)
        if entries_resp.status_code != 200:
            logger.warning(f"[MeetAPI] entries.list failed: {entries_resp.status_code} {entries_resp.text[:200]}")
            break
        data = entries_resp.json()
        entries.extend(data.get("transcriptEntries", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    if not entries:
        return None

    participant_names = {}

    def _resolve_participant(participant_ref: str) -> str:
        if not participant_ref:
            return "?"
        if participant_ref in participant_names:
            return participant_names[participant_ref]
        name = participant_ref
        try:
            p_resp = requests.get(f"https://meet.googleapis.com/v2/{participant_ref}", headers=headers, timeout=10)
            if p_resp.status_code == 200:
                p = p_resp.json()
                name = (
                    p.get("signedinUser", {}).get("displayName")
                    or p.get("anonymousUser", {}).get("displayName")
                    or p.get("phoneUser", {}).get("displayName")
                    or participant_ref
                )
        except Exception:
            pass
        participant_names[participant_ref] = name
        return name

    lines = []
    for e in entries:
        speaker = _resolve_participant(e.get("participant", ""))
        ts = ""
        try:
            dt = datetime.datetime.fromisoformat(e.get("startTime", "").replace("Z", "+00:00"))
            ts = dt.strftime("%H:%M:%S")
        except Exception:
            pass
        lines.append(f"[{ts}] {speaker}: {e.get('text', '')}")

    return {"text": "\n".join(lines), "fileName": f"Meet API transcript ({meeting_code})"}


def _fetch_google_meet_transcript(db, user_id: int, meeting_code: str, workspace_id: int = None) -> Optional[dict]:
    """Search Google Drive for a transcript (Google Doc / text / subtitle) matching the meeting code."""
    from googleapiclient.discovery import build

    creds = _get_google_credentials(db, user_id, workspace_id)
    drive = build("drive", "v3", credentials=creds)

    matched_file = None

    # Search 1: Direct search by meeting code in file name
    try:
        resp = drive.files().list(
            q=f"name contains '{meeting_code}' and trashed = false",
            spaces="drive",
            fields="files(id, name, createdTime, mimeType)",
            orderBy="createdTime desc",
            pageSize=10,
        ).execute()
        files = resp.get("files", [])
        # Google Meet's "Take notes with Gemini" feature drops a second Doc
        # alongside the real transcript — "Notes by Gemini - <title>" — with
        # its own English AI summary and attendee/attachment metadata. Both
        # match the mimeType/extension filter equally well, so without a
        # name check the notes doc can win the race and get stored as the
        # "transcript" (seen in production — see MeetingDetailModal's
        # transcript tab showing a Notes doc instead of dialogue).
        candidates = [
            f for f in files
            if ("document" in f.get("mimeType", "") or "text" in f.get("mimeType", "")
                or f.get("name", "").lower().endswith((".vtt", ".txt", ".srt")))
            and "notes" not in f.get("name", "").lower()
        ]
        matched_file = next((f for f in candidates if "transcript" in f.get("name", "").lower()), None) \
            or (candidates[0] if candidates else None)
        if matched_file:
            logger.info(f"[Sync] Found Google Meet transcript: {matched_file['name']}")
    except Exception as e:
        logger.warning(f"[Sync] Direct drive search error: {e}")

    # Search 2: Search using Calendar event details
    if not matched_file:
        try:
            calendar = build("calendar", "v3", credentials=creds)
            now = datetime.datetime.utcnow()
            time_min = (now - datetime.timedelta(days=30)).isoformat() + "Z"

            events_resp = calendar.events().list(
                calendarId="primary",
                timeMin=time_min,
                singleEvents=True,
                orderBy="startTime",
            ).execute()

            event = next(
                (e for e in events_resp.get("items", [])
                 if e.get("hangoutLink") and meeting_code in e["hangoutLink"]),
                None,
            )
            if event and event.get("summary"):
                event_summary = event["summary"]
                event_time = datetime.datetime.fromisoformat(
                    event["start"].get("dateTime", event["start"].get("date", ""))
                )
                docs_resp = drive.files().list(
                    q=f"name contains '{event_summary}' and trashed = false",
                    fields="files(id, name, createdTime, mimeType)",
                    orderBy="createdTime desc",
                    pageSize=20,
                ).execute()
                best_doc = None
                min_diff = float("inf")
                for doc in docs_resp.get("files", []):
                    doc_mtype = doc.get("mimeType", "")
                    doc_name = doc.get("name", "").lower()
                    # Only consider transcript-like files here too — this search has
                    # no filename anchor (matches by event title), so without this
                    # filter it can just as easily match the meeting's video
                    # recording and feed raw binary bytes into the AI prompt.
                    if not ("document" in doc_mtype or "text" in doc_mtype or ".vtt" in doc_name or ".txt" in doc_name or ".srt" in doc_name):
                        continue
                    # Skip Gemini's auto-generated "Notes" doc — same title
                    # pattern as the real transcript doc, but it's an AI
                    # summary (attendees/attachments/English summary), not
                    # the actual dialogue. See Search 1 above for detail.
                    if "notes" in doc_name:
                        continue
                    doc_time = datetime.datetime.fromisoformat(doc["createdTime"].replace("Z", "+00:00"))
                    diff = abs((doc_time - event_time).total_seconds())
                    if diff < 86400 and diff < min_diff:
                        min_diff = diff
                        best_doc = doc
                if best_doc:
                    matched_file = best_doc
        except Exception as e:
            logger.warning(f"[Sync] Calendar event matching error: {e}")

    if not matched_file or not matched_file.get("id"):
        return None

    file_id = matched_file["id"]
    mime_type = matched_file.get("mimeType", "")

    # Safety net: never treat a video/audio/binary file as text, no matter which
    # search path matched it — reading raw video bytes as UTF-8 produces
    # megabytes of garbage that blows up the AI prompt (seen in production:
    # a matched .mp4 recording got decoded and sent to the summarizer as
    # "transcript" text).
    if mime_type.startswith("video/") or mime_type.startswith("audio/") or mime_type == "application/octet-stream":
        logger.warning(f"[Sync] Matched Drive file '{matched_file.get('name')}' has binary mimeType '{mime_type}', skipping.")
        return None

    # Export Google Doc or download text/vtt file directly
    if "application/vnd.google-apps.document" in mime_type:
        export_resp = drive.files().export(
            fileId=file_id,
            mimeType="text/plain",
        ).execute()
        text_content = export_resp.decode("utf-8") if isinstance(export_resp, bytes) else str(export_resp)
    else:
        dl_resp = drive.files().get_media(fileId=file_id).execute()
        text_content = dl_resp.decode("utf-8", errors="ignore") if isinstance(dl_resp, bytes) else str(dl_resp)
        if matched_file.get("name", "").endswith(".vtt"):
            text_content = _parse_vtt(text_content)

    return {
        "text": text_content,
        "fileName": matched_file.get("name", "Transcript"),
    }


# ═══════════════════════════════════════════════════════════
# ASSEMBLYAI — Speech-to-Text Transcription Pipeline
# ═══════════════════════════════════════════════════════════

def transcribe_with_assemblyai(audio_url: str) -> str:
    """
    Transcribe audio/video using AssemblyAI.
    Supports direct URL (e.g. Zoom download link) or local file upload.
    """
    api_key = settings.ASSEMBLYAI_API_KEY
    if not api_key:
        raise ValueError("Thiếu ASSEMBLYAI_API_KEY trong cấu hình .env")

    headers = {"Authorization": api_key, "Content-Type": "application/json"}

    # Submit transcription job
    resp = requests.post(
        "https://api.assemblyai.com/v2/transcript",
        headers=headers,
        json={
            "audio_url": audio_url,
            "speaker_labels": True,
            "language_code": "vi",
            "punctuate": True,
            "format_text": True,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise ValueError(f"AssemblyAI submit error: {resp.text}")

    transcript_id = resp.json()["id"]

    # Poll for completion (max ~10 minutes)
    import time
    for _ in range(120):
        time.sleep(5)
        poll_resp = requests.get(
            f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
            headers={"Authorization": api_key},
            timeout=15,
        )
        poll_data = poll_resp.json()

        if poll_data["status"] == "completed":
            # Format with timestamps
            formatted = ""
            utterances = poll_data.get("utterances", [])
            if utterances:
                for u in utterances:
                    mins = u["start"] // 60000
                    secs = (u["start"] % 60000) // 1000
                    formatted += f"[{mins:02d}:{secs:02d}] {u['text']}\n\n"
            else:
                formatted = poll_data.get("text", "Không có nội dung.")

            # Truncate if too long
            if len(formatted) > 80000:
                formatted = formatted[:80000] + "\n\n[... bị cắt do quá dài ...]"

            return formatted

        elif poll_data["status"] == "error":
            raise ValueError(f"AssemblyAI transcription failed: {poll_data.get('error')}")

    raise ValueError("AssemblyAI transcription timed out (>10 minutes)")


# ═══════════════════════════════════════════════════════════
# AI SUMMARIZATION — Claude/GPT via Shopaikey
# ═══════════════════════════════════════════════════════════

def _call_shopaikey_chat(base_url: str, api_key: str, model: str, prompt: str, timeout: int, max_retries: int = 2) -> str:
    """
    Call the shopaikey (OpenAI-compatible) /chat/completions endpoint with retry.
    Shopaikey routes requests through shared "channels" that intermittently return
    503 model_not_found even for a model that normally works — retry a couple of
    times before giving up, so a single flaky channel pick doesn't silently fall
    back to canned text.
    """
    import time

    MAX_PROMPT_CHARS = 100_000
    if len(prompt) > MAX_PROMPT_CHARS:
        logger.warning(f"Shopaikey prompt too long ({len(prompt)} chars), truncating to {MAX_PROMPT_CHARS}")
        prompt = prompt[:MAX_PROMPT_CHARS] + "\n\n[... bị cắt do quá dài ...]"

    last_status = None
    last_body = ""
    attempts_made = 0
    for attempt in range(max_retries + 1):
        attempts_made = attempt + 1
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("choices", [{}])[0].get("message", {}).get("content", "")

            last_status, last_body = resp.status_code, resp.text[:200]
            if resp.status_code != 503 or attempt == max_retries:
                break
            logger.warning(f"Shopaikey call attempt {attempt + 1} got 503, retrying: {last_body}")
            time.sleep(1.5)
        except Exception as e:
            logger.warning(f"Shopaikey API call attempt {attempt + 1} failed: {e}")
            if attempt == max_retries:
                return ""
            time.sleep(1.5)

    if last_status is not None:
        logger.warning(f"Shopaikey API call status={last_status} after {attempts_made} attempt(s), resp={last_body}")
    return ""


def summarize_meeting_with_ai_structured(transcript: str, meeting_info: dict) -> dict:
    """
    Summarize meeting transcript using Gemini AI and return a structured dict:
    { "executive_summary": "...", "decisions": [...], "recommended_tasks": [...] }
    Dynamically analyzes the actual meeting content / title / project.
    """
    title = meeting_info.get("title", "Cuộc họp")
    project_name = meeting_info.get("project_name") or meeting_info.get("project") or "Dự án"
    date_str = meeting_info.get("date") or meeting_info.get("meeting_date") or ""

    if not transcript or not transcript.strip():
        prompt = f"""Bạn là chuyên gia AI phân tích cuộc họp. Cuộc họp này CHƯA CÓ transcript, chỉ có thông tin:
- Tên cuộc họp: {title}
- Dự án liên quan: {project_name}
- Ngày họp: {date_str}

QUY TẮC BẮT BUỘC: KHÔNG bịa tên người cụ thể, KHÔNG bịa ngày hạn chót cụ thể — vì không có transcript nên không có căn cứ. Với "assigned_name" và "deadline", luôn để chuỗi rỗng "" nếu không suy ra được từ tên cuộc họp/dự án.

Trả về kết quả JSON THUẦN TÚY (JSON Object), KHÔNG bọc trong markdown block, KHÔNG thêm câu dẫn:
{{
  "executive_summary": "Tóm tắt điều hành 2-3 câu ngắn gọn dựa trên tên cuộc họp '{title}' và dự án '{project_name}' — nêu rõ đây là dự đoán do chưa có biên bản chi tiết.",
  "decisions": [
    "Quyết định 1 dự kiến liên quan tới {title}",
    "Quyết định 2 về tiến độ, chất lượng hoặc nhân sự"
  ],
  "recommended_tasks": [
    {{
      "detail_task": "Hạng mục công việc cụ thể liên quan tới {title}",
      "priority": "Critical | High | Normal",
      "assigned_name": "",
      "deadline": ""
    }}
  ]
}}"""
    else:
        prompt = f"""Bạn là chuyên gia AI phân tích cuộc họp. Hãy đọc kỹ biên bản/transcript cuộc họp bên dưới và trích xuất thông tin THỰC TẾ thành kết quả JSON THUẦN TÚY (JSON Object), KHÔNG bọc trong markdown codeblock, KHÔNG thêm lời dẫn:

THÔNG TIN CUỘC HỌP:
- Tiêu đề: {title}
- Dự án: {project_name}

BIÊN BẢN/TRANSCRIPT THỰC TẾ:
{transcript}

QUAN TRỌNG: Transcript có thể ngắn, rời rạc, hoặc lẫn đoạn test mic/chào hỏi không liên quan — TUYỆT ĐỐI KHÔNG vì vậy mà bỏ qua các từ khóa được nói THẲNG và RÕ RÀNG (ví dụ: "Critical", "gấp", "deadline ngày X", tên người được giao việc...). Dù transcript chỉ có 1-2 câu thực chất, vẫn phải quét kỹ và trích xuất đúng những gì đã nói ra, không được mặc định để trống/"Không đề cập" nếu từ khóa đó tồn tại trong transcript.

CẤU TRÚC JSON YÊU CẦU:
{{
  "executive_summary": "Tóm tắt điều hành 2-3 câu ngắn gọn chính xác tuyệt đối từ transcript.",
  "decisions": [
    "Quyết định chính 1 từ transcript",
    "Quyết định chính 2 từ transcript"
  ],
  "recommended_tasks": [
    {{
      "detail_task": "Tên công việc cụ thể được giao",
      "priority": "Critical | High | Normal",
      "assigned_name": "Tên người chịu trách nhiệm (nếu có)",
      "deadline": "YYYY-MM-DD"
    }}
  ]
}}"""

    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("AI_API_KEY") or settings.AI_API_KEY
    openai_key = settings.AI_API_KEY or os.environ.get("AI_API_KEY")
    base_url = settings.AI_BASE_URL
    model = settings.AI_MODEL

    raw_text = ""

    if gemini_key and gemini_key.startswith("AIza"):
        gemini_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
        for g_model in gemini_models:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{g_model}:generateContent?key={gemini_key}"
                resp = requests.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                    timeout=60,
                )
                if resp.status_code == 200:
                    res_json = resp.json()
                    raw_text = res_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if raw_text:
                        break
            except Exception as e:
                logger.warning(f"Gemini API call ({g_model}) failed: {e}")

    effective_key = openai_key or gemini_key
    if not raw_text and effective_key:
        req_model = model if (model and not model.startswith("gemini-2.5")) else "gpt-4o-mini"
        raw_text = _call_shopaikey_chat(base_url, effective_key, req_model, prompt, timeout=60)

    if raw_text:
        try:
            cleaned = raw_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.replace("```json", "", 1)
            if cleaned.startswith("```"):
                cleaned = cleaned.replace("```", "", 1)
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            parsed = json.loads(cleaned.strip())
            if isinstance(parsed, dict) and "executive_summary" in parsed:
                # Guard against the model inventing a name instead of leaving
                # assigned_name empty as instructed — only keep it if the name
                # actually appears in the source transcript.
                tasks = parsed.get("recommended_tasks")
                if isinstance(tasks, list):
                    transcript_lower = (transcript or "").lower()
                    for t in tasks:
                        if isinstance(t, dict):
                            name = (t.get("assigned_name") or "").strip()
                            if name:
                                # assigned_name can list multiple people separated by
                                # commas — check each individually since they're often
                                # mentioned in different sentences, not as one phrase.
                                names = [n.strip() for n in name.split(",") if n.strip()]
                                valid_names = [n for n in names if n.lower() in transcript_lower]
                                t["assigned_name"] = ", ".join(valid_names)
                return parsed
        except Exception as e:
            logger.warning(f"Failed to parse JSON from AI response: {e}")

    # Fallback khi AI call thất bại/không parse được — không bịa người/ngày cụ thể
    return {
        "executive_summary": f"Cuộc họp '{title}' thuộc dự án '{project_name}' đã rà soát tiến độ và thống nhất kế hoạch làm việc. (AI Summary tạm thời không khả dụng)",
        "decisions": [
            f"Chốt mục tiêu chính của cuộc họp '{title}'.",
            "Ưu tiên hoàn thiện các hạng mục quan trọng đúng hạn.",
            "Leader chịu trách nhiệm nghiệm thu kết quả bàn giao."
        ],
        "recommended_tasks": [
            { "detail_task": f"Thực hiện công việc trọng điểm cuộc họp {title}", "priority": "Critical", "assigned_name": "", "deadline": "" },
            { "detail_task": f"Hoàn thiện tài liệu và checklist {title}", "priority": "High", "assigned_name": "", "deadline": "" },
            { "detail_task": f"Báo cáo kết quả {title} cho Leader", "priority": "Normal", "assigned_name": "", "deadline": "" }
        ]
    }


_SHEET_PROJECT_HEADER_RE = re.compile(r"^\d+\.\s*Project:\s*(.*)$")
_SHEET_LIST_ITEM_RE = re.compile(r"^\d+\.\s*")
_SHEET_PROJECT_FIELD_MAP = {
    "Task cha": "detail_task",
    "Priority": "priority",
    "Manday Budget": "manday_est",
    "Owner": "assigned_name",
    "Deadline": "deadline",
    "KPI / Output": "kpi_output",
}


def _parse_sheet_rows(rows: list) -> dict:
    """Reconstruct the structured summary n8n's '14a. Parse Summary' node
    originally computed, from the 2-column (label, value) rows it wrote to the
    per-meeting Google Sheet tab. Mirrors that node's row layout — see
    Meeting_AI_Summary_Sheets_Webhook copy.json for the JS source of truth."""
    def cell(row, i):
        return (row[i] if i < len(row) else "") or ""

    data = {
        "team_name": "", "organizer_name": "", "participant_count": None,
        "video_link": "", "executive_summary": "", "issues": [], "next_steps": [],
        "recommended_tasks": [],
    }
    section = None
    current_project = None
    projects = []
    overview_lines = []

    for row in rows:
        a = cell(row, 0).strip()
        b = cell(row, 1).strip()

        if a == "Team":
            data["team_name"] = b
        elif a == "Người summary":
            data["organizer_name"] = b
        elif a == "Link record":
            data["video_link"] = b
        elif a == "Số người tham gia":
            try:
                data["participant_count"] = int(b)
            except (ValueError, TypeError):
                pass
        elif a == "TỔNG QUAN":
            section = "overview"
        elif a == "TASK CHA ĐÃ CHỐT":
            section = "projects"
        elif a == "VẤN ĐỀ & RỦI RO":
            section = "issues"
        elif a == "BƯỚC TIẾP THEO":
            section = "next_steps"
        elif not a:
            continue
        elif section == "overview" and a != "Không có thông tin":
            overview_lines.append(a)
        elif section == "projects":
            m_hdr = _SHEET_PROJECT_HEADER_RE.match(a)
            if m_hdr:
                if current_project:
                    projects.append(current_project)
                current_project = {"project_name": m_hdr.group(1).strip(), "priority": "Normal"}
            elif current_project is not None and a in _SHEET_PROJECT_FIELD_MAP:
                key = _SHEET_PROJECT_FIELD_MAP[a]
                val = None if (not b or b == "Không đề cập") else b
                if key == "manday_est" and val is not None:
                    try:
                        val = float(val)
                    except ValueError:
                        val = None
                if key == "priority" and val not in ("Critical", "High", "Normal"):
                    val = "Normal"
                current_project[key] = val
        elif section == "issues" and a != "Không có":
            data["issues"].append(_SHEET_LIST_ITEM_RE.sub("", a))
        elif section == "next_steps" and a != "Không có":
            data["next_steps"].append(_SHEET_LIST_ITEM_RE.sub("", a))

    if current_project:
        projects.append(current_project)
    for p in projects:
        if not p.get("detail_task"):
            p["detail_task"] = p.get("kpi_output") or p.get("project_name") or "Task từ cuộc họp"
    data["recommended_tasks"] = projects
    data["executive_summary"] = "\n".join(overview_lines)
    return data


def fetch_summary_from_sheet(db, user_id: int, tab_name: str) -> Optional[dict]:
    """Read back the meeting summary n8n wrote to its Google Sheet tab — a
    durable backup of the parsed AI summary, independent of whatever's
    currently in ai_summary. Used by the "Đồng bộ" sync so a manual re-sync
    restores the original n8n-generated summary instead of paying to
    regenerate one via the app's own (different) AI call, and so a summary
    accidentally lost/overwritten can be recovered without re-running the
    whole AssemblyAI/GPT pipeline. Requires the spreadsheets.readonly OAuth
    scope on the shared Google account — returns None if the API call fails
    (e.g. scope not yet granted, tab renamed/deleted), letting the caller
    fall back to the AI-regenerate path.
    """
    if not tab_name:
        return None
    try:
        from googleapiclient.discovery import build
        creds = _get_google_credentials(db, user_id)
        sheets = build("sheets", "v4", credentials=creds)
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=settings.MEETING_SUMMARY_SHEET_ID,
            range=f"'{tab_name}'!A1:B300",
        ).execute()
        rows = resp.get("values", [])
        if not rows:
            return None
        return _parse_sheet_rows(rows)
    except Exception as e:
        logger.warning(f"[Sync] Reading summary from Sheet tab '{tab_name}' failed: {e}")
        return None


def apply_sync_result_to_meeting(m, result: dict) -> None:
    """Merge a sync result (from sync_google_meet/sync_zoom_meeting/summarize_with_ai)
    into a Meeting row's transcript/ai_summary.

    summarize_with_ai() returns a flat list of text lines, but the frontend
    (MeetingDetailModal.tsx) only ever reads ai_summary as a dict —
    executive_summary/decisions/issues/next_steps/recommended_tasks/video_link/
    team_name/organizer_name/participant_count/is_auto_created/source. Assigning
    the raw list (or a bare string, as the old auto-sync code did) directly makes
    all of those read as undefined and the summary tab renders blank.

    It also merges onto whatever ai_summary already has instead of replacing it —
    a meeting synced once via the n8n pipeline carries structured metadata
    (video_link, team_name, participant_count, is_auto_created...) that a manual
    re-sync has no equivalent data for; overwriting wholesale silently destroys it.
    """
    if result.get("transcript"):
        m.transcript = result["transcript"]

    new_summary = result.get("summary")
    if new_summary is None:
        return
    if isinstance(new_summary, list):
        new_summary = {"executive_summary": "\n".join(str(line) for line in new_summary)}
    elif not isinstance(new_summary, dict):
        new_summary = {"executive_summary": str(new_summary)}

    if isinstance(m.ai_summary, dict):
        merged = dict(m.ai_summary)
        merged.update(new_summary)
        m.ai_summary = merged
    else:
        m.ai_summary = new_summary


def summarize_with_ai(transcript: str, meeting_info: dict) -> list:
    """
    Summarize meeting transcript using AI (supports direct Gemini REST API or OpenAI format).
    Returns a list of summary lines formatted according to the standard template.
    """
    if not transcript or not transcript.strip():
        raise ValueError("Nội dung biên bản/transcript cuộc họp rỗng, không thể tóm tắt.")

    title = meeting_info.get("title", "Cuộc họp")
    date = meeting_info.get("date") or meeting_info.get("meeting_date", "")

    prompt = f"""Bạn là chuyên gia tóm tắt biên bản cuộc họp chuyên nghiệp. Phân tích transcript cuộc họp và tạo biên bản tóm tắt chính xác, đầy đủ.

QUY TẮC BẮT BUỘC:
- CHỈ ghi nhận thông tin CÓ TRONG transcript. KHÔNG bịa, KHÔNG suy diễn.
- Nếu một field không có trong transcript, ghi "Không đề cập".
- Giữ nguyên tên riêng, tên project, tên công cụ, tên người.
- Viết tiếng Việt, ngắn gọn, chuyên nghiệp.
- Tuân thủ CHÍNH XÁC cấu trúc bên dưới.

THÔNG TIN CUỘC HỌP:
- Tên cuộc họp: {title}
- Ngày: {date}

FORMAT XUẤT RA:
MEETING SUMMARY - {title}

TỔNG QUAN
<2-3 câu mô tả mục đích cuộc họp và phạm vi chính>

TASK CHA ĐÃ CHỐT
1. Project: <Tên dự án>
Task cha: <Mô tả task>
Priority: <Critical | High | Normal>
Manday Budget: <Số ngày>
Owner: <Người làm>
Deadline: <Ngày hết hạn>
KPI / Output: <Kết quả>

VẤN ĐỀ & RỦI RO
1. <Rủi ro 1>

BƯỚC TIẾP THEO
1. <Bước 1>

---
TRANSCRIPT:
{transcript}"""

    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("AI_API_KEY") or settings.AI_API_KEY
    openai_key = settings.AI_API_KEY or os.environ.get("AI_API_KEY")
    base_url = settings.AI_BASE_URL
    model = settings.AI_MODEL

    content = ""

    if gemini_key and gemini_key.startswith("AIza"):
        gemini_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
        for g_model in gemini_models:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{g_model}:generateContent?key={gemini_key}"
                resp = requests.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                    timeout=90,
                )
                if resp.status_code == 200:
                    res_json = resp.json()
                    content = res_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if content:
                        break
            except Exception as e:
                logger.warning(f"Gemini API call ({g_model}) failed: {e}")

    effective_key = openai_key or gemini_key
    if not content and effective_key:
        req_model = model if (model and not model.startswith("gemini-2.5")) else "gpt-4o-mini"
        content = _call_shopaikey_chat(base_url, effective_key, req_model, prompt, timeout=90)

    if not content:
        raise ValueError("Không nhận được kết quả từ AI. Vui lòng kiểm tra lại GEMINI_API_KEY hoặc AI_API_KEY trong file .env.")

    return [line.rstrip() for line in content.split("\n") if line.strip()]


# ═══════════════════════════════════════════════════════════
# AUTOMATED BACKGROUND SYNC WORKER
# ═══════════════════════════════════════════════════════════

def _resolve_meeting_workspace_id(db, meeting) -> Optional[int]:
    """Resolve which Workspace a meeting belongs to via its project (reusing the same
    workspace_id_for_project() lookup used elsewhere for data scoping), so the
    background auto-sync loop can pick the right Google account override, if any."""
    if not meeting or not getattr(meeting, "project_id", None):
        return None
    try:
        from ..models.project import Project
        from ..utils.access import workspace_id_for_project
        proj = db.query(Project).filter(Project.id == meeting.project_id).first()
        return workspace_id_for_project(db, proj)
    except Exception as e:
        logger.warning(f"Error resolving workspace for meeting {getattr(meeting, 'id', None)}: {e}")
        return None


def auto_sync_all_ended_meetings(db):
    """
    Find all meetings that have ended (by date and end time) and process automatic transcript sync & AI summarization.
    """
    from ..models.meeting import Meeting
    now = _now_vn()
    today = now.date()

    meetings = db.query(Meeting).all()
    count_synced = 0

    for m in meetings:
        needs_end_update = False
        if m.status in ("UPCOMING", "ONGOING") and m.meeting_date:
            if m.start_time and m.end_time:
                # Compute the real end instant off m.meeting_date itself
                # (not "today") so this stays correct no matter how many
                # days have passed. A meeting whose window crosses
                # midnight (e.g. 23:52 -> 00:22) stores end_time <
                # start_time on the SAME meeting_date — comparing bare
                # date/time-of-day values without this rollover made a
                # meeting look "already ended" the instant it started (if
                # checked same-day) or made it ignore end_time entirely
                # once the calendar date rolled over (the old `meeting_date
                # < today` branch never even looked at end_time). Confirmed
                # live 2026-09-12/13: reproduced both — a meeting was
                # marked DONE ~30s after being reset to UPCOMING, before
                # its start_time had even arrived, and again right after
                # midnight while genuinely still in progress.
                end_date = m.meeting_date + datetime.timedelta(days=1) if m.end_time < m.start_time else m.meeting_date
                end_dt = datetime.datetime.combine(end_date, m.end_time)
                if now >= end_dt:
                    needs_end_update = True
            elif m.meeting_date < today:
                # No end_time recorded at all — fall back to "the whole
                # calendar day has passed" as the only signal available.
                needs_end_update = True

        if needs_end_update or (m.status == "DONE" and (not m.ai_summary or m.ai_summary == [])):
            platform = (m.platform or "").lower()
            meeting_info = {
                "title": m.title,
                "date": m.meeting_date.isoformat() if m.meeting_date else "",
                "meeting_date": m.meeting_date,
                "start_time": m.start_time,
                "duration": None,
                "transcript": m.transcript,
                "status": m.status,
            }
            if m.meeting_date and m.start_time and m.end_time:
                start_dt = datetime.datetime.combine(m.meeting_date, m.start_time)
                end_date = m.meeting_date + datetime.timedelta(days=1) if m.end_time < m.start_time else m.meeting_date
                end_dt = datetime.datetime.combine(end_date, m.end_time)
                meeting_info["duration"] = int((end_dt - start_dt).total_seconds() / 60)

            result = None
            try:
                if "zoom" in platform and m.meeting_url:
                    result = sync_zoom_meeting(m.meeting_url, meeting_info)
                elif ("google" in platform or "meet" in platform) and m.meeting_url:
                    user_id = m.created_by or 1
                    workspace_id = _resolve_meeting_workspace_id(db, m)
                    result = sync_google_meet(db, user_id, m.meeting_url, meeting_info, workspace_id)
                elif m.transcript and m.transcript.strip():
                    summary = summarize_with_ai(m.transcript, meeting_info)
                    result = {"transcript": m.transcript, "summary": summary, "status": "DONE"}
            except Exception as e:
                logger.info(f"Auto-sync for meeting ID {m.id} ('{m.title}'): {e}")

            if result:
                # A real external signal (Zoom's cloud-recording API actually
                # reports the call ended, or a legacy direct Google sync found
                # a transcript) — legitimate to mark DONE.
                logger.warning(
                    "MEETING_STATUS_DONE",
                    extra={
                        "meeting_id": m.id,
                        "source": "auto_sync_all_ended_meetings",
                        "organizer": m.organizer_google_email,
                        "platform": m.platform,
                    },
                )
                m.status = "DONE"
                apply_sync_result_to_meeting(m, result)
                db.commit()
                count_synced += 1
            # NOTE (chốt 2026-09-13): no `elif needs_end_update: m.status =
            # "DONE"` fallback anymore. end_time is a PLANNED end only — it is
            # no longer treated as the actual end signal. A Google Meet
            # meeting whose end_time has passed but has no real "the call
            # actually ended" signal yet (Meeting Host Bot's actual-end report,
            # see POST /api/meeting-bot/ended in meeting_bot.py) stays
            # UPCOMING/ONGOING here — this was exactly the naive clock-only
            # assumption that broke a meeting still genuinely in progress past
            # its planned end_time. n8n's AI-summary webhook also no longer
            # sets Meeting.status (see meetings.py's webhook handler) — the
            # Meeting lifecycle and the n8n processing pipeline are
            # intentionally independent now.

    if count_synced > 0:
        logger.info(f"[AutoSync] Successfully auto-synced AI Summary for {count_synced} meeting(s).")


# ═══════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════

def _parse_vtt(vtt_text: str) -> str:
    """Parse VTT subtitle file to plain text."""
    lines = vtt_text.split("\n")
    result = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if re.match(r"^\d+$", line):
            continue
        if "-->" in line:
            continue
        result.append(line)
    return "\n".join(result)
