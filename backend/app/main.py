from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import auth, users, sheets, violations, settings_router
from .database import engine, Base
from .models import user, sheet, setting, violation

Base.metadata.create_all(bind=engine)

from sqlalchemy import text
with engine.connect() as conn:
    for col, col_type in [
        ("leader_email", "VARCHAR"),
        ("pm_email", "VARCHAR"),
        ("member_emails", "VARCHAR"),
        ("project_code", "VARCHAR"),
        ("customer_name", "VARCHAR"),
        ("current_phase", "VARCHAR"),
        ("spreadsheet_url", "VARCHAR"),
        ("zalo_link", "VARCHAR"),
        ("telegram_link", "VARCHAR"),
        ("teams_link", "VARCHAR")
    ]:
        try:
            conn.execute(text(f"ALTER TABLE sheets ADD COLUMN {col} {col_type}"))
            conn.commit()
            print(f"Dynamically added column {col}")
        except Exception:
            pass

app = FastAPI(
    title="Task Compliance Portal",
    version="4.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(auth.router,            prefix="/api/auth")
app.include_router(users.router,           prefix="/api/users")
app.include_router(sheets.router,          prefix="/api/sheets")
app.include_router(violations.router,      prefix="/api/violations")
app.include_router(settings_router.router, prefix="/api/settings")

@app.get("/health")
def health():
    return {"status":"ok","version":"4.0.0"}
