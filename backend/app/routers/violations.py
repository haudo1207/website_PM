from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.violation import Violation
from ..models.sheet import Sheet
from ..utils.auth import get_current_user

router = APIRouter()

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
