from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import Optional
import datetime

from ..database import get_db
from ..models.member import Member, member_skills
from ..models.skill_master import Skill
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..utils.auth import require_admin, get_current_user
from sqlalchemy import func, extract

router = APIRouter()


def member_to_dict(m: Member) -> dict:
    return {
        "id": m.id,
        "display_name": m.display_name,
        "full_name": m.full_name,
        "email": m.email,
        "telegram_username": m.telegram_username,
        "phone": m.phone,
        "birth_date": m.birth_date.isoformat() if m.birth_date else None,
        "gender": m.gender,
        "team": m.team,
        "position": m.position,
        "department": m.department,
        "experience_year": m.experience_year,
        "created_at": m.created_at,
        "skill_ids": [s.id for s in m.skills],
        "skills": [
            {"id": s.id, "name": s.name}
            for s in m.skills
        ]
    }


# ─── LIST ───────────────────────────────────────────────
@router.get("")
def list_members(
    search: Optional[str] = None,
    team: Optional[str] = None,
    position: Optional[str] = None,
    department: Optional[str] = None,
    skill_id: Optional[int] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    # Subquery to calculate KPI from Tasks for each member (assigned_id)
    # Chỉ lấy các task đã hoàn thành (Done) VÀ bắt buộc phải có ngày hoàn thành thực tế (end_date_actual)
    task_query = db.query(
        Task.assigned_id,
        func.sum(Task.kpi_final).label('kpi_total'),
        func.count(Task.id).label('task_count'),
        func.sum(Task.manday_actual).label('manday_total')
    ).filter(
        Task.status == 'Done',
        Task.end_date_actual.isnot(None)
    )

    # Custom Fiscal Calendar Template (Hỗ trợ mọi năm)
    # Cấu trúc: (start_month_day, end_month_day, start_year_offset, end_year_offset, weeks)
    CYCLE_TEMPLATE = {
        1:  ("-12-22", "-01-18", -1, 0, 4),
        2:  ("-01-19", "-02-22", 0, 0, 5),
        3:  ("-02-23", "-03-22", 0, 0, 4),
        4:  ("-03-23", "-04-19", 0, 0, 4),
        5:  ("-04-20", "-05-24", 0, 0, 5),
        6:  ("-05-25", "-06-21", 0, 0, 4),
        7:  ("-06-22", "-07-19", 0, 0, 4),
        8:  ("-07-20", "-08-23", 0, 0, 5),
        9:  ("-08-24", "-09-20", 0, 0, 4),
        10: ("-09-21", "-10-25", 0, 0, 5),
        11: ("-10-26", "-11-22", 0, 0, 4),
        12: ("-11-23", "-12-20", 0, 0, 4),
    }

    weeks_divisor = 52 # Mặc định nếu chọn Tất cả các tháng (của 1 năm) là 52 tuần

    if year:
        if month and month in CYCLE_TEMPLATE:
            s_md, e_md, s_yo, e_yo, weeks = CYCLE_TEMPLATE[month]
            weeks_divisor = weeks
            start_dt = f"{year + s_yo}{s_md}"
            end_dt = f"{year + e_yo}{e_md}"
            task_query = task_query.filter(
                Task.end_date_actual >= start_dt,
                Task.end_date_actual <= end_dt
            )
        else:
            # Lấy toàn bộ chu kỳ của năm đó (từ 22/12 năm trước đến 20/12 năm nay)
            task_query = task_query.filter(
                Task.end_date_actual >= f"{year - 1}-12-22",
                Task.end_date_actual <= f"{year}-12-20"
            )
    else:
        # Nếu chỉ có tháng mà không có năm (mặc dù UI bắt buộc chọn năm)
        if month:
            task_query = task_query.filter(extract('month', Task.end_date_actual) == month)

    kpi_subq = task_query.group_by(Task.assigned_id).subquery()

    # Query Member with KPI
    q = db.query(
        Member,
        func.coalesce(kpi_subq.c.kpi_total, 0).label('kpi_total'),
        func.coalesce(kpi_subq.c.task_count, 0).label('task_count'),
        func.coalesce(kpi_subq.c.manday_total, 0).label('manday_total')
    ).outerjoin(
        kpi_subq, Member.id == kpi_subq.c.assigned_id
    ).options(joinedload(Member.skills))

    if search:
        like = f"%{search}%"
        q = q.filter(
            (Member.display_name.ilike(like)) | (Member.full_name.ilike(like))
        )
    if team:
        q = q.filter(Member.team == team)
    if position:
        q = q.filter(Member.position == position)
    if department:
        q = q.filter(Member.department == department)
    if skill_id:
        q = q.filter(Member.skills.any(Skill.id == skill_id))

    results = q.order_by(Member.display_name.asc()).all()
    
    out = []
    for m, kpi_total, task_count, manday_total in results:
        d = member_to_dict(m)
        
        total = float(kpi_total) if kpi_total else 0.0
        count = int(task_count) if task_count else 0
        md_total = float(manday_total) if manday_total else 0.0
        
        avg = 0.0
        bonus = 0.0
        
        # Chỉ tính Trung bình và Bonus nếu người dùng đang lọc theo một Tháng cụ thể
        if month:
            # 1. Trung bình KPI (Tổng điểm KPI / Số tuần của chu kỳ đó)
            avg = round(total / weeks_divisor, 2) if weeks_divisor > 0 else 0.0
            
            # 2. KPI Bonus (dựa trên ảnh bảng Achievement)
            if total >= 150:
                bonus = 1.50
            elif total >= 100:
                step = (int(total) - 100) // 5
                bonus = 1.00 + (step * 0.05)
            
        d['kpi_total'] = total
        d['kpi_avg'] = avg
        d['kpi_bonus'] = round(bonus, 2)
        d['manday_total'] = md_total
        
        out.append(d)
        
    return out


# ─── GET ONE ─────────────────────────────────────────────
@router.get("/{id}")
def get_member(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    return member_to_dict(m)


# ─── CREATE ──────────────────────────────────────────────
@router.post("")
def create_member(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    display_name = str(body.get("display_name", "")).strip()
    full_name = str(body.get("full_name", "")).strip()

    if not display_name:
        raise HTTPException(400, "Display Name không được để trống")
    if not full_name:
        raise HTTPException(400, "Họ và tên không được để trống")

    if db.query(Member).filter(Member.display_name.ilike(display_name)).first():
        raise HTTPException(400, f"Display Name '{display_name}' đã tồn tại")

    birth_date = None
    bd_str = body.get("birth_date", "")
    if bd_str:
        try:
            birth_date = datetime.date.fromisoformat(str(bd_str))
        except ValueError:
            pass

    m = Member(
        display_name=display_name,
        full_name=full_name,
        email=body.get("email") or None,
        telegram_username=body.get("telegram_username") or None,
        phone=body.get("phone") or None,
        birth_date=birth_date,
        gender=body.get("gender") or None,
        team=body.get("team") or None,
        position=body.get("position") or None,
        department=body.get("department") or None,
        experience_year=int(body.get("experience_year") or 0),
    )

    skill_ids = body.get("skill_ids", [])
    if skill_ids:
        skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        m.skills = skills

    db.add(m)
    db.commit()
    db.refresh(m)
    # reload with skills
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == m.id).first()
    return member_to_dict(m)


# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_member(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")

    display_name = str(body.get("display_name", m.display_name)).strip()
    full_name = str(body.get("full_name", m.full_name)).strip()

    if not display_name:
        raise HTTPException(400, "Display Name không được để trống")
    if not full_name:
        raise HTTPException(400, "Họ và tên không được để trống")

    dup = db.query(Member).filter(
        Member.display_name.ilike(display_name),
        Member.id != id
    ).first()
    if dup:
        raise HTTPException(400, f"Display Name '{display_name}' đã tồn tại")

    birth_date = m.birth_date
    bd_str = body.get("birth_date", "")
    if bd_str is not None:
        if bd_str:
            try:
                birth_date = datetime.date.fromisoformat(str(bd_str))
            except ValueError:
                pass
        else:
            birth_date = None

    m.display_name = display_name
    m.full_name = full_name
    m.email = body.get("email") or None
    m.telegram_username = body.get("telegram_username") or None
    m.phone = body.get("phone") or None
    m.birth_date = birth_date
    m.gender = body.get("gender") or None
    m.team = body.get("team") or None
    m.position = body.get("position") or None
    m.department = body.get("department") or None
    m.experience_year = int(body.get("experience_year") or 0)

    skill_ids = body.get("skill_ids")
    if skill_ids is not None:
        skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        m.skills = skills

    db.commit()
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    return member_to_dict(m)


# ─── DELETE ──────────────────────────────────────────────
@router.delete("/{id}")
def delete_member(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    m = db.query(Member).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    db.delete(m)
    db.commit()
    return {"message": "Đã xóa thành viên thành công"}


# ─── GET TEAMS (distinct list) ────────────────────────────
@router.get("/meta/teams")
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(Member.team).filter(Member.team.isnot(None)).distinct().all()
    return sorted([r[0] for r in rows if r[0]])
