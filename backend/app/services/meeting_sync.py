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
    token = get_zoom_access_token()

    # Check if meeting has ended
    zoom_resp = requests.get(
        f"https://api.zoom.us/v2/meetings/{zoom_meeting_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if zoom_resp.status_code != 200:
        raise ValueError(f"Không thể kết nối đến cuộc họp Zoom (ID: {zoom_meeting_id})")

    zoom_data = zoom_resp.json()
    is_ended = zoom_data.get("status") == "ended"

    # Also check by time
    if not is_ended:
        try:
            meeting_date = meeting_info.get("meeting_date")
            start_time = meeting_info.get("start_time")
            duration = int(meeting_info.get("duration") or 60)
            if meeting_date and start_time:
                start_dt = datetime.datetime.combine(meeting_date, start_time)
                end_dt = start_dt + datetime.timedelta(minutes=duration)
                if datetime.datetime.now() > end_dt:
                    is_ended = True
        except Exception:
            pass

    if not is_ended:
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

    raise ValueError(
        "Không tìm thấy file Transcript, AI Summary hoặc Video/Audio (M4A/MP4) để xử lý. "
        "Hãy chắc chắn đã bật Cloud Recording và Audio Transcript trên Zoom."
    )


# ═══════════════════════════════════════════════════════════
# GOOGLE MEET — OAuth + Calendar + Drive Transcript Sync
# ═══════════════════════════════════════════════════════════

def _get_google_credentials(db, user_id: int):
    """Build Google OAuth2 credentials from stored tokens."""
    from google.oauth2.credentials import Credentials

    token_data = _load_google_tokens(db, user_id)
    if not token_data:
        raise ValueError(
            "Google Calendar chưa được kết nối. "
            "Vui lòng gọi API /api/meetings/google/auth để kết nối tài khoản Google trước."
        )

    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
    )

    # Auto-refresh if expired
    if creds.expired and creds.refresh_token:
        from google.auth.transport.requests import Request
        creds.refresh(Request())
        _save_google_tokens(db, user_id, {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
        })

    return creds


def _load_google_tokens(db, user_id: int) -> Optional[dict]:
    """Load Google OAuth tokens from PostgreSQL database."""
    if not user_id:
        return None
    from ..models.google_token import GoogleToken
    gtoken = db.query(GoogleToken).filter(GoogleToken.user_id == user_id).first()
    if gtoken:
        return {
            "access_token": gtoken.access_token,
            "refresh_token": gtoken.refresh_token,
        }
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
    from ..models.google_token import GoogleToken
    gtoken = db.query(GoogleToken).filter(GoogleToken.user_id == user_id).first()
    if not gtoken:
        gtoken = GoogleToken(user_id=user_id)
        db.add(gtoken)
    
    gtoken.access_token = tokens.get("access_token")
    if tokens.get("refresh_token"):
        gtoken.refresh_token = tokens.get("refresh_token")
    db.commit()


def is_google_connected(db, user_id: int) -> bool:
    """Check if Google OAuth tokens are available for the user."""
    tokens = _load_google_tokens(db, user_id)
    return bool(tokens and (tokens.get("refresh_token") or tokens.get("access_token")))


