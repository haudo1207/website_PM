import os
import json
import datetime
from app.database import SessionLocal, engine, Base
from app.models.meeting import Meeting
from app.models.project import Project

# Ensure tables are created
Base.metadata.create_all(bind=engine)

def run_migration():
    json_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "data", "meetings.json")
    if not os.path.exists(json_path):
        json_path = os.path.join(os.path.dirname(__file__), "meetings.json")
    
    if not os.path.exists(json_path):
        print(f"[*] Không tìm thấy file JSON cũ tại các đường dẫn kiểm tra. Bỏ qua migration.")
        return

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            meetings_data = json.load(f)
    except Exception as e:
        print(f"[!] Lỗi đọc file JSON: {e}")
        return

    if not meetings_data:
        print("[*] Tệp meetings.json rỗng. Không có dữ liệu để di chuyển.")
        return

    print(f"[*] Phát hiện {len(meetings_data)} cuộc họp cũ từ meetings.json. Bắt đầu di chuyển...")

    db = SessionLocal()
    try:
        # Load all projects to map by name
        projects = db.query(Project).all()
        project_map = {p.name.lower().strip(): p.id for p in projects}

        migrated_count = 0
        for m_data in meetings_data:
            title = m_data.get("title", "Cuộc họp không có tên").strip()
            # Map project name to project_id
            proj_name = str(m_data.get("project", "")).lower().strip()
            project_id = project_map.get(proj_name) if proj_name else None

            # Parse date
            date_str = m_data.get("date")
            try:
                meeting_date = datetime.date.fromisoformat(date_str) if date_str else datetime.date.today()
            except ValueError:
                meeting_date = datetime.date.today()

            # Parse start and end time
            def parse_time(time_str):
                if not time_str:
                    return None
                try:
                    parts = str(time_str).split(":")
                    if len(parts) >= 2:
                        return datetime.time(int(parts[0]), int(parts[1]))
                except Exception:
                    pass
                return None

            start_time = parse_time(m_data.get("time")) or datetime.time(9, 0)
            end_time = parse_time(m_data.get("endTime"))

            # Format aiSummary (array) -> ai_summary (JSONB/dict)
            ai_summary_old = m_data.get("aiSummary")
            ai_summary_new = None
            if ai_summary_old:
                if isinstance(ai_summary_old, list):
                    ai_summary_new = {
                        "summary": "Tóm tắt cuộc họp chuyển đổi từ dữ liệu cũ",
                        "decisions": [],
                        "issues": [],
                        "action_items": ai_summary_old
                    }
                else:
                    ai_summary_new = {
                        "summary": str(ai_summary_old),
                        "decisions": [],
                        "issues": [],
                        "action_items": []
                    }

            status = str(m_data.get("status", "UPCOMING")).upper()
            if status not in ["UPCOMING", "ONGOING", "DONE", "CANCELLED"]:
                status = "UPCOMING"

            # Create DB Meeting
            db_meeting = Meeting(
                title=title,
                description=m_data.get("description"),
                platform=m_data.get("platform", "Microsoft Teams"),
                meeting_url=m_data.get("meeting_url"),
                meeting_date=meeting_date,
                start_time=start_time,
                end_time=end_time,
                status=status,
                transcript=m_data.get("transcript"),
                ai_summary=ai_summary_new,
                project_id=project_id
            )
            db.add(db_meeting)
            migrated_count += 1

        db.commit()
        print(f"[+] Đã di chuyển thành công {migrated_count} cuộc họp vào PostgreSQL.")

        # Empty the JSON file so we don't migrate again
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump([], f)
        print("[*] Đã làm sạch tệp meetings.json cũ.")

    except Exception as e:
        db.rollback()
        print(f"[!] Gặp lỗi trong quá trình di chuyển dữ liệu: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()
