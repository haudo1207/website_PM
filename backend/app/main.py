from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import auth, users, sheets, violations, settings_router
from .database import engine, Base
from .models import user, sheet, setting, violation, chat_group, phase

Base.metadata.create_all(bind=engine)

def init_db_defaults():
    from .database import SessionLocal
    from .models.user import User
    from .models.setting import Setting
    from .utils.auth import hash_password
    import json
    import os

    db = SessionLocal()
    try:
        # 1. Initialize settings if missing
        if not db.query(Setting).filter(Setting.key == "column_config").first():
            cols = {
                "cols": ["DETAIL TASK", "PRIORITY", "MANDAY (EST)", "STATUS", "ASSIGNED"],
                "tab_names": ["1.Sale/Admin", "2.Init", "2.1.Lab/PoC", "3.Implement", "4.MA"]
            }
            db.add(Setting(key="column_config", value=json.dumps(cols, ensure_ascii=False)))
            print("[*] Automatically initialized column_config")

        if not db.query(Setting).filter(Setting.key == "policy").first():
            policy = {
                "rules": [
                    {
                        "field": "PRIORITY",
                        "value": "URGENT",
                        "manday_max": 2.0,
                        "min_words": 10,
                        "required_fields": ["ASSIGNED", "STATUS"]
                    },
                    {
                        "field": "PRIORITY",
                        "value": "CRITICAL",
                        "manday_max": 3.0,
                        "min_words": 15,
                        "required_fields": ["ASSIGNED", "STATUS"]
                    },
                    {
                        "field": "PRIORITY",
                        "value": "HIGH",
                        "manday_max": 5.0,
                        "min_words": 5,
                        "required_fields": ["ASSIGNED"]
                    }
                ]
            }
            db.add(Setting(key="policy", value=json.dumps(policy, ensure_ascii=False)))
            print("[*] Automatically initialized policy rules")

        if not db.query(Setting).filter(Setting.key == "ai_config").first():
            ai = {
                "base_url": os.environ.get("AI_BASE_URL", "https://api.shopaikey.com/v1"),
                "api_key": os.environ.get("AI_API_KEY", ""),
                "model": os.environ.get("AI_MODEL", "gpt-4o-mini"),
                "system_prompt": (
                    "Bạn là trợ lý ảo kiểm soát chất lượng & tuân thủ quy trình dự án.\n"
                    "Hãy đánh giá dòng công việc (task) sau từ Google Sheet:\n"
                    "1. Kiểm tra xem mô tả công việc (DETAIL TASK) có đủ rõ ràng, có đầy đủ mục tiêu, kết quả bàn giao hay không.\n"
                    "2. Đánh giá xem Manday (MANDAY (EST)) có quá cao hay quá thấp so với mô tả công việc không.\n"
                    "3. Trả về phán quyết (PASS, FAIL, hoặc REVIEW).\n"
                    "4. Đưa ra Lý do (tiếng Việt).\n"
                    "5. Đưa ra Gợi ý cải thiện cụ thể (tiếng Việt).\n"
                    "Định dạng trả về bắt buộc là JSON hợp lệ có dạng: {\"verdict\":\"...\",\"reason\":\"...\",\"suggestion\":\"...\"}\n"
                    "Không viết markdown, không thêm ký tự ngoài JSON."
                ),
                "check_interval_hours": 1
            }
            db.add(Setting(key="ai_config", value=json.dumps(ai, ensure_ascii=False)))
            print("[*] Automatically initialized ai_config")

        # 2. Initialize default admin user if no users exist
        if db.query(User).count() == 0:
            admin = User(
                id=1,
                email="admin@company.com",
                full_name="Admin Company",
                hashed_pw=hash_password("admin123"),
                role="admin",
                is_active=True
            )
            db.add(admin)
            print("[*] Automatically created default admin user: admin@company.com")

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[!] Error seeding database: {e}")
    finally:
        db.close()

# Run database auto-seeding
init_db_defaults()

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
