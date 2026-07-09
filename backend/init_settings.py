import json, os
from app.database import SessionLocal
from app.models.setting import Setting

def init():
    db = SessionLocal()
    try:
        # 1. Column Config
        if not db.query(Setting).filter(Setting.key == "column_config").first():
            cols = {
                "cols": ["DETAIL TASK", "PRIORITY", "MANDAY (EST)", "STATUS", "ASSIGNED"],
                "tab_names": []
            }
            db.add(Setting(key="column_config", value=json.dumps(cols, ensure_ascii=False)))
            print("Initialized column_config")

        # 2. Policy Config (Rules)
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
            print("Initialized policy rules")

        # 3. AI Config
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
            print("Initialized ai_config")

        db.commit()
        print("Settings initialization complete.")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    init()
