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

    # Telegram Bot integration (Leave Request notifications)
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
