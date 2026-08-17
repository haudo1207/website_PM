from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.setting import Setting
from ..utils.audit_service import AuditService
from ..utils.auth import require_admin, get_current_user
from ..config import settings as app_settings
import json, requests as http

router = APIRouter()

def get_setting(key, db):
    s = db.query(Setting).filter(Setting.key == key).first()
    return json.loads(s.value) if s else None

def save_setting(key, value, db, user_id=None, log=True, log_value=None):
    """Persist a key/value Setting row.

    log=False skips the audit trail entirely — for settings that are pure UI
    preference (e.g. column_config) rather than a system-level change worth
    auditing. log_value overrides what gets written into the log description,
    so callers can redact secrets (e.g. ai_config's api_key) before it's
    persisted into the audit_logs table.
    """
    old = db.query(Setting).filter(Setting.key == key).first()
    new_val = json.dumps(value, ensure_ascii=False)
    if old:
        old.value = new_val
    else:
        db.add(Setting(key=key, value=new_val))
    if log:
        logged_val = json.dumps(log_value, ensure_ascii=False) if log_value is not None else new_val
        AuditService.record(
            db=db,
            user_id=user_id,
            module="Settings",
            entity_type="Setting",
            entity_id=key,
            action="UPDATE",
            description=f"Cập nhật cấu hình '{key}': {logged_val[:300]}"
        )
    db.commit()

@router.get("/column-config")
def get_col(db=Depends(get_db), _=Depends(get_current_user)):
    return get_setting("column_config", db) or {
        "cols": ["DETAIL TASK", "PRIORITY", "MANDAY (EST)", "STATUS", "ASSIGNED"],
        "tab_names": []
    }

@router.put("/column-config")
def set_col(body: dict, db=Depends(get_db), admin=Depends(require_admin)):
    if not body.get("cols"):
        raise HTTPException(400, "cols required")
    # Pure per-tenant UI display preference, not a system-level change — skip the audit trail.
    save_setting("column_config", body, db, log=False)
    return {"message":"Updated"}

@router.get("/policy")
def get_pol(db=Depends(get_db), _=Depends(get_current_user)):
    return get_setting("policy", db) or {"rules":[]}

@router.put("/policy")
def set_pol(body: dict, db=Depends(get_db), admin=Depends(require_admin)):
    save_setting("policy", body, db, user_id=admin.id)
    return {"message":"Updated"}

@router.get("/ai-config")
def get_ai(db=Depends(get_db), _=Depends(require_admin)):
    cfg = get_setting("ai_config", db) or {}
    raw_key = cfg.get("api_key") or app_settings.AI_API_KEY
    return {"base_url":cfg.get("base_url",app_settings.AI_BASE_URL),"model":cfg.get("model",app_settings.AI_MODEL),
            "has_key":bool(raw_key and not raw_key.startswith("sk-xxxx")),
            "system_prompt":cfg.get("system_prompt",""),"check_interval_hours":cfg.get("check_interval_hours",1)}

@router.put("/ai-config")
def set_ai(body: dict, db=Depends(get_db), admin=Depends(require_admin)):
    current = get_setting("ai_config", db) or {}
    for k in ["api_key","base_url","model","system_prompt","check_interval_hours"]:
        if k in body and body[k] != "":
            current[k] = body[k]
    # Redact the API key from what actually gets written into the audit log —
    # the real value still persists to the Setting row via `current` above.
    safe_for_log = {**current, "api_key": "***redacted***" if current.get("api_key") else None}
    save_setting("ai_config", current, db, user_id=admin.id, log_value=safe_for_log)
    return {"message":"Updated"}

@router.get("/ai-models")
def get_models(db=Depends(get_db), _=Depends(require_admin)):
    cfg = get_setting("ai_config", db) or {}
    url = cfg.get("base_url", app_settings.AI_BASE_URL)
    key = cfg.get("api_key") or app_settings.AI_API_KEY
    try:
        r = http.get(f"{url}/models", headers={"Authorization":f"Bearer {key}"}, timeout=15)
        if r.status_code == 200:
            return {"models":sorted([m["id"] for m in r.json().get("data",[])])}
        return {"models":[],"error":f"API returned {r.status_code}"}
    except Exception as e:
        return {"models":[],"error":str(e)}

@router.get("/audit-log")
def audit(db=Depends(get_db), _=Depends(require_admin)):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all()
    return [{"id":l.id,"user":l.user_email,"action":l.action,"at":str(l.created_at)} for l in logs]
