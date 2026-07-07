from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.sheet import Sheet
from ..models.violation import Violation
from ..models.chat_group import ChatGroup
from ..models.setting import Setting
from ..models.phase import Phase
from ..utils.auth import get_current_user
from ..utils.redis_fallback import fallback_redis
import uuid, re, os, json as _json

router = APIRouter()

# Using fallback_redis for logs and statuses
def _get_redis():
    return fallback_redis

def _get_sheet_stats(sid: int, db: Session):
    violations = db.query(Violation).filter(Violation.sheet_id == sid).all()
    real_violations = [v for v in violations if v.ai_verdict != "SECTION"]
    total = len(real_violations)
    fail = sum(1 for v in real_violations if v.ai_verdict == "FAIL")
    completed = 0
    for v in real_violations:
        try:
            import json
            data = json.loads(v.row_data or "{}")
            status = ""
            for k, val in data.items():
                if k.upper() == "STATUS":
                    status = str(val).lower()
                    break
            if status in ["done", "completed", "hoàn tất"] or "hoàn" in status or "finish" in status:
                completed += 1
        except Exception:
            pass
    return {"total": total, "fail": fail, "completed": completed}

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
    if user.role in ["admin", "group_b"]:
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

@router.post("")
def add(body: dict, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user=Depends(get_current_user)):
    name = body.get("name", "")
    project_code = body.get("project_code")
    customer_name = body.get("customer_name")
    current_phase = body.get("current_phase")
    leader_email = body.get("leader_email")
    pm_email = body.get("pm_email")
    member_emails = body.get("member_emails")
    zalo_link = body.get("zalo_link")
    telegram_link = body.get("telegram_link")
    teams_link = body.get("teams_link")

    import uuid
    sid = f"local_{uuid.uuid4().hex}"
    spreadsheet_url = ""

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
        spreadsheet_url=spreadsheet_url,
        zalo_link=zalo_link,
        telegram_link=telegram_link,
        teams_link=teams_link
    )
    db.add(sheet)
    db.commit()
    db.refresh(sheet)

    # Create the default Master phase
    master_phase = Phase(
        sheet_id=sheet.id,
        name="Master",
        display_order=0,
        is_master=True
    )
    db.add(master_phase)
    db.commit()

    run_id = str(uuid.uuid4())
    return {"id":sheet.id,"run_id":run_id,"message":"Tạo dự án thành công","spreadsheet_url":spreadsheet_url}

