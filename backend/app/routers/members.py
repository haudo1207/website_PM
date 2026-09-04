from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional
import datetime

from ..models.user import User
from ..database import get_db
from ..config import settings
from ..models.member import Member, member_skills
from ..models.skill_master import Skill
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..utils.auth import require_admin, get_current_user
from ..models.workspace_access import UserWorkspaceAccess
from ..utils.access import member_query_for_user, resolve_workspace, scope_display_name, workspace_leader_names, ALL_SCOPE, ROLE_LEADER
from ..utils.audit_service import AuditService
from sqlalchemy import func, extract, false, or_, and_

TEAM_POSITIONS = {
  "Infrastructure": [
    "Network Engineer", "System Administrator", "IT Support/Helpdesk", "Cybersecurity Specialist",
    "Network Team", "System Team", "Security Team", "Hội nghị & Tổng đài", "Cloud & Datacenter"
  ],
  "Dev/DevOps": [
    "Product Manager", "UI/UX Designer", "Business Analyst", "Bridge Software Engineer (BrSE)", "Tester/QC",
    "Frontend Developer", "Backend Developer", "Mobile Developer", "Fullstack Developer", "DevOps Engineer",
    "BA", "Frontend Developer", "Backend Developer", "Full-stack Developer", "DevOps / Platform", "Fullstack Developer",
    "Video Editor", "Graphic Designer", "Motion Designer", "Photographer"
  ],
  "AI": [
    "AI / ML Engineer", "Data Scientist", "Data Engineer", "Computer Vision Engineer", "NLP Engineer",
    "Data Analyst / Engineer", "AI Product / Research"
  ],
  "Marketing": [
    "Content Creator", "SEO Specialist", "Digital Marketer", "Media Designer", "Copywriter",
    "Content & Social", "Performance & Acquisition", "Marketing Ops"
  ],
  "Sales": [
    "Account Executive", "Sales Consultant", "Customer Support Representative", "Telemarketer",
    "B2B Sales", "Business Development", "Customer Success", "Sales/Customer Care"
  ]
}

def calc_kpi_bonus(kpi: float) -> float:
    if kpi < 90: return 0.0
    if kpi < 95: return 0.90
    if kpi < 100: return 0.95
    if kpi < 105: return 1.00
    if kpi < 110: return 1.05
    if kpi < 115: return 1.10
    if kpi < 120: return 1.15
    if kpi < 125: return 1.20
    if kpi < 130: return 1.25
    if kpi < 135: return 1.30
    if kpi < 140: return 1.35
    if kpi < 145: return 1.40
    if kpi < 150: return 1.45
    return 1.50

def get_primary_team(positions):
    for team, team_positions in TEAM_POSITIONS.items():
        if any(pos in team_positions for pos in positions):
            return team
    return "all"

from ..models.system_category import Team, Department

LEVEL_MAP = {
    "lv1": "Intern LV1",
    "lv2": "Intern LV2",
    "lv3": "Intern LV3",
    "fresher": "Fresher",
    "core": "Core Team",
    "presales": "Presales",
    "sales": "Sales",
    "leader": "Leader"
}

def ensure_system_level(db: Session, name: str):
    if not name:
        return
    name = name.strip()
    existing = db.query(Team).filter(Team.name.ilike(name)).first()
    if not existing:
        db.add(Team(name=name))
        db.flush()

def ensure_system_department(db: Session, name: str):
    if not name:
        return
    name = name.strip()
    existing = db.query(Department).filter(Department.name.ilike(name)).first()
    if not existing:
        db.add(Department(name=name))
        db.flush()

def format_display_name(name: str) -> str:
    if not name:
        return ""
    import re
    clean_name = re.sub(r"\s*\([^)]*\)\s*$", "", str(name)).strip()
    words = [w for w in clean_name.split() if w]
    if len(words) <= 2:
        return " ".join(words)[:50]
    abbr = ".".join([w[0].upper() for w in words[:-2]])
    last_two = " ".join(words[-2:])
    return f"{abbr} {last_two}"[:50]

def make_unique_display_name(db: Session, base_name: str, member_id: Optional[int] = None, used_in_batch: Optional[set] = None) -> str:
    name = (base_name or "").strip()[:50]
    if not name:
        return "Member"
    candidate = name
    counter = 1
    
    while True:
        if used_in_batch is not None and candidate.lower() in used_in_batch:
            counter += 1
            candidate = f"{name} {counter}"[:50]
            continue
            
        query = db.query(Member).filter(Member.display_name.ilike(candidate))
        if member_id:
            query = query.filter(Member.id != member_id)
        exists = query.first()
        
        if not exists:
            if used_in_batch is not None:
                used_in_batch.add(candidate.lower())
            return candidate
            
        counter += 1
        candidate = f"{name} {counter}"[:50]


