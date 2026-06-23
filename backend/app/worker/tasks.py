from .celery_app import celery_app
from ..database import SessionLocal
from ..models.sheet import Sheet
from ..models.violation import Violation
from ..models.setting import Setting
from .google_sheet import read_tabs
from .policy_engine import check_row
from .ai_evaluator import evaluate_task
from datetime import datetime, timezone
import json as _json, os
from ..utils.redis_fallback import fallback_redis
 
def log_progress(r_conn, sheet_id, msg, level="info"):
    payload = _json.dumps({"time":str(datetime.now()),"level":level,"msg":msg}, ensure_ascii=False)
    r_conn.rpush(f"check_log:{sheet_id}", payload)
    r_conn.ltrim(f"check_log:{sheet_id}", -100, -1)
 
@celery_app.task(name="app.worker.tasks.check_sheet")
def check_sheet(spreadsheet_id: str, db_sheet_id: int, run_id: str):
    db = SessionLocal()
    r = fallback_redis
    r.set(f"check_status:{db_sheet_id}", "running")
    r.delete(f"check_log:{db_sheet_id}")
    log_progress(r, db_sheet_id, f"Bắt đầu check sheet run_id={run_id}")
 
    try:
        sheet = db.query(Sheet).filter(Sheet.id == db_sheet_id).first()
        if not sheet:
            log_progress(r, db_sheet_id, "Không tìm thấy sheet trong DB", "error")
            return
 
        col_setting = db.query(Setting).filter(Setting.key == "column_config").first()
        col_cfg = _json.loads(col_setting.value) if col_setting else {}
        req_cols = col_cfg.get("cols", ["DETAIL TASK","PRIORITY","MANDAY (EST)","STATUS","ASSIGNED"])
        tab_names = col_cfg.get("tab_names", [])
 
        pol_setting = db.query(Setting).filter(Setting.key == "policy").first()
        policy = _json.loads(pol_setting.value) if pol_setting else {"rules":[]}
 
        ai_setting = db.query(Setting).filter(Setting.key == "ai_config").first()
        ai_cfg = _json.loads(ai_setting.value) if ai_setting else {}
        if not ai_cfg.get("api_key"):
            ai_cfg["api_key"] = os.environ.get("AI_API_KEY")
        if not ai_cfg.get("base_url"):
            ai_cfg["base_url"] = os.environ.get("AI_BASE_URL")
        if not ai_cfg.get("model"):
            ai_cfg["model"] = os.environ.get("AI_MODEL","gpt-4o-mini")
 
        log_progress(r, db_sheet_id, f"Đang kết nối Google Sheets và đọc các Tab...")
        tabs = read_tabs(spreadsheet_id, req_cols, tab_names)
 
        db.query(Violation).filter(Violation.sheet_id == db_sheet_id).delete()
        db.commit()
 
        total_rows_checked = 0
        total_violations_found = 0
 
        for t in tabs:
            tab_name = t["tab_name"]
            rows = t["rows"]
            log_progress(r, db_sheet_id, f"Tab '{tab_name}': tìm thấy {len(rows)} hàng hợp lệ")
 
            for row in rows:
                row_num = row["_row"]
                total_rows_checked += 1
                row_data_str = _json.dumps({k:v for k,v in row.items() if k != "_row"}, ensure_ascii=False)
 
                hard_violations = check_row(row, policy, req_cols)
                if hard_violations:
                    for hv in hard_violations:
                        db.add(Violation(
                            sheet_id=db_sheet_id, tab_name=tab_name, row_number=row_num,
                            row_data=row_data_str, violation_code=hv["code"],
                            violation_msg=hv["message"], ai_verdict="FAIL",
                            ai_reason=f"Vi phạm luật cứng: {hv['message']}",
                            ai_suggestion="Sửa dữ liệu trên Google Sheets để tuân thủ quy tắc.",
                            check_run_id=run_id
                        ))
                    total_violations_found += len(hard_violations)
                    log_progress(r, db_sheet_id, f"Hàng {row_num} [FAIL] Vi phạm luật cứng: {hard_violations[0]['message']}")
                    continue
 
                log_progress(r, db_sheet_id, f"Đang gửi AI đánh giá hàng {row_num}...")
                ai_res = evaluate_task(row, ai_cfg, req_cols)
                verdict = ai_res.get("verdict", "REVIEW").strip().upper()
 
                if verdict in ["FAIL", "REVIEW", "PASS"]:
                    db.add(Violation(
                        sheet_id=db_sheet_id, tab_name=tab_name, row_number=row_num,
                        row_data=row_data_str, violation_code="AI_EVAL" if verdict != "PASS" else "PASS",
                        violation_msg=ai_res.get("reason","") if verdict != "PASS" else "Task hợp lệ", ai_verdict=verdict,
                        ai_reason=ai_res.get("reason","") if verdict != "PASS" else "Task tuân thủ tiêu chuẩn.", ai_suggestion=ai_res.get("suggestion","") if verdict != "PASS" else "",
                        check_run_id=run_id
                    ))
                    if verdict in ["FAIL", "REVIEW"]:
                        total_violations_found += 1
                    log_progress(r, db_sheet_id, f"Hàng {row_num} [{verdict}]" + (f" {ai_res.get('reason','')}" if verdict != "PASS" else ""))
 
            db.commit()
 
        sheet.last_checked = datetime.now(timezone.utc)
        db.commit()
        log_progress(r, db_sheet_id, f"Hoàn thành check. Checked={total_rows_checked}, Violations={total_violations_found}")
        r.set(f"check_status:{db_sheet_id}", "success")
 
    except Exception as e:
        db.rollback()
        log_progress(r, db_sheet_id, f"Lỗi hệ thống: {str(e)}", "error")
        r.set(f"check_status:{db_sheet_id}", "failed")
    finally:
        db.close()
 
@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    interval = int(os.environ.get("CHECK_INTERVAL_SECONDS", 3600))
    sender.add_periodic_task(interval, check_all_sheets.s(), name="check_sheets_periodic")
 
@celery_app.task(name="app.worker.tasks.check_all_sheets")
def check_all_sheets():
    db = SessionLocal()
    try:
        active_sheets = db.query(Sheet).filter(Sheet.is_active == True).all()
        for s in active_sheets:
            check_sheet.delay(s.spreadsheet_id, s.id, "periodic")
    finally:
        db.close()
