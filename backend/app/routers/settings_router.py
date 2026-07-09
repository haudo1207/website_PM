from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.setting import Setting, AuditLog
from ..utils.auth import require_admin, get_current_user
from ..config import settings as app_settings
import json, requests as http

router = APIRouter()

def get_setting(key, db):
    s = db.query(Setting).filter(Setting.key == key).first()
    return json.loads(s.value) if s else None

def save_setting(key, value, db, user_email="system"):
    old = db.query(Setting).filter(Setting.key == key).first()
    new_val = json.dumps(value, ensure_ascii=False)
    if old:
        old.value = new_val
    else:
        db.add(Setting(key=key, value=new_val))
    db.add(AuditLog(user_email=user_email, action=f"update_{key}", detail=new_val[:300]))
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
    save_setting("column_config", body, db, admin.email)
    return {"message":"Updated"}

@router.get("/policy")
def get_pol(db=Depends(get_db), _=Depends(get_current_user)):
    return get_setting("policy", db) or {"rules":[]}

@router.put("/policy")
def set_pol(body: dict, db=Depends(get_db), admin=Depends(require_admin)):
    save_setting("policy", body, db, admin.email)
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
    save_setting("ai_config", current, db, admin.email)
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
