#!/usr/bin/env python3
"""Local recording service for the Meeting Host Bot.

Runs on the same VPS as the Chrome bot, bound to 127.0.0.1 only.
background.js calls POST /record/start once content.js confirms it's
actually in the call (not just the lobby) and POST /record/stop once the
call ends — see README.md. A Chrome extension can't launch ffmpeg
directly, and a small standalone HTTP service is easier to supervise
(systemd, restart-on-crash) than a subprocess owned by a service worker
that Chrome can evict at any time.

No third-party dependencies on purpose — this has to run on whatever
Python the VPS ships with, same reasoning as vps_ssh.py's helpers.
"""
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("RECORDER_PORT", "8765"))
DISPLAY = os.environ.get("RECORDER_DISPLAY", ":101")
AUDIO_SOURCE = os.environ.get("RECORDER_AUDIO_SOURCE", "auto_null.monitor")
OUTPUT_DIR = os.environ.get("RECORDER_OUTPUT_DIR", os.path.expanduser("~/meeting-bot/recordings"))
RESOLUTION = os.environ.get("RECORDER_RESOLUTION", "1280x800")
FRAMERATE = os.environ.get("RECORDER_FRAMERATE", "15")

os.makedirs(OUTPUT_DIR, exist_ok=True)

_recordings = {}  # meeting_id -> {"proc": Popen, "file": path}


def start_recording(meeting_id):
    if meeting_id in _recordings:
        return _recordings[meeting_id]["file"], False
    path = os.path.join(OUTPUT_DIR, f"{meeting_id}_{int(time.time())}.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-f", "x11grab", "-video_size", RESOLUTION, "-framerate", FRAMERATE, "-i", DISPLAY,
        "-f", "pulse", "-i", AUDIO_SOURCE,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _recordings[meeting_id] = {"proc": proc, "file": path}
    return path, True


DRIVE_RESUMABLE_INITIATE_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"


def upload_to_drive(path, access_token, drive_filename, folder_id=None):
    """Uploads directly to Drive from the VPS using a short-lived Bearer
    token handed out by backend's GET /api/meeting-bot/drive-token — this
    process never sees a refresh_token or client_secret, only a token good
    for ~1h (see meeting_bot.py). Resumable (not simple multipart) since a
    real meeting recording can be well past the ~5MB size Google documents
    simple multipart upload for. Streams the file via a file-object `data`
    (urllib/http.client reads it in chunks) instead of loading it into
    memory — this VPS is RAM-constrained (see meeting-host-bot-design
    memory: ~1.9GB available, shared with the live dev app).
    """
    # Confirmed live 2026-09-12: urllib.request's default User-Agent
    # ("Python-urllib/3.x") gets this specific call rejected by Google with
    # a 403 "insufficient authentication scopes" — a misleading error, since
    # the exact same token/scopes succeed immediately on a plain multipart
    # create, and succeed here too once a normal-looking User-Agent is set.
    # Not a scope problem at all; Google is blocking the default urllib UA.
    headers = {"User-Agent": "meeting-host-bot/1.0 (+recorder_service.py)"}

    # Purely organizational — n8n's own search/download don't care where the
    # file lives (see backend/app/routers/meeting_bot.py's
    # _get_or_create_recordings_folder docstring for how this was confirmed).
    metadata_dict = {"name": drive_filename, "mimeType": "video/mp4"}
    if folder_id:
        metadata_dict["parents"] = [folder_id]
    metadata = json.dumps(metadata_dict).encode()
    init_req = urllib.request.Request(
        DRIVE_RESUMABLE_INITIATE_URL,
        data=metadata,
        headers={
            **headers,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(os.path.getsize(path)),
        },
        method="POST",
    )
    with urllib.request.urlopen(init_req, timeout=30) as resp:
        session_uri = resp.headers.get("Location")
    if not session_uri:
        raise RuntimeError("Drive resumable session did not return a Location header")

    file_size = os.path.getsize(path)
    with open(path, "rb") as f:
        put_req = urllib.request.Request(
            session_uri,
            data=f,
            headers={**headers, "Content-Type": "video/mp4", "Content-Length": str(file_size)},
            method="PUT",
        )
        with urllib.request.urlopen(put_req, timeout=1800) as put_resp:
            return json.loads(put_resp.read().decode())


def stop_recording(meeting_id, upload=None):
    entry = _recordings.pop(meeting_id, None)
    if not entry:
        return None
    proc = entry["proc"]
    # SIGINT, not SIGKILL — ffmpeg needs to finalize the moov atom on its own
    # or the .mp4 comes out truncated/unplayable.
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    size = os.path.getsize(entry["file"]) if os.path.exists(entry["file"]) else 0
    result = {"file": entry["file"], "size": size}

    # Upload is additive, same as recording itself relative to Join/Admit —
    # a Drive failure (expired token, network blip, quota) must not make
    # the /record/stop call itself look like it failed; the file is already
    # safely finalized on local disk regardless.
    if upload and upload.get("access_token") and upload.get("drive_filename") and size > 0:
        try:
            drive_file = upload_to_drive(entry["file"], upload["access_token"], upload["drive_filename"], upload.get("folder_id"))
            result["drive"] = {"id": drive_file.get("id"), "name": drive_file.get("name")}
            # Only delete local once Drive has confirmed the file (has an
            # id) — the VPS's NVMe is sized as short-term holding space, not
            # a video archive, but a failed/partial upload must leave the
            # mp4 in place so it can be retried instead of silently lost.
            if drive_file.get("id"):
                try:
                    os.remove(entry["file"])
                    result["local_deleted"] = True
                except OSError as exc:
                    result["local_delete_error"] = str(exc)
        except urllib.error.HTTPError as exc:
            result["drive_upload_error"] = f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:500]}"
        except Exception as exc:
            result["drive_upload_error"] = str(exc)
    return result


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        return json.loads(self.rfile.read(length) or b"{}")

    def do_POST(self):
        try:
            body = self._read_body()
            meeting_id = str(body.get("meeting_id", "")).strip()
            if not meeting_id:
                return self._send_json(400, {"error": "meeting_id required"})
            if self.path == "/record/start":
                path, started = start_recording(meeting_id)
                return self._send_json(200, {"status": "recording" if started else "already_recording", "file": path})
            if self.path == "/record/stop":
                result = stop_recording(meeting_id, body.get("upload"))
                if result is None:
                    return self._send_json(404, {"error": "not recording"})
                return self._send_json(200, {"status": "stopped", **result})
            self._send_json(404, {"error": "unknown path"})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})

    def do_GET(self):
        if self.path == "/record/status":
            status = {mid: {"file": v["file"], "running": v["proc"].poll() is None} for mid, v in _recordings.items()}
            return self._send_json(200, status)
        self._send_json(404, {"error": "unknown path"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Recorder service listening on {HOST}:{PORT} (display={DISPLAY}, audio={AUDIO_SOURCE}, out={OUTPUT_DIR})")
    server.serve_forever()
