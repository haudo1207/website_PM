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

from ..config import settings
from ..models.google_token import GoogleToken
from ..models.user import User

logger = logging.getLogger("meeting_sync")

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
            if datetime.datetime.now() >= end_dt:
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

def _get_google_credentials(db, user_id: int = 1):
    """
    Get valid google.oauth2.credentials.Credentials.
    Uses shared operational account (mkt.szone@gmail.com).
    """
    from google.oauth2.credentials import Credentials
    token = get_shared_google_access_token(db)
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
    data = resp.json()
    token = data["access_token"]
    expires_in = data.get("expires_in", 3600)
    
    _google_token_cache["token"] = token
    _google_token_cache["exp"] = time.time() + expires_in - 300  # Cache 55 minutes
    return token


def create_google_meet_shared(meeting_id: int, title: str, creator_name: str, creator_email: str, start_iso: str, end_iso: str, attendees_emails: list, db=None) -> dict:
    """
    Create Google Meet event using shared operational account (mkt.szone@gmail.com).
    Calls Google Calendar API events.insert with conferenceDataVersion=1 & sendUpdates=all per Spec Chapter 07.
    """
    token = get_shared_google_access_token(db)

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
        params={"conferenceDataVersion": 1, "sendUpdates": "all"},
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
        "meeting_code": meeting_code
    }


def is_google_connected(db, user_id: int) -> bool:
    """Check if Google Calendar & Drive API connection is active with valid refresh token."""
    try:
        get_shared_google_access_token(db)
        return True
    except Exception:
        pass

    tokens = _load_google_tokens(db, user_id)
    if tokens and tokens.get("refresh_token"):
        return True

    return False


def create_google_meet_link(db, user_id: int, topic: str, start_time: str, duration_minutes: int = 60) -> dict:
    """
    Create a Google Calendar event with Google Meet link.
    Uses shared operational account (mkt.szone@gmail.com).
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
        start = datetime.datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        end = start + datetime.timedelta(minutes=duration_minutes)
        res = create_google_meet_shared(
            meeting_id=int(datetime.datetime.now().timestamp()),
            title=topic or "Cuộc họp mới",
            creator_name=creator_name,
            creator_email=creator_email,
            start_iso=start.isoformat(),
            end_iso=end.isoformat(),
            attendees_emails=[creator_email] if creator_email else [],
            db=db
        )
        if res.get("meet_link"):
            return {"join_url": res["meet_link"], "id": res.get("google_event_id")}
        else:
            raise ValueError("Google Calendar không trả về meet_link hợp lệ")
    except Exception as e:
        logger.error(f"Google Calendar Meet creation failed: {e}")
        raise ValueError(f"Không thể khởi tạo cuộc họp Google Meet qua tài khoản mkt.szone@gmail.com: {e}")


def sync_google_meet(db, user_id: int, meeting_url: str, meeting_info: dict) -> dict:
    """
    Sync a Google Meet meeting by searching for transcript on Google Drive.
    Returns { transcript, summary, status } or raises on error.
    """
    transcript_text = None

    if is_google_connected(db, user_id):
        match = re.search(r"meet\.google\.com/([a-z-]+)", meeting_url or "")
        meeting_code = match.group(1) if match else ""
        if meeting_code:
            # Try the Meet API first — it exposes the raw caption-level transcript
            # (same data as the recording player's "Search transcript" panel: full
            # dialogue with per-line timestamps), which is far more complete than
            # the "Notes by Gemini" companion Doc the Drive search below finds.
            try:
                api_data = _fetch_meet_api_transcript(db, meeting_code)
                if api_data and api_data.get("text"):
                    transcript_text = api_data["text"]
            except Exception as e:
                logger.warning(f"Fetch Google Meet transcript via Meet API failed: {e}")

            if not transcript_text:
                try:
                    transcript_data = _fetch_google_meet_transcript(db, user_id, meeting_code)
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


def _fetch_meet_api_transcript(db, meeting_code: str) -> Optional[dict]:
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
    token = get_shared_google_access_token(db)
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


def _fetch_google_meet_transcript(db, user_id: int, meeting_code: str) -> Optional[dict]:
    """Search Google Drive for a transcript (Google Doc / text / subtitle) matching the meeting code."""
    from googleapiclient.discovery import build

    creds = _get_google_credentials(db, user_id)
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
        for f in files:
            mtype = f.get("mimeType", "")
            name = f.get("name", "").lower()
            if "document" in mtype or "text" in mtype or ".vtt" in name or ".txt" in name or ".srt" in name:
                matched_file = f
                logger.info(f"[Sync] Found Google Meet transcript: {f['name']}")
                break
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

    return {
        "text": export_resp.decode("utf-8") if isinstance(export_resp, bytes) else str(export_resp),
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
                            if name and name.lower() not in transcript_lower:
                                t["assigned_name"] = ""
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

def auto_sync_all_ended_meetings(db):
    """
    Find all meetings that have ended (by date and end time) and process automatic transcript sync & AI summarization.
    """
    from ..models.meeting import Meeting
    now = datetime.datetime.now()
    today = now.date()
    current_time = now.time()

    meetings = db.query(Meeting).all()
    count_synced = 0

    for m in meetings:
        needs_end_update = False
        if m.status in ("UPCOMING", "ONGOING"):
            if m.meeting_date and m.meeting_date < today:
                needs_end_update = True
            elif m.meeting_date and m.meeting_date == today and m.end_time and current_time >= m.end_time:
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
            if m.start_time and m.end_time:
                start_dt = datetime.datetime.combine(today, m.start_time)
                end_dt = datetime.datetime.combine(today, m.end_time)
                meeting_info["duration"] = int((end_dt - start_dt).total_seconds() / 60)

            result = None
            try:
                if "zoom" in platform and m.meeting_url:
                    result = sync_zoom_meeting(m.meeting_url, meeting_info)
                elif ("google" in platform or "meet" in platform) and m.meeting_url:
                    user_id = m.created_by or 1
                    result = sync_google_meet(db, user_id, m.meeting_url, meeting_info)
                elif m.transcript and m.transcript.strip():
                    summary = summarize_with_ai(m.transcript, meeting_info)
                    result = {"transcript": m.transcript, "summary": summary, "status": "DONE"}
            except Exception as e:
                logger.info(f"Auto-sync for meeting ID {m.id} ('{m.title}'): {e}")

            if result:
                m.status = "DONE"
                if result.get("transcript"):
                    m.transcript = result["transcript"]
                if result.get("summary"):
                    if isinstance(result["summary"], dict):
                        m.ai_summary = result["summary"].get("executive_summary") or str(result["summary"])
                        m.recommended_tasks = result["summary"].get("recommended_tasks") or []
                    else:
                        m.ai_summary = result["summary"]
                db.commit()
                count_synced += 1
            elif needs_end_update:
                m.status = "DONE"
                db.commit()

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