router = APIRouter()


def member_to_dict(m: Member) -> dict:
    return {
        "id": m.id,
        "user_id": m.user.id if m.user else None,
        "display_name": m.display_name,
        "full_name": m.full_name,
        "email": m.email,
        "telegram_username": m.telegram_username,
        "zalo_name": m.zalo_name,
        "phone": m.phone,
        "birth_date": m.birth_date.isoformat() if m.birth_date else None,
        "gender": m.gender,
        "team": m.team,
        "position": m.position,
        "department": m.department,
        "experience_year": m.experience_year,
        "created_at": m.created_at,
        "leader_name": m.leader_name,
        "leader_email": m.leader_email,
        "leader_member_id": getattr(m, "leader_member_id", None),
        "skill_ids": [s.id for s in m.skills],
        "skills": [
            {"id": s.id, "name": s.name}
            for s in m.skills
        ]
    }


@router.get("/workspace-roles")
def list_member_workspace_roles(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Chính/Phụ Workspace membership per Member, keyed by member_id — a
    lightweight, separate lookup (rather than folding into the large
    list_members() KPI query above) so the Dashboard/Project UIs can merge
    it in client-side without touching that query's risk surface.
    Only Members with a linked User account (role Leader/Member) have
    entries; a Member with no login, or whose User is super_admin/viewer,
    is simply absent from the response."""
    from ..models.workspace_access import UserWorkspaceAccess
    from ..models.system_category import Workspace
    from ..utils.access import ROLE_LEADER, ROLE_MEMBER as _ROLE_MEMBER

    rows = (
        db.query(Member.id, Workspace.code, Workspace.name, UserWorkspaceAccess.is_primary)
        .join(User, User.member_id == Member.id)
        .join(UserWorkspaceAccess, UserWorkspaceAccess.user_id == User.id)
        .join(Workspace, Workspace.id == UserWorkspaceAccess.workspace_id)
        .filter(User.role.in_([ROLE_LEADER, _ROLE_MEMBER]))
        .all()
    )
    result: dict[int, list[dict]] = {}
    for member_id, code, name, is_primary in rows:
        result.setdefault(member_id, []).append({"code": code, "name": name, "is_primary": bool(is_primary)})
    for entries in result.values():
        entries.sort(key=lambda e: (not e["is_primary"], e["code"]))
    return result


# ─── LIST ───────────────────────────────────────────────
@router.get("")
def list_members(
    search: Optional[str] = None,
    team: Optional[str] = None,
    position: Optional[str] = None,
    department: Optional[str] = None,
    workspace: Optional[str] = None,
    skill_id: Optional[int] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    leader_name: Optional[str] = None,
    scope: Optional[bool] = Query(
        False,
        description=(
            "When true, restrict the result to the caller's authorized "
            "Workspace(s) — i.e. the same filter that applies to Member / "
            "Viewer by default. Used by Dashboard → Overview (KPI Matrix) "
            "for Leader callers so the KPI Matrix shows only members inside "
            "the Leader's authorized Workspace(s). Default false preserves "
            "the Members-tab behavior where Leaders see every member."
        ),
    ),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    # Subquery to calculate KPI from Tasks for each member
    # Using UNION ALL to combine assigned and support portions of the task
    q_assigned = db.query(
        Task.assigned_id.label('member_id'),
        Task.kpi_assigned.label('kpi_final'),
        func.coalesce(Task.manday_actual, Task.manday_est, 0.0).label('manday_actual'),
        func.coalesce(Task.manday_est, 0.0).label('manday_est'),
        (Task.kpi_base * Task.kpi_ratio_assign / 100.0).label('kpi_base'),
        Task.id.label('task_id')
    ).filter(
        Task.status == 'Done',
        Task.end_date_actual.isnot(None),
        Task.assigned_id.isnot(None)
    )

    q_support = db.query(
        Task.support_id.label('member_id'),
        Task.kpi_support.label('kpi_final'),
        func.coalesce(Task.manday_actual, Task.manday_est, 0.0).label('manday_actual'),
        func.coalesce(Task.manday_est, 0.0).label('manday_est'),
        (Task.kpi_base * Task.kpi_ratio_support / 100.0).label('kpi_base'),
        Task.id.label('task_id')
    ).filter(
        Task.status == 'Done',
        Task.end_date_actual.isnot(None),
        Task.support_id.isnot(None)
    )

    # Custom Fiscal Calendar Template
    # Structure: (start_month_day, end_month_day, start_year_offset, end_year_offset, weeks)
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
    # Default: full year = 52 weeks; will be overridden when a specific month is selected
    weeks_divisor = 52

    # Apply date filters
    if start_date or end_date:
        if start_date:
            q_assigned = q_assigned.filter(Task.end_date_actual >= start_date)
            q_support = q_support.filter(Task.end_date_actual >= start_date)
        if end_date:
            q_assigned = q_assigned.filter(Task.end_date_actual <= end_date)
            q_support = q_support.filter(Task.end_date_actual <= end_date)
    else:
        if month and not year:
            year = datetime.datetime.now().year

        if year:
            if month and month in CYCLE_TEMPLATE:
                s_md, e_md, s_yo, e_yo, weeks = CYCLE_TEMPLATE[month]
                weeks_divisor = weeks
                start_dt = f"{year + s_yo}{s_md}"
                end_dt = f"{year + e_yo}{e_md}"
                q_assigned = q_assigned.filter(Task.end_date_actual >= start_dt, Task.end_date_actual <= end_dt)
                q_support = q_support.filter(Task.end_date_actual >= start_dt, Task.end_date_actual <= end_dt)
            else:
                q_assigned = q_assigned.filter(Task.end_date_actual >= f"{year - 1}-12-22", Task.end_date_actual <= f"{year}-12-20")
                q_support = q_support.filter(Task.end_date_actual >= f"{year - 1}-12-22", Task.end_date_actual <= f"{year}-12-20")
        else:
            if month:
                q_assigned = q_assigned.filter(extract('month', Task.end_date_actual) == month)
                q_support = q_support.filter(extract('month', Task.end_date_actual) == month)

    union_q = q_assigned.union_all(q_support).subquery('union_q')

    task_query = db.query(
        union_q.c.member_id.label('member_id'),
        func.sum(union_q.c.kpi_final).label('kpi_total'),
        func.count(union_q.c.task_id).label('task_count'),
        func.sum(union_q.c.manday_actual).label('manday_total'),
        func.sum(union_q.c.manday_est).label('manday_est_total'),
        func.sum(union_q.c.kpi_base).label('kpi_base_total')
    ).group_by(union_q.c.member_id)

    kpi_subq = task_query.subquery()

    # Query Member with KPI
    q = db.query(
        Member,
        User.id.label("user_id"),
        func.coalesce(kpi_subq.c.kpi_total, 0).label("kpi_total"),
        func.coalesce(kpi_subq.c.task_count, 0).label("task_count"),
        func.coalesce(kpi_subq.c.manday_total, 0).label("manday_total"),
        func.coalesce(kpi_subq.c.manday_est_total, 0).label("manday_est_total"),
        func.coalesce(kpi_subq.c.kpi_base_total, 0).label("kpi_base_total")
    ).outerjoin(
        User, User.member_id == Member.id
    ).outerjoin(
        kpi_subq, Member.id == kpi_subq.c.member_id
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
    if leader_name:
        q = q.filter(Member.leader_name == leader_name)
    if workspace:
        ws = resolve_workspace(db, workspace)
        if ws:
            # Chính-only match: a member whose Chính is elsewhere but holds
            # this Workspace as Phụ must NOT pass this filter (that's the
            # whole point of "Chính before Phụ" scoping on the Dashboard
            # roster) — resolved from the canonical is_primary row, not the
            # legacy `User.data_scope` column, which can drift out of sync
            # with it (see primary_workspace_code_for_user docstring).
            primary_user_ids = db.query(UserWorkspaceAccess.user_id).filter(
                UserWorkspaceAccess.workspace_id == ws.id, UserWorkspaceAccess.is_primary == True  # noqa: E712
            )
            users_without_access_rows = db.query(User.id).filter(
                ~User.id.in_(db.query(UserWorkspaceAccess.user_id))
            )
            # A "all"-scope account belongs to every Workspace — same fallback
            # projects.py already applies for Project.business == "All".
            q = q.filter(or_(
                User.id.in_(primary_user_ids),
                and_(User.id.in_(users_without_access_rows), User.data_scope == ws.code),
                User.data_scope == ALL_SCOPE,
            ))
        else:
            q = q.filter(false())
    if skill_id:
        q = q.filter(Member.skills.any(Skill.id == skill_id))

    # Workspace data scope: members are limited to the caller's Workspace
    # (linked account scope + members assigned to projects within scope).
    #
    # Three scopes coexist for the same endpoint:
    #   1. Default (no `scope` param) — used by Accounts → "Quản lý thành
    #      viên" tab, which intentionally bypasses the Workspace filter for
    #      Leader callers (they need to manage every Member in the system).
    #      Member / Viewer continue to be scoped to their assigned Workspaces
    #      because `member_query_for_user` already short-circuits for them.
    #   2. `?scope=true` — used by Dashboard → Overview KPI Matrix so a
    #      Leader's KPI columns are restricted to their authorized
    #      Workspace(s) only. Same backend filter as Member / Viewer.
    #   3. Super Admin (`role == ROLE_SUPER_ADMIN` or `scopes == ALL_SCOPE`) —
    #      always returns every Member regardless of `scope`.
    if current_user.role == ROLE_LEADER and not scope:
        # Path 1: Leader sees every Member (Members-tab behavior).
        pass
    else:
        # Path 2 + 3: Super Admin short-circuits inside
        # `member_query_for_user`; everyone else is scoped.
        q = q.filter(Member.id.in_(member_query_for_user(db, current_user).with_entities(Member.id)))

    results = q.order_by(Member.display_name.asc()).all()
    
    out = []
    for ( m, user_id, kpi_total, task_count, manday_total, manday_est_total, kpi_base_total ) in results:
        d = member_to_dict(m)
        d["user_id"] = user_id
        
        total = float(kpi_total) if kpi_total else 0.0
        count = int(task_count) if task_count else 0
        md_total = float(manday_total) if manday_total else 0.0
        md_est_t = float(manday_est_total) if manday_est_total else 0.0
        kpi_base_t = float(kpi_base_total) if kpi_base_total else 0.0
        avg = round(total / weeks_divisor, 2) if weeks_divisor > 0 else 0.0
        bonus = calc_kpi_bonus(avg)

        d['kpi_total'] = total
        d['kpi_avg'] = avg
        d['kpi_bonus'] = round(bonus, 2)
        d['manday_total'] = md_total
        d['manday_est_total'] = float(md_est_t)
        d['kpi_base_total'] = float(kpi_base_t)
        d['workspace'] = scope_display_name(db, m.user.data_scope) if m.user else None
        
        out.append(d)
        
    return out


# ─── GET WORKSPACE-SCOPED LEADERS (Dashboard Leader card visibility) ──
# Declared before /{id} so the literal path is not captured by the int route.
@router.get("/workspace-leaders")
def list_workspace_leaders(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Distinct Leader names the caller is allowed to see on the Dashboard.

    Backend-authoritative: the set is computed solely from the caller's
    assigned Workspace(s) (account scope + department attribution), so a caller
    cannot widen it through query parameters. super_admin / scope=all receive
    the full unrestricted leader list.
    """
    return {"leaders": workspace_leader_names(db, current_user)}


# ─── KPI SUMMARY FOR RECRUITMENT ──────────────────────────────
@router.get("/kpi-summary")
def get_kpi_summary(
    month: Optional[int] = None,
    year: Optional[int] = None,
    x_sync_token: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    # Verify token
    expected_token = settings.INTERNAL_SYNC_TOKEN or "markee-kpi-sync-secret-key-2026"
    if not x_sync_token or x_sync_token != expected_token:
        raise HTTPException(status_code=401, detail="Unauthorized sync token")

    q_assigned = db.query(
        Task.assigned_id.label('member_id'),
        Task.kpi_assigned.label('kpi_final'),
        (Task.manday_actual * Task.kpi_ratio_assign / 100.0).label('manday_actual'),
        (Task.manday_est * Task.kpi_ratio_assign / 100.0).label('manday_est'),
        (Task.kpi_base * Task.kpi_ratio_assign / 100.0).label('kpi_base'),
        Task.id.label('task_id')
    ).filter(
        Task.status == 'Done',
        Task.end_date_actual.isnot(None),
        Task.assigned_id.isnot(None)
    )

    q_support = db.query(
        Task.support_id.label('member_id'),
        Task.kpi_support.label('kpi_final'),
        (Task.manday_actual * Task.kpi_ratio_support / 100.0).label('manday_actual'),
        (Task.manday_est * Task.kpi_ratio_support / 100.0).label('manday_est'),
        (Task.kpi_base * Task.kpi_ratio_support / 100.0).label('kpi_base'),
        Task.id.label('task_id')
    ).filter(
        Task.status == 'Done',
        Task.end_date_actual.isnot(None),
        Task.support_id.isnot(None)
    )

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
    weeks_divisor = 52

    import datetime
    if month and not year:
        year = datetime.datetime.now().year

    if year:
        if month and month in CYCLE_TEMPLATE:
            s_md, e_md, s_yo, e_yo, weeks = CYCLE_TEMPLATE[month]
            weeks_divisor = weeks
            start_dt = f"{year + s_yo}{s_md}"
            end_dt = f"{year + e_yo}{e_md}"
            q_assigned = q_assigned.filter(Task.end_date_actual >= start_dt, Task.end_date_actual <= end_dt)
            q_support = q_support.filter(Task.end_date_actual >= start_dt, Task.end_date_actual <= end_dt)
        else:
            q_assigned = q_assigned.filter(Task.end_date_actual >= f"{year - 1}-12-22", Task.end_date_actual <= f"{year}-12-20")
            q_support = q_support.filter(Task.end_date_actual >= f"{year - 1}-12-22", Task.end_date_actual <= f"{year}-12-20")
    else:
        if month:
            from sqlalchemy import extract
            q_assigned = q_assigned.filter(extract('month', Task.end_date_actual) == month)
            q_support = q_support.filter(extract('month', Task.end_date_actual) == month)

    union_q = q_assigned.union_all(q_support).subquery('union_q')

    task_query = db.query(
        union_q.c.member_id.label('member_id'),
        func.sum(union_q.c.kpi_final).label('kpi_total')
    ).group_by(union_q.c.member_id)

    kpi_subq = task_query.subquery()

    results = db.query(
        Member.email,
        func.coalesce(kpi_subq.c.kpi_total, 0).label("kpi_total")
    ).outerjoin(
        kpi_subq, Member.id == kpi_subq.c.member_id
    ).all()

    out = {}
    for email, kpi_total in results:
        if not email:
            continue
        email_clean = email.strip().lower()
        total = float(kpi_total) if kpi_total else 0.0
        avg = round(total / weeks_divisor, 2) if weeks_divisor > 0 else 0.0
        bonus = calc_kpi_bonus(avg)
        out[email_clean] = {
            "kpi_total": total,
            "kpi_bonus": round(bonus, 2)
        }
    return {"members": out}


# ─── GET ONE ─────────────────────────────────────────────
@router.get("/{id}")
def get_member(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    return member_to_dict(m)


# ─── CREATE ──────────────────────────────────────────────
@router.post("")
def create_member(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
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
        zalo_name=body.get("zalo_name") or None,
        phone=body.get("phone") or None,
        birth_date=birth_date,
        gender=body.get("gender") or None,
        team=body.get("team") or None,
        position=body.get("position") or None,
        department=body.get("department") or None,
        experience_year=int(body.get("experience_year") or 0),
        leader_name=body.get("leader_name") or None,
        leader_email=body.get("leader_email") or None,
    )

    skill_ids = body.get("skill_ids", [])
    if skill_ids:
        skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        m.skills = skills

    db.add(m)
    db.commit()
    db.refresh(m)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Member", entity_type="Member",
        entity_id=m.id, action="CREATE", resource_name=m.display_name,
        description=f"Tạo thành viên '{m.display_name}'"
    )
    db.commit()
    # reload with skills
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == m.id).first()
    return member_to_dict(m)


# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_member(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
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

    old_dict = {
        "display_name": m.display_name, "full_name": m.full_name, "email": m.email,
        "team": m.team, "position": m.position, "department": m.department,
    }

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
    m.zalo_name = body.get("zalo_name") or None
    m.phone = body.get("phone") or None
    m.birth_date = birth_date
    m.gender = body.get("gender") or None
    m.team = body.get("team") or None
    m.position = body.get("position") or None
    m.department = body.get("department") or None
    m.experience_year = int(body.get("experience_year") or 0)
    m.leader_name = body.get("leader_name") or None
    m.leader_email = body.get("leader_email") or None

    skill_ids = body.get("skill_ids")
    if skill_ids is not None:
        skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        m.skills = skills

    db.commit()
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Member", entity_type="Member",
        entity_id=m.id, old_dict=old_dict,
        new_dict={"display_name": m.display_name, "full_name": m.full_name, "email": m.email,
                  "team": m.team, "position": m.position, "department": m.department},
        field_labels={"display_name": "Display Name", "full_name": "Họ tên", "email": "Email",
                      "team": "Team", "position": "Vị trí", "department": "Phòng ban"},
    )
    db.commit()
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    return member_to_dict(m)