def create_google_meet_link(db, user_id: int, topic: str, start_time: str, duration_minutes: int = 60) -> dict:
    """
    Create a Google Calendar event with Google Meet link.
    Returns { join_url, id }.
    """
    from googleapiclient.discovery import build

    creds = _get_google_credentials(db, user_id)
    calendar = build("calendar", "v3", credentials=creds)

    start = datetime.datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    end = start + datetime.timedelta(minutes=duration_minutes)

    event = {
        "summary": topic or "Cuộc họp mới",
        "description": "Được tạo tự động từ hệ thống Meeting Logs",
        "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Ho_Chi_Minh"},
        "end": {"dateTime": end.isoformat(), "timeZone": "Asia/Ho_Chi_Minh"},
        "conferenceData": {
            "createRequest": {
                "requestId": f"meet-{int(datetime.datetime.now().timestamp())}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    response = calendar.events().insert(
        calendarId="primary",
        body=event,
        conferenceDataVersion=1,
    ).execute()

    hangout_link = response.get("hangoutLink")
    if not hangout_link:
        raise ValueError("Google Calendar không trả về link Google Meet.")

    return {"join_url": hangout_link, "id": response.get("id")}


def sync_google_meet(db, user_id: int, meeting_url: str, meeting_info: dict) -> dict:
    """
    Sync a Google Meet meeting by searching for transcript on Google Drive.
    Returns { transcript, summary, status } or raises on error.
    """
    if not is_google_connected(db, user_id):
        raise ValueError("Google Calendar/Drive chưa được kết nối.")

    match = re.search(r"meet\.google\.com/([a-z-]+)", meeting_url or "")
    if not match:
        raise ValueError("Link Google Meet không đúng định dạng.")

    meeting_code = match.group(1)
    transcript_data = _fetch_google_meet_transcript(db, user_id, meeting_code)

    if not transcript_data:
        raise ValueError(
            f"Không tìm thấy file transcript cho cuộc họp ({meeting_code}) trên Google Drive. "
            "Hãy chắc chắn cuộc họp đã được ghi chép phụ đề."
        )

    summary = summarize_with_ai(transcript_data["text"], meeting_info)
    return {
        "transcript": transcript_data["text"],
        "summary": summary,
        "status": "DONE",
    }


def _fetch_google_meet_transcript(db, user_id: int, meeting_code: str) -> Optional[dict]:
    """Search Google Drive for a Google Doc transcript matching the meeting code."""
    from googleapiclient.discovery import build

    creds = _get_google_credentials(db, user_id)
    drive = build("drive", "v3", credentials=creds)

    matched_file = None

    # Fallback 1: Direct search by meeting code in file name
    try:
        resp = drive.files().list(
            q=f"name contains '{meeting_code}' and mimeType = 'application/vnd.google-apps.document' and trashed = false",
            spaces="drive",
            fields="files(id, name, createdTime)",
            orderBy="createdTime desc",
            pageSize=1,
        ).execute()
        files = resp.get("files", [])
        if files:
            matched_file = files[0]
            logger.info(f"[Sync] Found transcript by meeting code: {matched_file['name']}")
    except Exception as e:
        logger.warning(f"[Sync] Direct search error: {e}")

    # Fallback 2: Search by video file datetime matching
    if not matched_file:
        try:
            broad_resp = drive.files().list(
                q=f"name contains '{meeting_code}' and trashed = false",
                fields="files(id, name, createdTime, mimeType)",
                pageSize=10,
            ).execute()
            video_file = next(
                (f for f in broad_resp.get("files", []) if meeting_code in f.get("name", "")),
                None,
            )
            if video_file:
                date_match = re.search(r"(\d{4})[-/](\d{2})[-/](\d{2})\s+(\d{2}):(\d{2})", video_file["name"])
                if date_match:
                    year, month, day, hour, minute = date_match.groups()
                    docs_resp = drive.files().list(
                        q="mimeType = 'application/vnd.google-apps.document' and trashed = false",
                        fields="files(id, name, createdTime)",
                        orderBy="createdTime desc",
                        pageSize=50,
                    ).execute()
                    for doc in docs_resp.get("files", []):
                        name = doc.get("name", "")
                        if all(s in name for s in [year, month, day, f"{hour}:{minute}"]):
                            matched_file = doc
                            break
        except Exception as e:
            logger.warning(f"[Sync] Video datetime matching error: {e}")

    # Fallback 3: Search using Calendar event details
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
                    q=f"name contains '{event_summary}' and mimeType = 'application/vnd.google-apps.document' and trashed = false",
                    fields="files(id, name, createdTime)",
                    orderBy="createdTime desc",
                    pageSize=50,
                ).execute()
                best_doc = None
                min_diff = float("inf")
                for doc in docs_resp.get("files", []):
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

    # Export Google Doc as plain text
    export_resp = drive.files().export(
        fileId=matched_file["id"],
        mimeType="text/plain",
    ).execute()

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

def summarize_with_ai(transcript: str, meeting_info: dict) -> list:
    """
    Summarize meeting transcript using AI (Shopaikey API).
    Returns a list of summary lines.
    """
    api_key = settings.AI_API_KEY
    base_url = settings.AI_BASE_URL
    model = settings.AI_MODEL

    if not api_key:
        raise ValueError("Thiếu AI_API_KEY trong cấu hình .env")

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
2. <Rủi ro 2>

BƯỚC TIẾP THEO
1. <Bước 1>

---
TRANSCRIPT:
{transcript}"""

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
        timeout=120,
    )
    if resp.status_code != 200:
        raise ValueError(f"AI API error: {resp.text}")

    data = resp.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise ValueError("AI trả về kết quả rỗng")

    return [line.rstrip() for line in content.split("\n") if line.strip()]


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
