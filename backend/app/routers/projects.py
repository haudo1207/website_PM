"""
Projects Router — Full CRUD for projects, project members, phases, chat groups (links).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.project import Project, Platform, ProjectLink, project_members
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from sqlalchemy import func as sql_func

router = APIRouter(tags=["projects"])


# ═══════════════════════════════════════════════════════════
# PROJECT CRUD
# ═══════════════════════════════════════════════════════════

def serialize_project(p, db):
    """Serialize a Project ORM object to dict with PM/Leader names, stats, and member list."""
    pm_name = None
    leader_name = None
    if p.pm_id:
        m = db.query(Member).filter(Member.id == p.pm_id).first()
        pm_name = m.display_name if m else None
    if p.technical_leader_id:
        m = db.query(Member).filter(Member.id == p.technical_leader_id).first()
        leader_name = m.display_name if m else None

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

    # Fetch project members
    members_query = (
        db.query(Member.display_name, Member.email)
        .join(project_members, Member.id == project_members.c.member_id)
        .filter(project_members.c.project_id == p.id)
        .all()
    )
    members_list = [{"name": m_name, "email": m_email} for m_name, m_email in members_query]

    return {
        "id": p.id,
        "name": p.name,
        "code": p.code,
        "customer_name": p.customer_name,
        "year": p.year,
        "pm_id": p.pm_id,
        "pm_name": pm_name,
        "technical_leader_id": p.technical_leader_id,
        "technical_leader_name": leader_name,
        "description": p.description,
        "status": p.status,
        "current_phase": p.current_phase,
        "phase_count": phase_count,
        "task_count": task_count,
        "completed_task_count": completed_task_count,
        "warning_task_count": warning_task_count,
        "members": members_list,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.id.desc()).all()
    return [serialize_project(p, db) for p in projects]


@router.post("/projects")
def create_project(body: dict, db: Session = Depends(get_db)):
    p = Project(
        name=body.get("name", "").strip(),
        code=body.get("project_code") or body.get("code"),
        customer_name=body.get("customer_name"),
        year=body.get("year"),
        pm_id=body.get("pm_id"),
        technical_leader_id=body.get("technical_leader_id"),
        description=body.get("description"),
        status=body.get("status", "Planning"),
        current_phase=body.get("current_phase") or "1. Tư vấn",
    )
    if not p.name:
        raise HTTPException(400, "Project name is required.")
    
    # Try parsing year if not explicitly provided
    if not p.year and p.code:
        import re
        match = re.search(r"(19\d{2}|20\d{2})", p.code)
        if match:
            p.year = int(match.group(1))

    db.add(p)
    db.flush()  # get p.id

    # 1. Auto-create default phases
    from ..models.setting import Setting
    import json

    default_phases = []
    setting_row = db.query(Setting).filter(Setting.key == "column_config").first()
    if setting_row:
        try:
            config_data = json.loads(setting_row.value)
            default_phases = config_data.get("tab_names", [])
        except Exception:
            pass



    for idx, pname in enumerate(default_phases):
        ph = Phase(
            project_id=p.id,
            name=pname,
            sort_order=idx,
            status="Waiting"
        )
        db.add(ph)

    # 2. Add initial links/channels
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

    # 3. Add PM & Leader as project members initially
    if p.pm_id:
        db.execute(project_members.insert().values(project_id=p.id, member_id=p.pm_id, role="PM"))
    if p.technical_leader_id:
        # Check if already added (avoid duplicate if PM is leader)
        if p.technical_leader_id != p.pm_id:
            db.execute(project_members.insert().values(project_id=p.id, member_id=p.technical_leader_id, role="Leader"))

    db.commit()
    db.refresh(p)
    return serialize_project(p, db)


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Project not found.")
    return serialize_project(p, db)


@router.patch("/projects/{pid}")
def update_project(pid: int, body: dict, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Project not found.")

    for field in ["name", "code", "customer_name", "year", "pm_id",
                  "technical_leader_id", "description", "status", "current_phase"]:
        if field in body:
            setattr(p, field, body[field])
    db.commit()
    db.refresh(p)
    return serialize_project(p, db)


@router.delete("/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db)):
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
        "description": link.description,
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