# ─── DELETE ──────────────────────────────────────────────
@router.delete("/{id}")
def delete_member(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    m = db.query(Member).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    m_name = m.display_name
    db.delete(m)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Member", entity_type="Member",
        entity_id=id, action="DELETE", resource_name=m_name,
        description=f"Xóa thành viên '{m_name}'"
    )
    db.commit()
    return {"message": "Đã xóa thành viên thành công"}


# ─── GET TEAMS (distinct list) ────────────────────────────
@router.get("/meta/teams")
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(Member.team).filter(Member.team.isnot(None)).distinct().all()
    return sorted([r[0] for r in rows if r[0]])


# ─── GET LEADERS (canonical: active portal leaders) ─────────
@router.get("/meta/leaders")
def list_leaders(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Canonical Leader source: active portal users with role='leader'.

    Super Admin sees every valid active system Leader (authorization/account model),
    not every free-text Member.leader_name. Recruitment/supabase leaders are NOT
    used as the primary source; Member.leader_name remains legacy/display only.
    """
    # Canonical: users with role=leader and is_active
    leaders = (
        db.query(User)
        .filter(User.role == "leader", User.is_active == True)  # noqa: E712
        .all()
    )
    out = []
    seen = set()
    for u in leaders:
        # Prefer linked Member identity when available
        member = getattr(u, "member", None)
        if member and getattr(member, "display_name", None):
            name = member.display_name
        elif member and getattr(member, "full_name", None):
            name = member.full_name
        else:
            name = u.full_name or (u.email.split("@")[0] if u.email else "")
        name = (name or "").strip()
        # Fallback formatting for consistency
        if name:
            name = format_display_name(name) or name
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        email = u.email or (member.email if member and getattr(member, "email", None) else "")
        out.append({"name": name, "email": email or "", "member_id": u.member_id, "user_id": u.id})
    return sorted(out, key=lambda x: x["name"])


# ─── SYNC CANDIDATE ──────────────────────────────────────────
@router.post("/sync-candidate")
def sync_candidate(
    body: dict,
    x_sync_token: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    # Verify token
    expected_token = settings.INTERNAL_SYNC_TOKEN or "markee-kpi-sync-secret-key-2026"
    if not x_sync_token or x_sync_token != expected_token:
        raise HTTPException(status_code=401, detail="Unauthorized sync token")
        
    full_name = str(body.get("full_name", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    phone = str(body.get("phone", "")).strip()
    level = str(body.get("level", "")).strip().lower()
    position = str(body.get("position", "")).strip()
    team = str(body.get("team", "")).strip()
    telegram_username = str(body.get("telegram", "")).strip()
    cv_link = str(body.get("cv_link", "")).strip()
    
    birth_date_str = body.get("birth_date")
    birth_date = None
    if birth_date_str:
        try:
            birth_date = datetime.date.fromisoformat(str(birth_date_str).strip()[:10])
        except ValueError:
            pass
    
    if not full_name:
        raise HTTPException(status_code=400, detail="Họ và tên không được để trống")
        
    # 1. Abbreviate Display Name: Keep last two words in full, abbreviate previous ones
    words = [w for w in full_name.split() if w]
    if len(words) <= 2:
        display_name = " ".join(words)
    else:
        abbr = ".".join([w[0].upper() for w in words[:-2]])
        last_two = " ".join(words[-2:])
        display_name = f"{abbr} {last_two}"
        
    # 2. Map Level and Team directly
    mapped_team = LEVEL_MAP.get(level.lower().strip(), level)
    department = team if team and team != "all" else (position if position else None)
    
    # Auto-register in DB system categories
    ensure_system_level(db, mapped_team)
    ensure_system_department(db, department)
            
    raw_leader_name = body.get("leader_name")
    leader_name = None
    if raw_leader_name:
        leader_name = format_display_name(raw_leader_name) or None
            
    leader_email = str(body.get("leader_email", "")).strip() or None

    # 3. Find if member already exists by email or display_name
    member = None
    if email:
        member = db.query(Member).filter(Member.email.ilike(email)).first()
    if not member:
        member = db.query(Member).filter(Member.display_name.ilike(display_name)).first()
        
    final_display_name = make_unique_display_name(db, display_name, member_id=member.id if member else None)
    is_new_member = member is None

    if member:
        # Update existing member
        member.full_name = full_name
        member.display_name = final_display_name
        if email:
            member.email = email
        if phone:
            member.phone = phone
        if telegram_username:
            member.telegram_username = telegram_username
        if mapped_team:
            member.team = mapped_team
        if department:
            member.department = department
        if position:
            member.position = position
        if birth_date:
            member.birth_date = birth_date
        if cv_link:
            member.cv_link = cv_link
        if leader_name:
            member.leader_name = leader_name
        if leader_email:
            member.leader_email = leader_email
    else:
        # Create new member
        member = Member(
            display_name=final_display_name,
            full_name=full_name,
            email=email or None,
            phone=phone or None,
            telegram_username=telegram_username or None,
            team=mapped_team or None,
            position=position or None,
            department=department or None,  # Set department to team name (e.g. Marketing, AI)
            birth_date=birth_date,
            cv_link=cv_link or None,
            leader_name=leader_name,
            leader_email=leader_email
        )
        db.add(member)
        
    try:
        db.commit()
        db.refresh(member)
        AuditService.record(
            db=db, user_id=None, module="Member", entity_type="Member",
            entity_id=member.id, action="CREATE" if is_new_member else "UPDATE",
            resource_name=member.display_name, source="API",
            description=f"{'Tạo' if is_new_member else 'Cập nhật'} thành viên '{member.display_name}' qua sync-candidate (recruitment token)"
        )
        db.commit()
        return {"status": "success", "member_id": member.id, "display_name": member.display_name}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi database: {str(e)}")


@router.post("/remove-candidate")
def remove_candidate(
    body: dict,
    x_sync_token: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    # Verify token
    expected_token = settings.INTERNAL_SYNC_TOKEN or "markee-kpi-sync-secret-key-2026"
    if not x_sync_token or x_sync_token != expected_token:
        raise HTTPException(status_code=401, detail="Unauthorized sync token")

    email = str(body.get("email", "")).strip().lower()
    full_name = str(body.get("full_name", "")).strip()

    if not email and not full_name:
        raise HTTPException(status_code=400, detail="Cần cung cấp email hoặc họ tên để xóa")

    # 1. Standardize Display Name from full_name to match if no email
    display_name = ""
    if full_name:
        words = [w for w in full_name.split() if w]
        if len(words) <= 2:
            display_name = " ".join(words)
        else:
            abbr = ".".join([w[0].upper() for w in words[:-2]])
            last_two = " ".join(words[-2:])
            display_name = f"{abbr} {last_two}"

    # 2. Find matching member
    member = None
    if email:
        member = db.query(Member).filter(Member.email.ilike(email)).first()
    if not member and display_name:
        member = db.query(Member).filter(Member.display_name.ilike(display_name)).first()

    if not member:
        return {"status": "not_found", "message": "Không tìm thấy thành viên để xóa"}

    try:
        m_id, m_name = member.id, member.display_name
        db.delete(member)
        db.commit()
        AuditService.record(
            db=db, user_id=None, module="Member", entity_type="Member",
            entity_id=m_id, action="DELETE", resource_name=m_name, source="API",
            description=f"Gỡ bỏ thành viên '{m_name}' qua remove-candidate (recruitment token)"
        )
        db.commit()
        return {"status": "success", "message": f"Đã gỡ bỏ thành viên {m_name}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi database khi gỡ bỏ: {str(e)}")


@router.post("/sync-from-recruitment")
def sync_from_recruitment(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    import requests
    import re
    import json
    
    SUPABASE_URL = "https://cv.db.markeeai.com"
    SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODc3Njc3ODIsImV4cCI6MjEwMzEyNzc4Mn0.sTHQs9H3tzdnk3y9oLhWZx_4CBWwYXd3RAPiZiG44wg"
    
    # Local TEAM_POSITIONS and get_primary_team removed to use global definitions
        
    def get_recruitment_meta(notes):
        raw = re.search(r"\[RECRUITMENT_META\]([\s\S]*?)\[/RECRUITMENT_META\]", notes or "")
        if not raw:
            return {}
        try:
            return json.loads(raw.group(1))
        except Exception:
            return {}

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    
    url = f"{SUPABASE_URL}/rest/v1/applications?status=eq.accepted"
    
    try:
        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Lỗi kết nối API tuyển dụng: {response.text}")
        candidates = response.json()
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Không thể kết nối đến hệ thống tuyển dụng: {str(err)}")

    # Fetch recruitment leaders
    leaders_url = f"{SUPABASE_URL}/rest/v1/recruitment_leaders"
    try:
        leaders_response = requests.get(leaders_url, headers=headers, timeout=15)
        leaders_list = leaders_response.json() if leaders_response.status_code == 200 else []
    except Exception:
        leaders_list = []
    
    leaders_map = {str(l.get("id")).strip().lower(): l for l in leaders_list if l.get("id")}
        
    success_count = 0
    deleted_count = 0
    try:
        # 1. Thu thập danh sách email và display name của ứng viên "đã nhận"
        accepted_emails = set()
        accepted_display_names = set()
        for app_data in candidates:
            email_val = str(app_data.get("email", "")).strip().lower()
            full_name_val = str(app_data.get("full_name", "")).strip()
            if email_val:
                accepted_emails.add(email_val)
            if full_name_val:
                words = [w for w in full_name_val.split() if w]
                if len(words) <= 2:
                    d_name = " ".join(words)
                else:
                    abbr = ".".join([w[0].upper() for w in words[:-2]])
                    last_two = " ".join(words[-2:])
                    d_name = f"{abbr} {last_two}"
                accepted_display_names.add(d_name.lower())

        # 2. Xóa các ứng viên đã đồng bộ (có cv_link) không còn trạng thái "đã nhận" (accepted) bên Marke
        synced_members = db.query(Member).filter(Member.cv_link.isnot(None), Member.cv_link != "").all()
        for m in synced_members:
            m_email = str(m.email or "").strip().lower()
            m_display = str(m.display_name or "").strip().lower()
            
            is_still_accepted = False
            if m_email and m_email in accepted_emails:
                is_still_accepted = True
            elif m_display and m_display in accepted_display_names:
                is_still_accepted = True
                
            if not is_still_accepted:
                db.delete(m)
                deleted_count += 1
        
        # 3. Đồng bộ/Cập nhật các ứng viên đã nhận hiện tại
        used_display_names = set()
        for app_data in candidates:
            full_name = str(app_data.get("full_name", "")).strip()[:255]
            email = str(app_data.get("email", "")).strip().lower()[:255]
            phone = str(app_data.get("phone", "")).strip()[:20]
            positions = app_data.get("career_journey", [])
            primary_team = get_primary_team(positions)[:100]
            position = (positions[0] if positions else "")[:100]
            cv_link = str(app_data.get("cv", "")).strip()[:255]
            
            birth_date_str = app_data.get("dob")
            birth_date = None
            if birth_date_str:
                try:
                    birth_date = datetime.date.fromisoformat(str(birth_date_str).strip()[:10])
                except ValueError:
                    pass
            
            meta = get_recruitment_meta(app_data.get("admin_notes", ""))
            level = meta.get("currentLevel", "lv1")
            telegram_username = str(meta.get("telegram", "")).strip()[:100]
            
            # Find leader details
            leader_data = meta.get("leader")
            leader_id = ""
            if isinstance(leader_data, dict):
                leader_id = str(leader_data.get("id") or "").strip().lower()
            elif isinstance(leader_data, str):
                leader_id = leader_data.strip().lower()
                
            leader_name = None
            leader_email = None
            
            if leader_id and leader_id in leaders_map:
                leader_info = leaders_map[leader_id]
                raw_leader_name = str(leader_info.get("name", "")).strip()
                leader_email = str(leader_info.get("email", "")).strip() or None
                if raw_leader_name:
                    leader_name = format_display_name(raw_leader_name) or None
            elif isinstance(leader_data, dict) and leader_data.get("name"):
                raw_leader_name = str(leader_data.get("name", "")).strip()
                leader_name = format_display_name(raw_leader_name) or None
                leader_email = str(leader_data.get("email", "")).strip() or None

            if not full_name:
                continue
                
            # Abbreviate Display Name
            words = [w for w in full_name.split() if w]
            if len(words) <= 2:
                display_name = " ".join(words)[:50]
            else:
                abbr = ".".join([w[0].upper() for w in words[:-2]])
                last_two = " ".join(words[-2:])
                display_name = f"{abbr} {last_two}"[:50]
                
            # Map Level and Department directly
            mapped_team = LEVEL_MAP.get(level.lower().strip(), level)[:100]
            department = primary_team[:100] if primary_team and primary_team != "all" else (position[:100] if position else None)
            
            # Auto-register categories
            ensure_system_level(db, mapped_team)
            ensure_system_department(db, department)
                    
            # Find and Upsert Member
            member = None
            if email:
                member = db.query(Member).filter(Member.email.ilike(email)).first()
            if not member:
                member = db.query(Member).filter(Member.display_name.ilike(display_name)).first()
                
            final_display_name = make_unique_display_name(db, display_name, member_id=member.id if member else None, used_in_batch=used_display_names)

            if member:
                member.full_name = full_name
                member.display_name = final_display_name
                if email:
                    member.email = email
                if phone:
                    member.phone = phone
                if telegram_username:
                    member.telegram_username = telegram_username
                if mapped_team:
                    member.team = mapped_team
                if department:
                    member.department = department
                if position:
                    member.position = position
                if birth_date:
                    member.birth_date = birth_date
                if cv_link:
                    member.cv_link = cv_link
                if leader_name:
                    member.leader_name = leader_name
                if leader_email:
                    member.leader_email = leader_email
            else:
                member = Member(
                    display_name=final_display_name,
                    full_name=full_name,
                    email=email or None,
                    phone=phone or None,
                    telegram_username=telegram_username or None,
                    team=mapped_team or None,
                    position=position or None,
                    department=department or None,
                    birth_date=birth_date,
                    cv_link=cv_link or None,
                    leader_name=leader_name,
                    leader_email=leader_email
                )
                db.add(member)
                
            success_count += 1
            
        db.commit()
        message = f"Đồng bộ thành công {success_count} ứng viên."
        if deleted_count > 0:
            message += f" Đã gỡ bỏ {deleted_count} ứng viên không còn ở trạng thái đã nhận."
        AuditService.record(
            db=db, user_id=getattr(current_user, "id", None), module="Member", entity_type="Member",
            entity_id=None, action="UPDATE",
            description=f"Đồng bộ hàng loạt từ hệ thống tuyển dụng: {success_count} ứng viên cập nhật/tạo mới, {deleted_count} bị gỡ bỏ"
        )
        db.commit()
        return {"status": "success", "count": success_count, "message": message}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi database trong quá trình đồng bộ: {str(e)}")
