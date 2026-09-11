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


def stop_recording(meeting_id):
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
    return {"file": entry["file"], "size": size}


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
                result = stop_recording(meeting_id)
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
