"""
Projects Router — Full CRUD for projects, project members, phases, chat groups (links).
"""
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from ..models.project import Project, Platform, ProjectLink, project_members
from ..models.system_category import Customer
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from sqlalchemy import func as sql_func
from ..utils.access import (
    ALL_SCOPE,
    VALID_DATA_SCOPES,
    project_query_for_user,
    require_route_project_access,
    user_scope,
)
from ..utils.auth import get_current_user, require_super_admin

router = APIRouter(tags=["projects"], dependencies=[Depends(require_route_project_access)])


# ═══════════════════════════════════════════════════════════
# PROJECT CRUD
# ═══════════════════════════════════════════════════════════

def serialize_project(p, db):
    """Serialize a Project ORM object to dict with PM/Leader names, stats, and member list."""
    # Count phases
    phase_count = db.query(Phase).filter(Phase.project_id == p.id).count()

    # Count total tasks across all phases/groups
    task_count = (
        db.query(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .filter(Phase.project_id == p.id)
        .count()
    )

    # Count completed tasks
    completed_task_count = (
        db.query(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .filter(Phase.project_id == p.id, Task.status == "Done")
        .count()
    )

    # Count warning tasks (days_late > 0)
    warning_task_count = (
        db.query(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .filter(Phase.project_id == p.id, Task.days_late > 0)
        .count()
    )

    # Fetch PMs
    pms = db.query(Member).join(project_members, Member.id == project_members.c.member_id).filter(project_members.c.project_id == p.id, project_members.c.role == "PM").all()
    pm_ids = [m.id for m in pms]
    pm_names = ", ".join([m.display_name for m in pms])

    # Fetch Leaders
    leaders = db.query(Member).join(project_members, Member.id == project_members.c.member_id).filter(project_members.c.project_id == p.id, project_members.c.role == "Leader").all()
    leader_ids = [m.id for m in leaders]
    leader_names = ", ".join([m.display_name for m in leaders])

    # Fetch Members
    members = db.query(Member).join(project_members, Member.id == project_members.c.member_id).filter(project_members.c.project_id == p.id, project_members.c.role == "Member").all()
    member_ids = [m.id for m in members]
    member_names = ", ".join([m.display_name for m in members])

    # Combine all unique members for display
    all_members_query = (
        db.query(Member.display_name, Member.email)
        .join(project_members, Member.id == project_members.c.member_id)
        .filter(project_members.c.project_id == p.id)
        .all()
    )
    members_list = [{"name": m_name, "email": m_email} for m_name, m_email in all_members_query]

    return {
        "id": p.id,
        "name": p.name,
        "code": p.code,
        "project_code": str(p.year) if p.year else p.code,
        "customer_name": p.customer.name if p.customer else p.customer_name,
        "customer_id": p.customer_id,
        "business": p.business if p.business else ("Markee" if p.customer and p.customer.business_unit == 'markee' else "Infrastructure"),
        "business_unit": p.customer.business_unit if p.customer else "infrastructure",
        "year": p.year,
        "pm_id": p.pm_id,
        "pm_name": pm_names if pm_names else None,
        "pm_ids": pm_ids,
        "technical_leader_id": p.technical_leader_id,
        "technical_leader_name": leader_names if leader_names else None,
        "technical_leader_ids": leader_ids,
        "member_ids": member_ids,
        "member_names": member_names,
        "description": p.description,
        "status": p.status,
        "current_phase": p.current_phase,
        "data_scope": p.data_scope,
        "phase_count": phase_count,
        "task_count": task_count,
        "completed_task_count": completed_task_count,
        "warning_task_count": warning_task_count,
        "members": members_list,
        "ai_status": p.ai_status,
        "last_ai_check_at": str(p.last_ai_check_at) if p.last_ai_check_at else None,
        "last_ai_score": p.last_ai_score,
        "last_review_id": p.last_review_id,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


def serialize_project_summary(p, phase_count, task_stats, role_members, all_members):
    """Serialize a project using list-level data loaded in a few batch queries."""
    pms = role_members.get("PM", [])
    leaders = role_members.get("Leader", [])
    members = role_members.get("Member", [])
    task_count, completed_task_count, warning_task_count = task_stats

    return {
        "id": p.id,
        "name": p.name,
        "code": p.code,
        "project_code": str(p.year) if p.year else p.code,
        "customer_name": p.customer.name if p.customer else p.customer_name,
        "customer_id": p.customer_id,
        "business": p.business if p.business else ("Markee" if p.customer and p.customer.business_unit == 'markee' else "Infrastructure"),
        "business_unit": p.customer.business_unit if p.customer else "infrastructure",
        "year": p.year,
        "pm_id": p.pm_id,
        "pm_name": ", ".join(m[1] for m in pms) or None,
        "pm_ids": [m[0] for m in pms],
        "technical_leader_id": p.technical_leader_id,
        "technical_leader_name": ", ".join(m[1] for m in leaders) or None,
        "technical_leader_ids": [m[0] for m in leaders],
        "member_ids": [m[0] for m in members],
        "member_names": ", ".join(m[1] for m in members),
        "description": p.description,
        "status": p.status,
        "current_phase": p.current_phase,
        "data_scope": p.data_scope,
        "phase_count": phase_count,
        "task_count": task_count,
        "completed_task_count": completed_task_count,
        "warning_task_count": warning_task_count,
        "members": [{"name": name, "email": email} for _, name, email in all_members],
        "ai_status": p.ai_status,
        "last_ai_check_at": str(p.last_ai_check_at) if p.last_ai_check_at else None,
        "last_ai_score": p.last_ai_score,
        "last_review_id": p.last_review_id,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


@router.get("/projects")
def list_projects(business: Optional[str] = None, business_unit: Optional[str] = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = project_query_for_user(db, current_user).options(joinedload(Project.customer))
    target_b = (business or business_unit or "").strip().lower()
    if target_b and target_b != "all":
        b_val = "Markee" if target_b == "markee" else "Infrastructure"
        q = q.filter(Project.business.in_([b_val, "All"]))
    projects = q.order_by(Project.id.desc()).all()
    project_ids = [p.id for p in projects]
    if not project_ids:
        return []

    phase_counts = dict(
        db.query(Phase.project_id, sql_func.count(Phase.id))
        .filter(Phase.project_id.in_(project_ids))
        .group_by(Phase.project_id)
        .all()
    )

    task_stats = {
        project_id: (task_count, completed_count, warning_count)
        for project_id, task_count, completed_count, warning_count in (
            db.query(
                Phase.project_id,
                sql_func.count(Task.id),
                sql_func.sum(case((Task.status == "Done", 1), else_=0)),
                sql_func.sum(case((Task.days_late > 0, 1), else_=0)),
            )
            .select_from(Task)
            .join(TaskGroup, Task.task_group_id == TaskGroup.id)
            .join(Phase, TaskGroup.phase_id == Phase.id)
            .filter(Phase.project_id.in_(project_ids))
            .group_by(Phase.project_id)
            .all()
        )
    }

    role_members = defaultdict(lambda: defaultdict(list))
    all_members = defaultdict(list)
    member_rows = (
        db.query(
            project_members.c.project_id,
            project_members.c.role,
            Member.id,
            Member.display_name,
            Member.email,
        )
        .join(Member, Member.id == project_members.c.member_id)
        .filter(project_members.c.project_id.in_(project_ids))
        .order_by(project_members.c.id)
        .all()
    )
    for project_id, role, member_id, display_name, email in member_rows:
        member = (member_id, display_name, email)
        role_members[project_id][role].append(member)
        all_members[project_id].append(member)

    return [
        serialize_project_summary(
            p,
            phase_counts.get(p.id, 0),
            task_stats.get(p.id, (0, 0, 0)),
            role_members[p.id],
            all_members[p.id],
        )
        for p in projects
    ]


@router.post("/projects")
def create_project(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    biz_input = str(body.get("business") or body.get("business_unit") or "").strip().lower()
    if biz_input == "all":
        biz_val = "All"
    elif biz_input == "markee":
        biz_val = "Markee"
    else:
        biz_val = "Infrastructure"
    default_scope = biz_val.lower() if biz_input else user_scope(current_user)
    requested_scope = str(body.get("data_scope") or default_scope).strip().lower()
    if requested_scope not in VALID_DATA_SCOPES:
        raise HTTPException(400, "Invalid data scope.")
    if user_scope(current_user) != ALL_SCOPE:
        requested_scope = user_scope(current_user)
    project_code = body.get("project_code") or body.get("code")
    if project_code and db.query(Project.id).filter(Project.code == project_code).first():
        raise HTTPException(409, f"Project code '{project_code}' already exists.")

    cust_id = body.get("customer_id")
    cust_name = body.get("customer_name")
    if cust_id:
        from ..models.system_category import Customer as DB_Customer
        c_obj = db.query(DB_Customer).filter(DB_Customer.id == cust_id).first()
        if c_obj:
            cust_name = c_obj.name

    p = Project(
        name=body.get("name", "").strip(),
        code=project_code,
        customer_name=cust_name,
        customer_id=cust_id,
        year=body.get("year"),
        description=body.get("description"),
        status=body.get("status", "Planning"),
        business=biz_val,
        data_scope=requested_scope,
        current_phase=body.get("current_phase") or "1. Tư vấn",
    )
    if not p.name:
        raise HTTPException(400, "Project name is required.")

    # Convert/parse fields
    pm_ids = body.get("pm_ids", [])
    if body.get("pm_id") and not pm_ids:
        pm_ids = [body.get("pm_id")]
    
    technical_leader_ids = body.get("technical_leader_ids", [])
    if body.get("technical_leader_id") and not technical_leader_ids:
        technical_leader_ids = [body.get("technical_leader_id")]

    member_ids = body.get("member_ids", [])

    # Set single fallback values for backward compatibility
    if pm_ids:
        p.pm_id = pm_ids[0]
    if technical_leader_ids:
        p.technical_leader_id = technical_leader_ids[0]

    db.add(p)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"Project code '{project_code}' already exists.") from exc

    # 1. Populate initial project phases from MasterPhase settings
    from app.models.master_phase import MasterPhase
    master_phases = db.query(MasterPhase).filter(MasterPhase.is_active == True).order_by(MasterPhase.sort_order.asc()).all()
    if master_phases:
        for idx, mp in enumerate(master_phases):
            db.add(Phase(
                project_id=p.id,
                name=mp.name,
                sort_order=mp.sort_order or (idx + 1),
                status="Waiting"
            ))
    else:
        db.add(Phase(
            project_id=p.id,
            name="Master",
            sort_order=0,
            status="Waiting"
        ))

    # 2. Add initial links/channels (Legacy cleanup - only if they exist)
    links_to_create = []
    if body.get("zalo_link"):
        links_to_create.append(("Zalo Group", body["zalo_link"], "Zalo"))
    if body.get("telegram_link"):
        links_to_create.append(("Telegram Group", body["telegram_link"], "Telegram"))
    if body.get("teams_link"):
        links_to_create.append(("Teams Workspace", body["teams_link"], "Microsoft Teams"))

    for link_name, url, plat_name in links_to_create:
        plat = db.query(Platform).filter(Platform.name == plat_name).first()
        plat_id = plat.id if plat else None
        lnk = ProjectLink(
            project_id=p.id,
            platform_id=plat_id,
            name=link_name,
            url=url,
            sort_order=0
        )
        db.add(lnk)

    # 3. Add PM, Leader and Members to junction table
    inserted = set()
    for m_id in pm_ids:
        if m_id and (m_id, "PM") not in inserted:
            db.execute(project_members.insert().values(project_id=p.id, member_id=m_id, role="PM"))
            inserted.add((m_id, "PM"))
    for m_id in technical_leader_ids:
        if m_id and (m_id, "Leader") not in inserted:
            db.execute(project_members.insert().values(project_id=p.id, member_id=m_id, role="Leader"))
            inserted.add((m_id, "Leader"))
    for m_id in member_ids:
        if m_id and (m_id, "Member") not in inserted:
            db.execute(project_members.insert().values(project_id=p.id, member_id=m_id, role="Member"))
            inserted.add((m_id, "Member"))

    db.commit()
    db.refresh(p)
    return serialize_project(p, db)


@router.get("/projects/sidebar-tree")
def get_sidebar_tree(business: Optional[str] = None, business_unit: Optional[str] = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Returns projects grouped by year then customer for the sidebar tree hierarchy."""
    projects = project_query_for_user(db, current_user).all()

    years_map = defaultdict(lambda: {"total": 0, "customers": defaultdict(lambda: {"id": None, "name": "", "count": 0})})
    b_input = (business or business_unit or "").strip().lower()
    target_biz = "Markee" if b_input == "markee" else ("Infrastructure" if b_input else None)

    for p in projects:
        p_biz = p.business if p.business else ("Markee" if p.customer and p.customer.business_unit == 'markee' else "Infrastructure")
        if target_biz and p_biz != target_biz and p_biz != "All":
            continue

        yr = p.year or 2026
        c_id = p.customer_id
        c_name = p.customer.name if p.customer else (p.customer_name or "Khác")

        years_map[yr]["total"] += 1
        c_key = (c_id, c_name.lower().strip())
        years_map[yr]["customers"][c_key]["id"] = c_id
        years_map[yr]["customers"][c_key]["name"] = c_name.strip()
        years_map[yr]["customers"][c_key]["count"] += 1

    result = []
    for yr in sorted(years_map.keys(), reverse=True):
        cust_list = []
        for _, c_info in sorted(years_map[yr]["customers"].items(), key=lambda item: item[1]["name"]):
            cust_list.append({
                "id": c_info["id"],
                "name": c_info["name"],
                "project_count": c_info["count"]
            })
        result.append({
            "year": yr,
            "project_count": years_map[yr]["total"],
            "customers": cust_list
        })
    return result


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Project not found.")
    return serialize_project(p, db)


@router.patch("/projects/{pid}")
def update_project(pid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Project not found.")

    for field in ["name", "code", "customer_name", "customer_id", "year", "description", "status", "current_phase"]:
        if field in body:
            setattr(p, field, body[field])
    if "business" in body or "business_unit" in body:
        b_in = str(body.get("business") or body.get("business_unit") or "").strip().lower()
        if b_in == "all":
            p.business = "All"
        elif b_in == "markee":
            p.business = "Markee"
        else:
            p.business = "Infrastructure"
        if "data_scope" not in body and (user_scope(current_user) == ALL_SCOPE or getattr(current_user, "role", None) in {"admin", "super_admin"}):
            p.data_scope = b_in
    if "customer_id" in body and body["customer_id"]:
        from ..models.system_category import Customer as DB_Customer
        c_obj = db.query(DB_Customer).filter(DB_Customer.id == body["customer_id"]).first()
        if c_obj:
            p.customer_name = c_obj.name
    if "data_scope" in body:
        requested_scope = str(body["data_scope"]).strip().lower()
        if requested_scope not in VALID_DATA_SCOPES:
            raise HTTPException(400, "Invalid data scope.")
        if user_scope(current_user) != ALL_SCOPE:
            raise HTTPException(403, "Only full-scope users can change project scope.")
        p.data_scope = requested_scope

    # Synchronize project members
    sync_members = False
    pm_ids = body.get("pm_ids")
    if pm_ids is not None:
        sync_members = True
        if pm_ids:
            p.pm_id = pm_ids[0]
        else:
            p.pm_id = None
    else:
        if "pm_id" in body:
            sync_members = True
            p.pm_id = body["pm_id"]
            pm_ids = [body["pm_id"]] if body["pm_id"] else []

    tl_ids = body.get("technical_leader_ids")
    if tl_ids is not None:
        sync_members = True
        if tl_ids:
            p.technical_leader_id = tl_ids[0]
        else:
            p.technical_leader_id = None
    else:
        if "technical_leader_id" in body:
            sync_members = True
            p.technical_leader_id = body["technical_leader_id"]
            tl_ids = [body["technical_leader_id"]] if body["technical_leader_id"] else []

    member_ids = body.get("member_ids")
    if member_ids is not None:
        sync_members = True

    if sync_members:
        if pm_ids is None:
            pm_ids = [r[0] for r in db.query(project_members.c.member_id).filter(project_members.c.project_id == pid, project_members.c.role == "PM").all()]
        if tl_ids is None:
            tl_ids = [r[0] for r in db.query(project_members.c.member_id).filter(project_members.c.project_id == pid, project_members.c.role == "Leader").all()]
        if member_ids is None:
            member_ids = [r[0] for r in db.query(project_members.c.member_id).filter(project_members.c.project_id == pid, project_members.c.role == "Member").all()]

        # Delete existing entries
        db.execute(project_members.delete().where(project_members.c.project_id == pid))

        inserted = set()
        for m_id in pm_ids:
            if m_id and (m_id, "PM") not in inserted:
                db.execute(project_members.insert().values(project_id=pid, member_id=m_id, role="PM"))
                inserted.add((m_id, "PM"))
        for m_id in tl_ids:
            if m_id and (m_id, "Leader") not in inserted:
                db.execute(project_members.insert().values(project_id=pid, member_id=m_id, role="Leader"))
                inserted.add((m_id, "Leader"))
        for m_id in member_ids:
            if m_id and (m_id, "Member") not in inserted:
                db.execute(project_members.insert().values(project_id=pid, member_id=m_id, role="Member"))
                inserted.add((m_id, "Member"))

    db.commit()
    db.refresh(p)
    return serialize_project(p, db)


@router.delete("/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db), _=Depends(require_super_admin)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Project not found.")
    # RESTRICT: cannot delete if phases exist
    phase_count = db.query(Phase).filter(Phase.project_id == pid).count()
    if phase_count > 0:
        raise HTTPException(400, f"Không thể xóa dự án vì còn {phase_count} Phase. Hãy xóa tất cả Phase trước.")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# PROJECT MEMBERS
# ═══════════════════════════════════════════════════════════

@router.get("/projects/{pid}/members")
def list_project_members(pid: int, db: Session = Depends(get_db)):
    rows = (
        db.query(project_members.c.member_id, project_members.c.role, Member)
        .join(Member, Member.id == project_members.c.member_id)
        .filter(project_members.c.project_id == pid)
        .all()
    )
    return [
        {
            "id": r.Member.id,
            "display_name": r.Member.display_name,
            "full_name": r.Member.full_name,
            "team": r.Member.team,
            "role": r.role,
        }
        for r in rows
    ]


@router.post("/projects/{pid}/members")
def add_project_member(pid: int, body: dict, db: Session = Depends(get_db)):
    member_id = body.get("member_id")
    role = body.get("role", "Member")
    if not member_id:
        raise HTTPException(400, "member_id is required.")
    # Check existence
    exists = db.execute(
        project_members.select().where(
            project_members.c.project_id == pid,
            project_members.c.member_id == member_id
        )
    ).first()
    if exists:
        raise HTTPException(400, "Member already in project.")
    db.execute(project_members.insert().values(
        project_id=pid, member_id=member_id, role=role
    ))
    db.commit()
    return {"ok": True}


@router.delete("/projects/{pid}/members/{mid}")
def remove_project_member(pid: int, mid: int, db: Session = Depends(get_db)):
    db.execute(
        project_members.delete().where(
            project_members.c.project_id == pid,
            project_members.c.member_id == mid
        )
    )
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# PHASES
# ═══════════════════════════════════════════════════════════

def serialize_phase(ph, db):
    # Count task groups
    tg_count = db.query(TaskGroup).filter(TaskGroup.phase_id == ph.id).count()
    # Count total tasks
    task_count = (
        db.query(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .filter(TaskGroup.phase_id == ph.id)
        .count()
    )
    return {
        "id": ph.id,
        "project_id": ph.project_id,
        "name": ph.name,
        "description": ph.description,
        "sort_order": ph.sort_order,
        "status": ph.status,
        "task_group_count": tg_count,
        "task_count": task_count,
        "ai_status": ph.ai_status,
        "last_ai_check_at": str(ph.last_ai_check_at) if ph.last_ai_check_at else None,
        "last_ai_score": ph.last_ai_score,
        "last_review_id": ph.last_review_id,
        "created_at": str(ph.created_at) if ph.created_at else None,
    }


@router.get("/projects/{pid}/phases")
def list_phases(pid: int, db: Session = Depends(get_db)):
    phases = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order, Phase.id).all()
    return [serialize_phase(ph, db) for ph in phases]


@router.post("/projects/{pid}/phases")
def create_phase(pid: int, body: dict, db: Session = Depends(get_db)):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Phase name is required.")
    max_order = db.query(sql_func.max(Phase.sort_order)).filter(Phase.project_id == pid).scalar() or 0
    ph = Phase(
        project_id=pid,
        name=name,
        description=body.get("description"),
        sort_order=max_order + 1,
        status=body.get("status", "Waiting"),
    )
    db.add(ph)
    db.commit()
    db.refresh(ph)
    return serialize_phase(ph, db)


@router.patch("/projects/{pid}/phases/{phid}")
def update_phase(pid: int, phid: int, body: dict, db: Session = Depends(get_db)):
    ph = db.query(Phase).filter(Phase.id == phid, Phase.project_id == pid).first()
    if not ph:
        raise HTTPException(404, "Phase not found.")
    for field in ["name", "description", "sort_order", "status"]:
        if field in body:
            setattr(ph, field, body[field])
    db.commit()
    db.refresh(ph)
    return serialize_phase(ph, db)


@router.delete("/projects/{pid}/phases/{phid}")
def delete_phase(pid: int, phid: int, db: Session = Depends(get_db)):
    ph = db.query(Phase).filter(Phase.id == phid, Phase.project_id == pid).first()
    if not ph:
        raise HTTPException(404, "Phase not found.")
    tg_count = db.query(TaskGroup).filter(TaskGroup.phase_id == phid).count()
    if tg_count > 0:
        raise HTTPException(400, f"Không thể xóa Phase vì còn {tg_count} Task Group. Hãy xóa hết Task Group trước.")
    db.delete(ph)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# CHAT GROUPS (PROJECT LINKS)
# ═══════════════════════════════════════════════════════════

def serialize_link(link, db):
    platform_name = None
    platform_icon = None
    platform_color = None
    if link.platform_id:
        plat = db.query(Platform).filter(Platform.id == link.platform_id).first()
        if plat:
            platform_name = plat.name
            platform_icon = plat.icon
            platform_color = plat.color
    return {
        "id": link.id,
        "project_id": link.project_id,
        "platform_id": link.platform_id,
        "platform_name": platform_name,
        "platform_icon": platform_icon,
        "platform_color": platform_color,
        "name": link.name,
        "url": link.url,
        "link": link.url,
        "description": link.description,
        "desc": link.description,
        "sort_order": link.sort_order,
        "created_at": str(link.created_at) if link.created_at else None,
    }


@router.get("/projects/{pid}/chat-groups")
def list_chat_groups(pid: int, db: Session = Depends(get_db)):
    links = db.query(ProjectLink).filter(ProjectLink.project_id == pid).order_by(ProjectLink.sort_order, ProjectLink.id).all()
    return [serialize_link(l, db) for l in links]


@router.post("/projects/{pid}/chat-groups")
def create_chat_group(pid: int, body: dict, db: Session = Depends(get_db)):
    name = body.get("name", "").strip()
    url = body.get("link", body.get("url", "")).strip()
    platform_name = body.get("platform", "").strip()

    if not name:
        raise HTTPException(400, "Group name is required.")
    if not url:
        raise HTTPException(400, "Link is required.")

    # Find or create platform
    platform_id = None
    if platform_name:
        plat = db.query(Platform).filter(Platform.name == platform_name).first()
        if not plat:
            plat = Platform(name=platform_name, is_active=True)
            db.add(plat)
            db.flush()
        platform_id = plat.id

    max_order = db.query(sql_func.max(ProjectLink.sort_order)).filter(ProjectLink.project_id == pid).scalar() or 0
    link = ProjectLink(
        project_id=pid,
        platform_id=platform_id,
        name=name,
        url=url,
        description=body.get("desc", body.get("description")),
        sort_order=max_order + 1,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return serialize_link(link, db)


@router.patch("/projects/{pid}/chat-groups/{lid}")
def update_chat_group(pid: int, lid: int, body: dict, db: Session = Depends(get_db)):
    link = db.query(ProjectLink).filter(ProjectLink.id == lid, ProjectLink.project_id == pid).first()
    if not link:
        raise HTTPException(404, "Chat group not found.")
    for field in ["name", "url", "description", "sort_order"]:
        if field in body:
            setattr(link, field, body[field])
    if "platform" in body:
        pname = body["platform"].strip()
        if pname:
            plat = db.query(Platform).filter(Platform.name == pname).first()
            if not plat:
                plat = Platform(name=pname, is_active=True)
                db.add(plat)
                db.flush()
            link.platform_id = plat.id
    db.commit()
    db.refresh(link)
    return serialize_link(link, db)


@router.delete("/projects/{pid}/chat-groups/{lid}")
def delete_chat_group(pid: int, lid: int, db: Session = Depends(get_db)):
    link = db.query(ProjectLink).filter(ProjectLink.id == lid, ProjectLink.project_id == pid).first()
    if not link:
        raise HTTPException(404, "Chat group not found.")
    db.delete(link)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# PLATFORMS (for dropdown in chat group form)
# ═══════════════════════════════════════════════════════════

@router.get("/platforms")
def list_platforms(db: Session = Depends(get_db)):
    return [
        {"id": p.id, "name": p.name, "icon": p.icon, "color": p.color, "is_active": p.is_active}
        for p in db.query(Platform).order_by(Platform.id).all()
    ]


@router.post("/platforms")
def create_platform(body: dict, db: Session = Depends(get_db)):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Platform name is required.")
    existing = db.query(Platform).filter(Platform.name == name).first()
    if existing:
        raise HTTPException(400, "Platform already exists.")
    p = Platform(
        name=name,
        icon=body.get("icon"),
        color=body.get("color"),
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name, "icon": p.icon, "color": p.color, "is_active": p.is_active}
