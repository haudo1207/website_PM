from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    GOOGLE_APPLICATION_CREDENTIALS: str
    AI_BASE_URL: str = "https://api.shopaikey.com/v1"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gpt-4o-mini"
    AI_TIMEOUT_SECONDS: int = 60
    CHECK_INTERVAL_SECONDS: int = 3600
    REDIS_URL: str = ""

    # Zoom Server-to-Server OAuth
    ZOOM_ACCOUNT_ID: str = ""
    ZOOM_CLIENT_ID: str = ""
    ZOOM_CLIENT_SECRET: str = ""

    # Google OAuth2 (for Google Meet & Google Drive)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_CLIENT_EMAIL: str = ""
    GOOGLE_PRIVATE_KEY: str = ""

    # AssemblyAI (for speech-to-text transcription)
    ASSEMBLYAI_API_KEY: str = ""


settings = Settings()
