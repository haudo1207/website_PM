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
    sid = extract_id(body["url"])
    sheet = Sheet(
        spreadsheet_id=sid,
        name=body.get("name",""),
        owner_id=user.id,
        leader_email=body.get("leader_email"),
        pm_email=body.get("pm_email"),
        member_emails=body.get("member_emails")
    )
    db.add(sheet)
    db.commit()
    db.refresh(sheet)
    run_id = str(uuid.uuid4())
    from ..worker.tasks import check_sheet
    background_tasks.add_task(check_sheet, sid, sheet.id, run_id)
    return {"id":sheet.id,"run_id":run_id,"message":"Sheet added, checking..."}

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