@router.get("")
def list_all(db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(Sheet)
    if user.role not in ["admin", "group_b"]:
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
        stats = _get_sheet_stats(s.id, db)
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
            "zalo_link":s.zalo_link,
            "telegram_link":s.telegram_link,
            "teams_link":s.teams_link,
            "last_checked":str(s.last_checked) if s.last_checked else None,
            "violation_count":stats["total"],
            "fail_count":stats["fail"],
            "completed_count":stats["completed"]
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
    db.query(ChatGroup).filter(ChatGroup.sheet_id == sid).delete()
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
    stats = _get_sheet_stats(sid, db)
    return {"sheet_id":sid,"last_checked":str(sheet.last_checked) if sheet.last_checked else None,
            "violation_count":stats["total"],"fail_count":stats["fail"],"completed_count":stats["completed"]}

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


@router.put("/{sid}")
def update_sheet(sid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to update this sheet")
    
    if "name" in body:
        sheet.name = body["name"]
    if "zalo_link" in body:
        sheet.zalo_link = body["zalo_link"]
    if "telegram_link" in body:
        sheet.telegram_link = body["telegram_link"]
    if "teams_link" in body:
        sheet.teams_link = body["teams_link"]
    if "pm_email" in body:
        sheet.pm_email = body["pm_email"]
    if "leader_email" in body:
        sheet.leader_email = body["leader_email"]
    if "customer_name" in body:
        sheet.customer_name = body["customer_name"]
    if "project_code" in body:
        sheet.project_code = body["project_code"]
    if "member_emails" in body:
        sheet.member_emails = body["member_emails"]
        
    db.commit()
    db.refresh(sheet)
    return {
        "id": sheet.id,
        "name": sheet.name,
        "zalo_link": sheet.zalo_link,
        "telegram_link": sheet.telegram_link,
        "teams_link": sheet.teams_link,
        "pm_email": sheet.pm_email,
        "leader_email": sheet.leader_email,
        "customer_name": sheet.customer_name,
        "project_code": sheet.project_code,
        "member_emails": sheet.member_emails
    }

@router.get("/{sid}/chat-groups")
def get_chat_groups(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_read_access(sheet, user):
        raise HTTPException(403, "Access denied")
    groups = db.query(ChatGroup).filter(ChatGroup.sheet_id == sid).order_by(ChatGroup.created_at.desc()).all()
    return groups

@router.post("/{sid}/chat-groups")
def create_chat_group(sid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to write to this sheet")
    
    name = body.get("name")
    platform = body.get("platform")
    link = body.get("link")
    desc = body.get("desc")
    
    if not name or not platform or not link:
        raise HTTPException(400, "name, platform, and link are required")
        
    group = ChatGroup(
        sheet_id=sid,
        name=name,
        platform=platform,
        link=link,
        desc=desc
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group

@router.delete("/{sid}/chat-groups/{cgid}")
def delete_chat_group(sid: int, cgid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to delete from this sheet")
        
    group = db.query(ChatGroup).filter(ChatGroup.sheet_id == sid, ChatGroup.id == cgid).first()
    if not group:
        raise HTTPException(404, "Chat group not found")
        
    db.delete(group)
    db.commit()
    return {"message": "Chat group deleted"}


@router.post("/{sid}/add-task-local")
def add_task_local(sid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Not allowed to add tasks to this sheet")
        
    tab_name = body.get("tab_name")
    after_row = body.get("after_row", 0)
    task_data = body.get("task_data", {})
    
    if not tab_name:
        raise HTTPException(400, "tab_name is required")
        
    # Determine new row number. Find the max row number in that tab, and add 1
    max_row = db.query(Violation).filter(Violation.sheet_id == sid, Violation.tab_name == tab_name).order_by(Violation.row_number.desc()).first()
    new_row_num = (max_row.row_number + 1) if max_row else 2
    
    # Rule 1: Automatically generate sequential TASK ID
    import json
    all_violations = db.query(Violation).filter(Violation.sheet_id == sid).all()
    max_task_id = 0
    for v in all_violations:
        if v.ai_verdict == "SECTION":
            continue
        try:
            rdata = json.loads(v.row_data or "{}")
            tid_val = None
            for k, val in rdata.items():
                if str(k).strip().upper() in ["TASK ID", "TASKID", "ID"]:
                    tid_val = val
                    break
            if tid_val:
                tid_int = int(float(str(tid_val).strip()))
                if tid_int > max_task_id:
                    max_task_id = tid_int
        except Exception:
            pass
    new_task_id = max_task_id + 1
    task_data["TASK ID"] = str(new_task_id)
    
    from ..utils.tasks import compute_derived_fields
    task_data = compute_derived_fields(task_data)
    
    row_data_str = json.dumps(task_data, ensure_ascii=False)
    
    violation = Violation(
        sheet_id=sid,
        tab_name=tab_name,
        row_number=new_row_num,
        row_data=row_data_str,
        violation_code="PASS",
        violation_msg="Task hợp lệ",
        ai_verdict="PASS",
        ai_reason="Task tuân thủ tiêu chuẩn.",
        ai_suggestion="",
        check_run_id="local_add"
    )
    db.add(violation)
    db.commit()
    db.refresh(violation)
    
    # Trigger checking on the new task immediately
    col_setting = db.query(Setting).filter(Setting.key == "column_config").first()
    col_cfg = json.loads(col_setting.value) if col_setting else {}
    req_cols = col_cfg.get("cols", ["DETAIL TASK","PRIORITY","MANDAY (EST)","STATUS","ASSIGNED"])
    
    pol_setting = db.query(Setting).filter(Setting.key == "policy").first()
    policy = json.loads(pol_setting.value) if pol_setting else {"rules":[]}
    
    from ..worker.policy_engine import check_row
    hard_violations = check_row(task_data, policy, req_cols)
    if hard_violations:
        hv = hard_violations[0]
        violation.violation_code = hv["code"]
        violation.violation_msg = hv["message"]
        violation.ai_verdict = "FAIL"
        violation.ai_reason = f"Vi phạm luật cứng: {hv['message']}"
        violation.ai_suggestion = "Sửa dữ liệu trên UI để tuân thủ quy tắc."
        db.commit()
    else:
        ai_setting = db.query(Setting).filter(Setting.key == "ai_config").first()
        ai_cfg = json.loads(ai_setting.value) if ai_setting else {}
        if not ai_cfg.get("api_key"):
            ai_cfg["api_key"] = os.environ.get("AI_API_KEY")
        if not ai_cfg.get("base_url"):
            ai_cfg["base_url"] = os.environ.get("AI_BASE_URL")
        if not ai_cfg.get("model"):
            ai_cfg["model"] = os.environ.get("AI_MODEL","gpt-4o-mini")
            
        from ..worker.ai_evaluator import evaluate_task
        try:
            ai_res = evaluate_task(task_data, ai_cfg, req_cols)
            verdict = ai_res.get("verdict", "REVIEW").strip().upper()
            violation.violation_code = "AI_EVAL" if verdict != "PASS" else "PASS"
            violation.violation_msg = ai_res.get("reason", "") if verdict != "PASS" else "Task hợp lệ"
            violation.ai_verdict = verdict
            violation.ai_reason = ai_res.get("reason", "") if verdict != "PASS" else "Task tuân thủ tiêu chuẩn."
            violation.ai_suggestion = ai_res.get("suggestion", "") if verdict != "PASS" else ""
            db.commit()
        except Exception:
            pass
            
    return {
        "id": violation.id,
        "tab_name": violation.tab_name,
        "row_number": violation.row_number,
        "row_data": violation.row_data,
        "violation_code": violation.violation_code,
        "violation_msg": violation.violation_msg,
        "ai_verdict": violation.ai_verdict,
        "ai_reason": violation.ai_reason,
        "ai_suggestion": violation.ai_suggestion
    }


@router.get("/{sid}/phases")
def get_phases(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Project not found")
    if not has_read_access(sheet, user):
        raise HTTPException(403, "Access denied")
        
    phases = db.query(Phase).filter(Phase.sheet_id == sid).order_by(Phase.id).all()
    
    if not phases:
        master = Phase(sheet_id=sid, name="Master", display_order=0, is_master=True)
        db.add(master)
        db.commit()
        
        distinct_tabs = db.query(Violation.tab_name).filter(
            Violation.sheet_id == sid, 
            Violation.tab_name != None, 
            Violation.tab_name != ""
        ).distinct().all()
        
        for (tname,) in distinct_tabs:
            if tname != "Master":
                new_ph = Phase(sheet_id=sid, name=tname, display_order=10, is_master=False)
                db.add(new_ph)
        db.commit()
        
        phases = db.query(Phase).filter(Phase.sheet_id == sid).order_by(Phase.id).all()
        
    return phases


@router.post("/{sid}/phases")
def create_phase(sid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Project not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Access denied")
        
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Tên Phase không được để trống")
        
    if name.lower() == "master":
        raise HTTPException(400, "Tên 'Master' là dành riêng cho Phase mặc định")
        
    existing = db.query(Phase).filter(Phase.sheet_id == sid, func.lower(Phase.name) == name.lower()).first()
    if existing:
        raise HTTPException(400, f"Phase '{name}' đã tồn tại trong dự án")
        
    max_order = db.query(func.max(Phase.display_order)).filter(Phase.sheet_id == sid).scalar() or 0
    
    new_phase = Phase(
        sheet_id=sid,
        name=name,
        display_order=max_order + 1,
        is_master=False
    )
    db.add(new_phase)
    db.commit()
    db.refresh(new_phase)
    return new_phase


@router.put("/{sid}/phases/{pid}")
def update_phase(sid: int, pid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Project not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Access denied")
        
    phase = db.query(Phase).filter(Phase.id == pid, Phase.sheet_id == sid).first()
    if not phase:
        raise HTTPException(404, "Phase not found")
        
    if phase.is_master:
        raise HTTPException(400, "Không được phép đổi tên Phase Master")
        
    new_name = body.get("name", "").strip()
    if not new_name:
        raise HTTPException(400, "Tên Phase không được để trống")
        
    if new_name.lower() == "master":
        raise HTTPException(400, "Tên 'Master' là dành riêng cho Phase mặc định")
        
    existing = db.query(Phase).filter(
        Phase.sheet_id == sid, 
        Phase.id != pid, 
        func.lower(Phase.name) == new_name.lower()
    ).first()
    if existing:
        raise HTTPException(400, f"Phase '{new_name}' đã tồn tại trong dự án")
        
    old_name = phase.name
    phase.name = new_name
    
    db.query(Violation).filter(Violation.sheet_id == sid, Violation.tab_name == old_name).update(
        {Violation.tab_name: new_name}, synchronize_session=False
    )
    
    db.commit()
    db.refresh(phase)
    return phase


@router.delete("/{sid}/phases/{pid}")
def delete_phase(sid: int, pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sheet = db.query(Sheet).filter(Sheet.id == sid).first()
    if not sheet:
        raise HTTPException(404, "Project not found")
    if not has_write_access(sheet, user):
        raise HTTPException(403, "Access denied")
        
    phase = db.query(Phase).filter(Phase.id == pid, Phase.sheet_id == sid).first()
    if not phase:
        raise HTTPException(404, "Phase not found")
        
    if phase.is_master:
        raise HTTPException(400, "Không được phép xóa Phase Master")
        
    db.query(Violation).filter(Violation.sheet_id == sid, Violation.tab_name == phase.name).delete(
        synchronize_session=False
    )
    
    db.delete(phase)
    db.commit()
    return {"message": f"Phase '{phase.name}' and all its tasks have been deleted"}



