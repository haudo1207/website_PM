from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.sheet import Sheet
from ..models.violation import Violation
from ..utils.auth import get_current_user
from ..utils.redis_fallback import fallback_redis
import uuid, re, os, json as _json

router = APIRouter()

# Using fallback_redis for logs and statuses
def _get_redis():
    return fallback_redis

def extract_id(url):
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url)
    if not m:
        raise HTTPException(400, "Invalid Google Sheet URL")
    return m.group(1)

def has_write_access(sheet, user):
    if user.role == "admin":
        return True
    if sheet.owner_id == user.id:
        return True
    if sheet.leader_email == user.email:
        return True
    if sheet.pm_email == user.email:
        return True
    return False

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

@router.post("/")
def add(body: dict, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user=Depends(get_current_user)):
    auto_create = body.get("auto_create", False)
    name = body.get("name", "")
    project_code = body.get("project_code")
    customer_name = body.get("customer_name")
    current_phase = body.get("current_phase")
    leader_email = body.get("leader_email")
    pm_email = body.get("pm_email")
    member_emails = body.get("member_emails")

    if auto_create:
        from ..worker.google_sheet import create_new_sheet
        title = f"{name} - {project_code}" if project_code else name
        try:
            res = create_new_sheet(
                title=title,
                pm_email=pm_email,
                leader_email=leader_email,
                member_emails=member_emails
            )
            sid = res["spreadsheet_id"]
            spreadsheet_url = res["spreadsheet_url"]
        except Exception as e:
            raise HTTPException(500, f"Lỗi tự động tạo Google Sheet: {str(e)}")
    else:
        url = body.get("url")
        if not url:
            raise HTTPException(400, "URL Google Sheet là bắt buộc nếu không tự động tạo.")
        sid = extract_id(url)
        spreadsheet_url = url

    sheet = Sheet(
        spreadsheet_id=sid,
        name=name,
        owner_id=user.id,
        leader_email=leader_email,
        pm_email=pm_email,
        member_emails=member_emails,
        project_code=project_code,
        customer_name=customer_name,
        current_phase=current_phase,
        spreadsheet_url=spreadsheet_url
    )
    db.add(sheet)
    db.commit()
    db.refresh(sheet)
    run_id = str(uuid.uuid4())
    from ..worker.tasks import check_sheet
    background_tasks.add_task(check_sheet, sid, sheet.id, run_id)
    return {"id":sheet.id,"run_id":run_id,"message":"Tạo dự án thành công, đang phân tích...","spreadsheet_url":spreadsheet_url}

@router.get("/")
def list_all(db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(Sheet)
    if user.role != "admin":
        from sqlalchemy import or_
        q = q.filter(
            or_(
                Sheet.owner_id == user.id,
                Sheet.leader_email == user.email,
                Sheet.pm_email == user.email,
                Sheet.member_emails.like(f"%{user.email}%")
            )
        )
    sheets = q.order_by(Sheet.created_at.desc()).all()
    result = []
    for s in sheets:
        count = db.query(Violation).filter(Violation.sheet_id == s.id, Violation.ai_verdict != "PASS").count()
        fail  = db.query(Violation).filter(Violation.sheet_id == s.id, Violation.ai_verdict == "FAIL").count()
        result.append({
            "id":s.id,
            "spreadsheet_id":s.spreadsheet_id,
            "name":s.name,
            "leader_email":s.leader_email,
            "pm_email":s.pm_email,
            "member_emails":s.member_emails,
            "project_code":s.project_code,
            "customer_name":s.customer_name,
            "current_phase":s.current_phase,
            "spreadsheet_url":s.spreadsheet_url,
            "last_checked":str(s.last_checked) if s.last_checked else None,
            "violation_count":count,
            "fail_count":fail
        })
    return result

@router.delete("/{sid}")
def remove(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404)
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to delete this sheet")
    db.query(Violation).filter(Violation.sheet_id == sid).delete()
    db.delete(sheet)
    db.commit()
    return {"message":"Deleted"}

@router.post("/{sid}/check")
def check_now(sid: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to analyze this sheet")
    run_id = str(uuid.uuid4())
    from ..worker.tasks import check_sheet
    background_tasks.add_task(check_sheet, sheet.spreadsheet_id, sid, run_id)
    return {"run_id":run_id,"message":"Check started"}

@router.get("/{sid}/status")
def get_status(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404)
    if not has_read_access(sheet, user):
        raise HTTPException(403, "Access denied")
    count = db.query(Violation).filter(Violation.sheet_id == sid, Violation.ai_verdict != "PASS").count()
    fail  = db.query(Violation).filter(Violation.sheet_id == sid, Violation.ai_verdict=="FAIL").count()
    return {"sheet_id":sid,"last_checked":str(sheet.last_checked) if sheet.last_checked else None,
            "violation_count":count,"fail_count":fail}

@router.get("/{sid}/logs")
def get_logs(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404)
    if not has_read_access(sheet, user):
        raise HTTPException(403, "Access denied")
    try:
        r = _get_redis()
        logs = r.lrange(f"check_log:{sid}", 0, -1)
        status = r.get(f"check_status:{sid}") or "idle"
        return {"status":status,"logs":[_json.loads(l) for l in logs]}
    except Exception as e:
        return {"status":"error","logs":[],"error":str(e)}

@router.post("/{sid}/add-task")
def add_task(sid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to add tasks to this sheet")
        
    tab_name = body.get("tab_name")
    after_row = body.get("after_row")
    task_data = body.get("task_data")
    
    if not tab_name or after_row is None or not task_data:
        raise HTTPException(400, "tab_name, after_row, and task_data are required")
        
    from ..worker.google_sheet import insert_row_in_sheet
    try:
        new_row_num = insert_row_in_sheet(
            spreadsheet_id=sheet.spreadsheet_id,
            tab_name=tab_name,
            after_row=int(after_row),
            row_data=task_data
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi chèn hàng vào Google Sheet: {str(e)}")
        
    # Run sync synchronously so the database is fully updated before returning
    from ..worker.tasks import check_sheet
    import uuid
    run_id = str(uuid.uuid4())
    try:
        check_sheet(sheet.spreadsheet_id, sheet.id, run_id)
    except Exception as e:
        # DB rollback is handled internally in check_sheet
        pass
        
    return {"message": "Thêm task thành công", "new_row_num": new_row_num}

