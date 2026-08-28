"""Bridge to the `zalo-worker` Node.js sidecar (services/zalo-worker/), which
holds the persistent zca-js session (login, send, real-time listener). This
module never talks to Zalo directly — it only calls the sidecar's internal
HTTP API over the Docker network, mirroring the `requests`-based style of
services/telegram.py.
"""
import logging

import requests

from ..config import settings

logger = logging.getLogger("zalo")

DEFAULT_TIMEOUT = 15


def _base_url() -> str:
    return (settings.ZALO_WORKER_URL or "").rstrip("/")


def _headers() -> dict:
    token = (settings.ZALO_WORKER_INTERNAL_TOKEN or "").strip()
    return {"X-Internal-Token": token} if token else {}


def is_configured() -> bool:
    return bool(_base_url())


def import_session(cookies: list, imei: str, user_agent: str) -> dict:
    """Push a freshly-captured browser cookie jar to the sidecar and have it
    log in. Raises RuntimeError with a human-readable message on failure —
    callers should turn that into an HTTPException.
    """
    if not is_configured():
        raise RuntimeError("Zalo worker chưa được cấu hình (ZALO_WORKER_URL).")
    try:
        resp = requests.post(
            f"{_base_url()}/session/import",
            json={"cookies": cookies, "imei": imei, "user_agent": user_agent},
            headers=_headers(),
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.error("Zalo worker import_session: could not reach worker at %s: %s", _base_url(), exc)
        raise RuntimeError(f"Không kết nối được tới Zalo worker: {exc}")
    if not resp.ok:
        detail = _error_detail(resp)
        logger.error(
            "Zalo worker import_session failed: HTTP %s from %s — %s. "
            "Xem log container zalo-worker (docker compose logs zalo-worker) để biết lý do Zalo từ chối đăng nhập.",
            resp.status_code, _base_url(), detail,
        )
        raise RuntimeError(detail)
    return resp.json()


def disconnect() -> dict:
    if not is_configured():
        raise RuntimeError("Zalo worker chưa được cấu hình (ZALO_WORKER_URL).")
    try:
        resp = requests.post(f"{_base_url()}/session/disconnect", headers=_headers(), timeout=10)
    except requests.RequestException as exc:
        logger.error("Zalo worker disconnect error: %s", exc)
        raise RuntimeError(f"Không kết nối được tới Zalo worker: {exc}")
    if not resp.ok:
        raise RuntimeError(_error_detail(resp))
    return resp.json()


def get_status() -> dict:
    if not is_configured():
        return {"logged_in": False, "listener_connected": False, "configured": False}
    try:
        resp = requests.get(f"{_base_url()}/status", headers=_headers(), timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        data["configured"] = True
        return data
    except requests.RequestException as exc:
        logger.warning("Zalo worker status check failed: %s", exc)
        return {"logged_in": False, "listener_connected": False, "configured": True, "error": str(exc)}


def send_message(thread_id: str, text: str, is_group: bool, mentions: list = None) -> dict:
    if not is_configured():
        raise RuntimeError("Zalo worker chưa được cấu hình (ZALO_WORKER_URL).")
    try:
        resp = requests.post(
            f"{_base_url()}/conversations/{thread_id}/send",
            json={"text": text, "is_group": is_group, "mentions": mentions or []},
            headers=_headers(),
            timeout=DEFAULT_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.error("Zalo worker send_message error: %s", exc)
        raise RuntimeError(f"Không gửi được tin nhắn: {exc}")
    if not resp.ok:
        raise RuntimeError(_error_detail(resp))
    return resp.json()


def get_groups() -> dict:
    """Best-effort snapshot of the sidecar's in-memory group/friend name
    cache (populated on login via getAllGroups+getGroupInfo+getAllFriends).
    Used to backfill names on conversations created before that cache was
    ready. Returns {} if the worker isn't reachable — never raises.
    """
    if not is_configured():
        return {}
    try:
        resp = requests.get(f"{_base_url()}/groups", headers=_headers(), timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.warning("Zalo worker get_groups failed: %s", exc)
        return {}


def get_conversation_members(thread_id: str) -> dict:
    """Real Zalo group roster (uid + display name), used to suggest which
    @tag names will actually work. Never raises — returns an empty roster on
    any failure so this is a pure UX nicety, never blocking."""
    if not is_configured():
        return {"members": [], "total_member": 0}
    try:
        resp = requests.get(
            f"{_base_url()}/conversations/{thread_id}/members", headers=_headers(), timeout=DEFAULT_TIMEOUT
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.warning("Zalo worker get_conversation_members failed: %s", exc)
        return {"members": [], "total_member": 0}


def _error_detail(resp: "requests.Response") -> str:
    try:
        data = resp.json()
        return str(data.get("error") or data.get("detail") or resp.text)[:500]
    except ValueError:
        return resp.text[:500]
