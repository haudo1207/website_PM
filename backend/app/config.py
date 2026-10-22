from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_file() -> str:
    """Locate the real `.env` file.

    The backend can be launched from different working directories (e.g.
    `cd backend && uvicorn ...` locally vs `WORKDIR /app` in Docker), but the
    canonical environment file lives at the repository root. We prefer that
    file so the actual `.env` (never `.env.example`) is always used no matter
    where the process is started.
    """
    root_env = Path(__file__).resolve().parent.parent.parent / ".env"
    if root_env.is_file():
        return str(root_env)
    return ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "sqlite:///./app.db"
    SECRET_KEY: str = "default-development-secret-key-change-in-env"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    # Portal refresh session (non-rotating in Phase 1).
    REFRESH_TOKEN_EXPIRE_DAYS: int = 20
    REFRESH_COOKIE_NAME: str = "portal_refresh"
    REFRESH_COOKIE_SECURE: bool = True
    INTERNAL_SYNC_TOKEN: str = ""
    GOOGLE_APPLICATION_CREDENTIALS: str = ""
    DEFAULT_ADMIN_EMAIL: str = "admin@company.com"
    DEFAULT_ADMIN_PASSWORD: str = ""
    GOOGLE_LOGIN_ENABLED: bool = True
    PASSWORD_LOGIN_ENABLED: bool = False
    AUTH_SUPERADMIN_EMAILS: str = ""

    # Microsoft (Outlook) login — additive to Google Login.
    # OUTLOOK_TENANT_ID "common" accepts Microsoft personal + Entra accounts.
    OUTLOOK_LOGIN_ENABLED: bool = False
    OUTLOOK_CLIENT_ID: str = ""
    OUTLOOK_TENANT_ID: str = "common"
    AI_BASE_URL: str = "https://api.shopaikey.com/v1"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gpt-4o-mini"
    AI_TIMEOUT_SECONDS: int = 60
    CHECK_INTERVAL_SECONDS: int = 3600
    REDIS_URL: str = ""

    # Google Sheet the n8n meeting-summary pipeline writes each meeting's parsed
    # summary to (1 tab per meeting, tab name == ai_summary.n8n_metadata.sheet_row_id).
    # Acts as a durable backup of that summary — "Đồng bộ" reads it back here
    # before falling back to regenerating via the app's own AI call.
    MEETING_SUMMARY_SHEET_ID: str = "12lhXE87vYPpYwXjT63f0GqBLJKSF49f5hwN5iJ0w4IY"

    # Zalo group daily digest — periodically summarizes each group's messages
    # since the last run into a ZaloConversationSummary row.
    ZALO_SUMMARY_ENABLED: bool = True
    # Plain fixed-interval mode (used while ZALO_SUMMARY_DAILY_AT is unset) —
    # set to a few minutes while testing, 86400 (1 day) for a rough "once a
    # day" cadence that isn't pinned to a specific clock time.
    ZALO_SUMMARY_INTERVAL_SECONDS: int = 86400
    # Real-use mode: run once a day at this exact wall-clock time, Vietnam
    # time (Asia/Ho_Chi_Minh, no DST) — e.g. "00:00" for midnight. Overrides
    # ZALO_SUMMARY_INTERVAL_SECONDS's role as the tick cadence when set;
    # leave blank ("") to stay in plain-interval mode.
    ZALO_SUMMARY_DAILY_AT: str = ""

    # "KPI Prototype" browser extension (frontend/extension-src/ai-tracker/) —
    # bump this whenever a new zip is published so already-installed extensions
    # show an update nudge via GET /api/extension/ai-tracker/version.
    CURRENT_EXTENSION_VERSION: str = "3.0.0"

    # Local disk storage for Resources/Documents file uploads (relative to the
    # backend process working directory; mounted as a Docker volume in prod/dev
    # so files survive container rebuilds).
    UPLOAD_DIR: str = "uploads"

    # DB connection pool — was hard-coded pool_size=2/max_overflow=0 in database.py,
    # which exhausts under concurrent Dashboard load and forces requests to queue.
    # Kept conservative: measured on the dev DB (Supabase pooler) max_connections=60
    # with ~24 already used by Supabase's own infra (Supavisor/PostgREST/pg_cron),
    # leaving ~36 free. pool_size+max_overflow is a per-worker ceiling, and prod
    # runs 2 brands sharing one DB — override via .env per environment once
    # UVICORN_WORKERS > 1 is actually rolled out, based on real headroom there.
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    DB_POOL_TIMEOUT: int = 30

    # Zoom Server-to-Server OAuth
    ZOOM_ACCOUNT_ID: str = ""
    ZOOM_CLIENT_ID: str = ""
    ZOOM_CLIENT_SECRET: str = ""

    # Google OAuth2 (for Google Meet & Google Drive)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REFRESH_TOKEN: str = ""
    GOOGLE_CLIENT_EMAIL: str = ""
    GOOGLE_PRIVATE_KEY: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/meetings/google/callback"

    # Frontend URL for OAuth redirects
    FRONTEND_URL: str = "http://localhost:3000"

    # AssemblyAI (for speech-to-text transcription)
    ASSEMBLYAI_API_KEY: str = ""

    # n8n Integration Webhook Secret
    N8N_WEBHOOK_SECRET: str = ""

    # n8n meeting-discovery webhook: called when a meeting is created on the
    # web app so n8n can search Drive by the meeting's "[MK-xxx]" tag instead
    # of blindly polling "Google Meet" folders. Shared fallback used whenever
    # a Workspace has no n8n_webhook_url of its own set (see
    # notify_n8n_meeting_created in services/meeting_sync.py) — per-workspace
    # URLs live in the `workspaces` table, not here, so adding a new workspace
    # needs no code/env change.
    N8N_MEETING_WEBHOOK_URL_DEFAULT: str = ""

    # Telegram Bot integration (Leave Request notifications)
    TELEGRAM_BOT_TOKEN_LEAVEREQUEST: str = ""
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_WEBHOOK_SECRET: str = ""
    # Optional: a Telegram group/supergroup chat id (e.g. -1001234567890).
    # Leave Request notifications are sent to this group (exactly once) instead
    # of being sent individually to each admin/super_admin's personal chat.
    TELEGRAM_GROUP_CHAT_ID: str | None = None
    TELEGRAM_MESSAGE_THREAD_ID: int | None = 2
    # Public base URL used to build the "View Leave Request" deep link in
    # Telegram notifications. Falls back to FRONTEND_URL when not set.
    APP_BASE_URL: str = ""

    # Zalo integration — internal Docker-network URL of the zalo-worker Node
    # sidecar (holds the persistent zca-js session) and a shared secret so
    # only that sidecar can push received messages into /api/zalo/internal.
    ZALO_WORKER_URL: str = "http://zalo-worker:8090"
    ZALO_WORKER_INTERNAL_TOKEN: str = ""

    # Meeting Host Bot — shared secret for the VPS Chrome-bot fleet that polls
    # GET /api/meeting-bot/queue to know which meetings its logged-in Gmail
    # account needs to Join + Admit. Unset (empty) means the endpoint is
    # locked (fails closed), not "auth disabled" — see
    # extensions/meeting-host-bot/README.md and routers/meeting_bot.py.
    MEETING_BOT_TOKEN: str = ""

    # MSC (Mua Sắm Công) -> PM weekly KPI sync — shared secret MSC sends in X-MSC-Sync-Token to /api/msc-sync/*.
    # Unset (empty) means the endpoints are locked (fails closed), not "auth disabled" — see routers/msc_sync.py.
    MSC_SYNC_TOKEN: str = ""
    # MarkeeAI (appmarkeeai, KPI Priority theo bài đăng) -> PM: token RIÊNG, cùng endpoint /api/msc-sync (xem routers/msc_sync.py: token quyết định nguồn và tiền tố externalKey).
    MARKEEAI_SYNC_TOKEN: str = ""

    @property
    def telegram_base_url(self) -> str:
        return (self.APP_BASE_URL or self.FRONTEND_URL or "").rstrip("/")

    @property
    def is_telegram_enabled(self) -> bool:
        return bool(self.TELEGRAM_BOT_TOKEN)

    @property
    def superadmin_emails(self) -> set[str]:
        return {
            email.strip().lower()
            for email in self.AUTH_SUPERADMIN_EMAILS.split(",")
            if email.strip()
        }


settings = Settings()
