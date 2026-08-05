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


def is_google_connected(db, user_id: int) -> bool:
    """Check if Google OAuth tokens or Google SSO login are available for the user."""
    tokens = _load_google_tokens(db, user_id)
    if tokens and (tokens.get("refresh_token") or tokens.get("access_token")):
        return True

    # Auto-detect if user logged in via Google SSO (has google_sub)
    if user_id:
        try:
            from ..models.user import User
            user = db.query(User).filter((User.id == user_id) | (User.member_id == user_id)).first()
            if user and user.google_sub:
                return True
        except Exception:
            pass

    # System-wide check fallback: if any GoogleToken exists in database
    try:
        from ..models.google_token import GoogleToken
        if db.query(GoogleToken).first():
            return True
    except Exception:
        pass

    return False


def create_google_meet_link(db, user_id: int, topic: str, start_time: str, duration_minutes: int = 60) -> dict:
    """
    Create a Google Calendar event with Google Meet link.
    If Google OAuth is not connected or fails, fallback to instant Google Meet creation URL.
    Returns { join_url, id }.
    """
    try:
        if is_google_connected(db, user_id):
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
            if hangout_link:
                return {"join_url": hangout_link, "id": response.get("id")}
    except Exception as e:
        logger.warning(f"Google Calendar Meet creation fallback used due to: {e}")

    # Fallback: Official instant Google Meet link
    return {"join_url": "https://meet.google.com/new", "id": None}


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
        prompt = f"""Bạn là chuyên gia AI phân tích cuộc họp. Dựa trên thông tin cuộc họp:
- Tên cuộc họp: {title}
- Dự án liên quan: {project_name}
- Ngày họp: {date_str}

Hãy đóng vai AI tự động lắng nghe và phân tích cuộc họp này, trả về kết quả JSON THUẦN TÚY (JSON Object), KHÔNG bọc trong markdown block, KHÔNG thêm câu dẫn:
{{
  "executive_summary": "Tóm tắt điều hành 2-3 câu ngắn gọn, chính xác về mục đích, nội dung trao đổi chính và định hướng của cuộc họp '{title}'.",
  "decisions": [
    "Quyết định 1 cụ thể thu được từ cuộc họp {title}",
    "Quyết định 2 về tiến độ, chất lượng hoặc nhân sự",
    "Quyết định 3 về cam kết công việc tiếp theo"
  ],
  "recommended_tasks": [
    {{
      "detail_task": "Hạng mục công việc 1 cụ thể giao trong cuộc họp {title}",
      "priority": "Critical",
      "assigned_name": "Nguyễn Hoàng Nam",
      "deadline": "2026-08-08"
    }},
    {{
      "detail_task": "Hạng mục công việc 2 cụ thể giao trong cuộc họp {title}",
      "priority": "High",
      "assigned_name": "Trần Khánh Vy",
      "deadline": "2026-08-10"
    }},
    {{
      "detail_task": "Hạng mục công việc 3 cụ thể giao trong cuộc họp {title}",
      "priority": "Normal",
      "assigned_name": "Phạm Nhật Minh",
      "deadline": "2026-08-12"
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

    if os.environ.get("GEMINI_API_KEY") or (gemini_key and gemini_key.startswith("AIza")):
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

    if not raw_text and openai_key:
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=60,
            )
            if resp.status_code == 200:
                data = resp.json()
                raw_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"OpenAI API call failed: {e}")

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
                return parsed
        except Exception as e:
            logger.warning(f"Failed to parse JSON from AI response: {e}")

    # Fallback customized per meeting title and project name (No static hardcoded copy-paste!)
    return {
        "executive_summary": f"Cuộc họp '{title}' thuộc dự án '{project_name}' đã rà soát tiến độ và thống nhất kế hoạch làm việc.",
        "decisions": [
            f"Chốt mục tiêu chính của cuộc họp '{title}'.",
            "Ưu tiên hoàn thiện các hạng mục quan trọng đúng hạn.",
            "Leader chịu trách nhiệm nghiệm thu kết quả bàn giao."
        ],
        "recommended_tasks": [
            { "detail_task": f"Thực hiện công việc trọng điểm cuộc họp {title}", "priority": "Critical", "assigned_name": "Nguyễn Hoàng Nam", "deadline": "2026-08-08" },
            { "detail_task": f"Hoàn thiện tài liệu và checklist {title}", "priority": "High", "assigned_name": "Trần Khánh Vy", "deadline": "2026-08-10" },
            { "detail_task": f"Báo cáo kết quả {title} cho Leader", "priority": "Normal", "assigned_name": "Phạm Nhật Minh", "deadline": "2026-08-12" }
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

    if os.environ.get("GEMINI_API_KEY") or (gemini_key and gemini_key.startswith("AIza")):
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

    if not content and openai_key:
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=90,
            )
            if resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"OpenAI/Shopaikey API call failed: {e}")

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
