from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.violation import Violation
from ..models.sheet import Sheet
from ..models.setting import Setting
from ..utils.auth import get_current_user
import os, json as _json

router = APIRouter()

def has_read_access(sheet, user):
    if user.role == "admin":
        return True
    if sheet.owner_id == user.id:
        return True
    if sheet.leader_email == user.email:
        return True
    if sheet.pm_email == user.email:
        return True
    if sheet.member_emails:
        emails = [e.strip() for e in sheet.member_emails.split(",") if e.strip()]
        if user.email in emails:
            return True
    return False

@router.get("/")
def list_violations(sheet_id: int = Query(None), ai_verdict: str = Query(None),
                    search: str = Query(None), leader_email: str = Query(None),
                    pm_email: str = Query(None), page: int = Query(1), per_page: int = Query(25),
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(Violation, Sheet).join(Sheet, Violation.sheet_id == Sheet.id).filter(Violation.ai_verdict != "SKIP")
    if user.role not in ["admin","group_b"]:
        from sqlalchemy import or_
        allowed = [s.id for s in db.query(Sheet).filter(
            or_(
                Sheet.owner_id == user.id,
                Sheet.leader_email == user.email,
                Sheet.pm_email == user.email,
                Sheet.member_emails.like(f"%{user.email}%")
            )
        ).all()]
        q = q.filter(Violation.sheet_id.in_(allowed))
    if sheet_id:
        q = q.filter(Violation.sheet_id == sheet_id)
    if ai_verdict:
        q = q.filter(Violation.ai_verdict == ai_verdict)
    if leader_email:
        q = q.filter(Sheet.leader_email == leader_email)
    if pm_email:
        q = q.filter(Sheet.pm_email == pm_email)
    if search:
        safe = search.replace("%", "\\%").replace("_", "\\_")
        q = q.filter(Violation.row_data.ilike(f"%{safe}%"))
    total = q.count()
    if sheet_id:
        items = q.order_by(Violation.row_number.asc()).offset((page-1)*per_page).limit(per_page).all()
    else:
        items = q.order_by(Violation.created_at.desc()).offset((page-1)*per_page).limit(per_page).all()
    return {"total":total,"page":page,"per_page":per_page,
            "items":[{"id":v.id,"sheet_id":v.sheet_id,
                       "sheet_name":s.name or "Unnamed",
                       "leader_email":s.leader_email,
                       "pm_email":s.pm_email,
                       "member_emails":s.member_emails,
                       "tab_name":v.tab_name,"row_number":v.row_number,
                       "row_data":v.row_data,"violation_code":v.violation_code,"violation_msg":v.violation_msg,
                       "ai_verdict":v.ai_verdict,"ai_reason":v.ai_reason,"ai_suggestion":v.ai_suggestion,
                       "created_at":str(v.created_at)} for v, s in items]}

@router.post("/{violation_id}/check")
def check_single_task(violation_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    violation = db.query(Violation).filter(Violation.id == violation_id).first()
    if not violation:
        raise HTTPException(404, "Task/Violation record not found")
        
    sheet = db.query(Sheet).filter(Sheet.id == violation.sheet_id).first()
    if not sheet:
        raise HTTPException(404, "Sheet record not found")
        
    # Check permissions
    if not has_read_access(sheet, user):
        raise HTTPException(403, "Access denied")
        
    # Read latest column configs
    col_setting = db.query(Setting).filter(Setting.key == "column_config").first()
    col_cfg = _json.loads(col_setting.value) if col_setting else {}
    req_cols = col_cfg.get("cols", ["DETAIL TASK","PRIORITY","MANDAY (EST)","STATUS","ASSIGNED"])
    
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
        
    # Fetch the latest row data from Google Sheets
    from ..worker.google_sheet import get_service
    try:
        svc = get_service()
        # Read header row (row 1)
        header_data = svc.spreadsheets().values().get(
            spreadsheetId=sheet.spreadsheet_id,
            range=f"'{violation.tab_name}'!1:1"
        ).execute()
        headers = []
        if header_data.get("values"):
            headers = [h.strip() for h in header_data["values"][0]]
            
        # Read target row
        row_range = f"'{violation.tab_name}'!{violation.row_number}:{violation.row_number}"
        row_data = svc.spreadsheets().values().get(
            spreadsheetId=sheet.spreadsheet_id,
            range=row_range
        ).execute()
        
        padded = []
        if row_data.get("values"):
            padded = row_data["values"][0]
        padded = padded + [""] * (len(headers) - len(padded))
        
        row = {}
        for h, v in zip(headers, padded):
            row[h.strip()] = v
        row["_row"] = violation.row_number
    except Exception as e:
        raise HTTPException(500, f"Không thể đọc dòng từ Google Sheet: {str(e)}")
        
    # Evaluate using Policy Engine (Hard rules)
    from ..worker.policy_engine import check_row
    from ..worker.ai_evaluator import evaluate_task
    from ..worker.tasks import is_section_header_text
    
    row_data_str = _json.dumps({k:v for k,v in row.items() if k != "_row"}, ensure_ascii=False)
    
    # Check if section
    task_id_val = str(row.get("TASK ID", row.get("Task ID", row.get("ID", "")))).strip()
    detail_val = ""
    detail_key = "DETAIL TASK"
    for k, v in row.items():
        if str(k).strip().upper() in ["DETAIL TASK", "DETAIL", "TASK", "DESCRIPTION", "MÔ TẢ", "TÊN TASK"]:
            detail_val = str(v).strip()
            detail_key = k
            break
            
    is_section = False
    assigned_val = str(row.get("ASSIGNED", row.get("Assigned", ""))).strip()
    status_val = str(row.get("STATUS", row.get("Status", ""))).strip()
    priority_val = str(row.get("PRIORITY", row.get("Priority", ""))).strip()
    has_core_fields = bool(assigned_val or status_val or priority_val)
    
    if not has_core_fields:
        if is_section_header_text(task_id_val):
            is_section = True
            if not detail_val:
                detail_val = task_id_val
                task_id_val = ""
        elif is_section_header_text(detail_val):
            is_section = True
            
    if is_section:
        row["TASK ID"] = task_id_val
        if "Task ID" in row: row["Task ID"] = task_id_val
        if "ID" in row: row["ID"] = task_id_val
        row[detail_key] = detail_val
        row_data_str = _json.dumps({k:v for k,v in row.items() if k != "_row"}, ensure_ascii=False)
        
        violation.row_data = row_data_str
        violation.violation_code = "SECTION"
        violation.violation_msg = ""
        violation.ai_verdict = "SECTION"
        violation.ai_reason = ""
        violation.ai_suggestion = ""
        db.commit()
        return {
            "id": violation.id,
            "ai_verdict": violation.ai_verdict,
            "ai_reason": violation.ai_reason,
            "ai_suggestion": violation.ai_suggestion,
            "row_data": violation.row_data
        }
        
    hard_violations = check_row(row, policy, req_cols)
    if hard_violations:
        hv = hard_violations[0]
        violation.row_data = row_data_str
        violation.violation_code = hv["code"]
        violation.violation_msg = hv["message"]
        violation.ai_verdict = "FAIL"
        violation.ai_reason = f"Vi phạm luật cứng: {hv['message']}"
        violation.ai_suggestion = "Sửa dữ liệu trên Google Sheets để tuân thủ quy tắc."
        db.commit()
        return {
            "id": violation.id,
            "ai_verdict": violation.ai_verdict,
            "ai_reason": violation.ai_reason,
            "ai_suggestion": violation.ai_suggestion,
            "row_data": violation.row_data
        }
        
    # Evaluate using AI
    try:
        ai_res = evaluate_task(row, ai_cfg, req_cols)
        verdict = ai_res.get("verdict", "REVIEW").strip().upper()
        
        violation.row_data = row_data_str
        violation.violation_code = "AI_EVAL" if verdict != "PASS" else "PASS"
        violation.violation_msg = ai_res.get("reason", "") if verdict != "PASS" else "Task hợp lệ"
        violation.ai_verdict = verdict
        violation.ai_reason = ai_res.get("reason", "") if verdict != "PASS" else "Task tuân thủ tiêu chuẩn."
        violation.ai_suggestion = ai_res.get("suggestion", "") if verdict != "PASS" else ""
        db.commit()
    except Exception as e:
        raise HTTPException(500, f"Lỗi AI Evaluator: {str(e)}")
        
    return {
        "id": violation.id,
        "ai_verdict": violation.ai_verdict,
        "ai_reason": violation.ai_reason,
        "ai_suggestion": violation.ai_suggestion,
        "row_data": violation.row_data
    }
