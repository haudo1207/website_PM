"""
Projects Router — Full CRUD for projects, project members, phases, chat groups (links).
"""
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import case, or_, and_
from sqlalchemy.exc import IntegrityError, DataError
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from ..models.project import Project, Platform, ProjectLink, project_members
from ..models.system_category import Customer
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from ..models.audit_log import AuditLog
from ..utils.audit_service import AuditService
from sqlalchemy import func as sql_func
from ..utils.access import (
    ALL_SCOPE,
    business_label_for_project,
    business_unit_for_project,
    default_workspace,
    get_workspaces,
    is_valid_scope,
    resolve_workspace,
    valid_data_scopes,
    ROLE_SUPER_ADMIN,
    ROLE_LEADER,
    ROLE_MEMBER,
    can_access_project,
    project_query_for_user,
    require_project,
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
    pm_ids = [m.id for m in pms if m]
    pm_names = ", ".join([str(m.display_name or m.email or m.full_name or f"User #{m.id}") for m in pms if m])

    # Fetch Leaders
    leaders = db.query(Member).join(project_members, Member.id == project_members.c.member_id).filter(project_members.c.project_id == p.id, project_members.c.role == "Leader").all()
    leader_ids = [m.id for m in leaders if m]
    leader_names = ", ".join([str(m.display_name or m.email or m.full_name or f"User #{m.id}") for m in leaders if m])

    # Fetch Sales
    sales = db.query(Member).join(project_members, Member.id == project_members.c.member_id).filter(project_members.c.project_id == p.id, project_members.c.role == "Sales").all()
    sales_ids = [m.id for m in sales if m]
    sales_names = ", ".join([str(m.display_name or m.email or m.full_name or f"User #{m.id}") for m in sales if m])

    # Fetch Members
    members = db.query(Member).join(project_members, Member.id == project_members.c.member_id).filter(project_members.c.project_id == p.id, project_members.c.role == "Member").all()
    member_ids = [m.id for m in members if m]
    member_names = ", ".join([str(m.display_name or m.email or m.full_name or f"User #{m.id}") for m in members if m])

    # Combine all unique members for display
    all_members_query = (
        db.query(Member.display_name, Member.email)
        .join(project_members, Member.id == project_members.c.member_id)
        .filter(project_members.c.project_id == p.id)
        .all()
    )
    members_list = [{"name": str(m_name or m_email or "Member"), "email": str(m_email or "")} for m_name, m_email in all_members_query]

    return {
        "id": p.id,
        "name": p.name,
        "code": p.code,
        "project_code": str(p.year) if p.year else p.code,
        "customer_name": p.customer.name if p.customer else p.customer_name,
        "customer_id": p.customer_id,
        "business": business_label_for_project(db, p),
        "business_unit": business_unit_for_project(db, p),
        "year": p.year,
        "pm_id": p.pm_id,
        "pm_name": pm_names if pm_names else None,
        "pm_ids": pm_ids,
        "technical_leader_id": p.technical_leader_id,
        "technical_leader_name": leader_names if leader_names else None,
        "technical_leader_ids": leader_ids,
        "sales_id": p.sales_id,
        "sales_name": sales_names if sales_names else None,
        "sales_ids": sales_ids,
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


def serialize_project_summary(p, db, phase_count, task_stats, role_members, all_members):
    """Serialize a project using list-level data loaded in a few batch queries."""
    pms = role_members.get("PM", [])
    leaders = role_members.get("Leader", [])
    sales = role_members.get("Sales", [])
    members = role_members.get("Member", [])
    task_count, completed_task_count, warning_task_count = task_stats

    return {
        "id": p.id,
        "name": p.name,
        "code": p.code,
        "project_code": str(p.year) if p.year else p.code,
        "customer_name": p.customer.name if p.customer else p.customer_name,
        "customer_id": p.customer_id,
        "business": business_label_for_project(db, p),
        "business_unit": business_unit_for_project(db, p),
        "year": p.year,
        "pm_id": p.pm_id,
        "pm_name": ", ".join(m[1] for m in pms if m[1]) or None,
        "pm_ids": [m[0] for m in pms],
        "pm_users": [{"id": m[0], "name": m[1]} for m in pms if m[1]],
        "technical_leader_id": p.technical_leader_id,
        "technical_leader_name": ", ".join(m[1] for m in leaders if m[1]) or None,
        "technical_leader_ids": [m[0] for m in leaders],
        "leader_users": [{"id": m[0], "name": m[1]} for m in leaders if m[1]],
        "sales_id": p.sales_id,
        "sales_name": ", ".join(m[1] for m in sales if m[1]) or None,
        "sales_ids": [m[0] for m in sales],
        "sales_users": [{"id": m[0], "name": m[1]} for m in sales if m[1]],
        "member_ids": [m[0] for m in members],
        "member_names": ", ".join(m[1] for m in members if m[1]),
        "member_users": [{"id": m[0], "name": m[1]} for m in members if m[1]],
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
        "last_activity_at": str(p.last_activity_at) if getattr(p, "last_activity_at", None) else (str(p.updated_at) if p.updated_at else str(p.created_at) if p.created_at else None),
    }


@router.get("/projects")
def list_projects(
    business: Optional[str] = None,
    business_unit: Optional[str] = None,
    search: Optional[str] = None,
    customer: Optional[str] = None,
    year: Optional[int] = None,
    phase: Optional[str] = None,
    pm_ids: Optional[str] = None,
    sales_ids: Optional[str] = None,
    member_ids: Optional[str] = None,
    sort: Optional[str] = "activity_desc",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    q = project_query_for_user(db, current_user).options(joinedload(Project.customer))
    target_b = (business or business_unit or "").strip().lower()
    if target_b and target_b != "all":
        ws = resolve_workspace(db, target_b)
        if ws:
            b_val = ws.name
            q = q.filter(
                or_(
                    Project.business == b_val,
                    Project.business == "All",
                    and_(Project.business.is_(None), Project.data_scope == target_b),
                    and_(Project.business.is_(None), Project.customer.has(Customer.business_unit == target_b))
                )
            )
        else:
            q = q.filter(Project.id == -1)

    # Filter: pm_ids
    if pm_ids:
        p_id_list = [int(i.strip()) for i in pm_ids.split(",") if i.strip().isdigit()]
        if p_id_list:
            pm_subq = db.query(project_members.c.project_id).filter(
                project_members.c.role == "PM",
                project_members.c.member_id.in_(p_id_list)
            )
            q = q.filter(Project.id.in_(pm_subq))

    # Filter: sales_ids
    if sales_ids:
        s_id_list = [int(i.strip()) for i in sales_ids.split(",") if i.strip().isdigit()]
        if s_id_list:
            sales_subq = db.query(project_members.c.project_id).filter(
                project_members.c.role == "Sales",
                project_members.c.member_id.in_(s_id_list)
            )
            q = q.filter(Project.id.in_(sales_subq))

    # Filter: member_ids (Matches PM, Sales, Leader, or Member)
    if member_ids:
        m_id_list = [int(i.strip()) for i in member_ids.split(",") if i.strip().isdigit()]
        if m_id_list:
            member_subq = db.query(project_members.c.project_id).filter(
                project_members.c.member_id.in_(m_id_list)
            )
            q = q.filter(Project.id.in_(member_subq))

    # Filter: year
    if year:
        q = q.filter(Project.year == year)

    # Filter: search
    if search and search.strip():
        kw = f"%{search.strip()}%"
        q = q.filter(or_(Project.name.ilike(kw), Project.code.ilike(kw), Project.description.ilike(kw)))

    # Filter: customer
    if customer and customer.strip() and customer != "all":
        q = q.filter(Project.customer_name.ilike(f"%{customer.strip()}%"))

    # Sorting
    s_mode = (sort or "activity_desc").strip().lower()
    if s_mode == "created_desc":
        q = q.order_by(Project.created_at.desc().nulls_last(), Project.id.desc())
    elif s_mode == "name_asc":
        q = q.order_by(Project.name.asc(), Project.id.desc())
    elif s_mode == "name_desc":
        q = q.order_by(Project.name.desc(), Project.id.desc())
    else:  # activity_desc (DEFAULT)
        q = q.order_by(Project.last_activity_at.desc().nulls_last(), Project.id.desc())

    projects = q.all()
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
            db,
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
    scope_from_biz = None
    if not biz_input:
        d_ws = default_workspace(db)
        biz_val = d_ws.name if d_ws else "All"
    elif biz_input == "all":
        biz_val = "All"
        scope_from_biz = "all"
    else:
        ws = resolve_workspace(db, biz_input)
        if ws is None:
            raise HTTPException(400, f"Workspace '{biz_input}' không tồn tại.")
        biz_val = ws.name
        scope_from_biz = ws.code
    default_scope = scope_from_biz if biz_input else user_scope(current_user)
    requested_scope = str(body.get("data_scope") or default_scope).strip().lower()
    if not is_valid_scope(db, requested_scope):
        raise HTTPException(400, f"Invalid data scope. Must be one of: {sorted(valid_data_scopes(db))}")
    if biz_val == "All":
        requested_scope = "all"
    elif user_scope(current_user) != ALL_SCOPE:
        requested_scope = user_scope(current_user)
    project_code = body.get("project_code") or body.get("code")
    if project_code:
        project_code = str(project_code).strip()[:50]
    if project_code and db.query(Project.id).filter(Project.code == project_code).first():
        raise HTTPException(409, f"Project code '{project_code}' already exists.")

    cust_id = body.get("customer_id")
    cust_name = body.get("customer_name")
    if cust_id:
        from ..models.system_category import Customer as DB_Customer
        c_obj = db.query(DB_Customer).filter(DB_Customer.id == cust_id).first()
        if c_obj:
            cust_name = c_obj.name
            # If business == "All", ensure customer exists in every Workspace
            if biz_val == "All" and c_obj.name:
                curr_bu = (c_obj.business_unit or "").lower()
                other_ws = next((w for w in get_workspaces(db) if w.code != curr_bu), None)
                other_bu = other_ws.code if other_ws else None
                other_c = db.query(DB_Customer).filter(
                    DB_Customer.name.ilike(c_obj.name.strip()),
                    DB_Customer.business_unit == other_bu
                ).first()
                if other_bu and not other_c:
                    other_c = DB_Customer(
                        name=c_obj.name.strip(),
                        description=c_obj.description,
                        business_unit=other_bu
                    )
                    db.add(other_c)
                    db.flush()

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

    sales_ids = body.get("sales_ids", [])
    if body.get("sales_id") and not sales_ids:
        sales_ids = [body.get("sales_id")]

    member_ids = body.get("member_ids", [])

    # Set single fallback values for backward compatibility
    if pm_ids:
        p.pm_id = pm_ids[0]
    if technical_leader_ids:
        p.technical_leader_id = technical_leader_ids[0]
    if sales_ids:
        p.sales_id = sales_ids[0]

    db.add(p)
    try:
        db.flush()
    except (IntegrityError, DataError) as exc:
        db.rollback()
        raise HTTPException(409, f"Project code '{project_code}' already exists or is invalid.") from exc

    # 1. Create default "Master" phase for new project
    db.add(Phase(
        project_id=p.id,
        name="Master",
        sort_order=1,
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
    for m_id in sales_ids:
        if m_id and (m_id, "Sales") not in inserted:
            db.execute(project_members.insert().values(project_id=p.id, member_id=m_id, role="Sales"))
            inserted.add((m_id, "Sales"))
    for m_id in member_ids:
        if m_id and (m_id, "Member") not in inserted:
            db.execute(project_members.insert().values(project_id=p.id, member_id=m_id, role="Member"))
            inserted.add((m_id, "Member"))

    db.commit()
    db.refresh(p)
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Project",
        entity_type="Project",
        entity_id=p.id,
        action="CREATE",
        project_id=p.id,
        description=f"Khởi tạo dự án '{p.name}' (Mã: {p.code or 'N/A'}, BU: {p.business or business_label_for_project(db, p)})"
    )
    db.commit()
    return serialize_project(p, db)


@router.get("/projects/sidebar-tree")
def get_sidebar_tree(business: Optional[str] = None, business_unit: Optional[str] = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Returns projects grouped by year then customer for the sidebar tree hierarchy."""
    projects = project_query_for_user(db, current_user).all()

    years_map = defaultdict(lambda: {"total": 0, "customers": defaultdict(lambda: {"id": None, "name": "", "count": 0})})
    b_input = (business or business_unit or "").strip().lower()
    ws = resolve_workspace(db, b_input) if b_input else None
    target_biz = ws.name if ws else None

    for p in projects:
        p_biz = business_label_for_project(db, p)
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

    old_dict = {
        "name": p.name,
        "business": p.business,
        "customer_name": p.customer_name,
        "year": p.year,
        "status": p.status,
        "current_phase": p.current_phase,
        "description": p.description,
    }

    for field in ["name", "code", "customer_name", "description", "status", "current_phase"]:
        if field in body:
            val = body[field]
            if field == "code" and val:
                setattr(p, "code", str(val).strip()[:50])
            else:
                setattr(p, field, str(val).strip() if val is not None else None)

    if "year" in body:
        y_val = body["year"]
        if y_val is None or y_val == "" or y_val == 0:
            p.year = None
        else:
            try:
                p.year = int(y_val)
            except (ValueError, TypeError):
                p.year = None

    if "customer_id" in body:
        c_val = body["customer_id"]
        if c_val is None or c_val == "" or c_val == 0:
            p.customer_id = None
        else:
            try:
                p.customer_id = int(c_val)
            except (ValueError, TypeError):
                p.customer_id = None

    if "business" in body or "business_unit" in body:
        b_in = str(body.get("business") or body.get("business_unit") or "").strip().lower()
        ws = None
        if b_in == "all":
            p.business = "All"
        else:
            ws = resolve_workspace(db, b_in)
            if b_in and ws is None:
                raise HTTPException(400, f"Workspace '{b_in}' không tồn tại.")
            if ws:
                p.business = ws.name
        if "data_scope" not in body and (user_scope(current_user) == ALL_SCOPE or getattr(current_user, "role", None) in {"admin", "super_admin"}):
            p.data_scope = "all" if b_in == "all" else (ws.code if ws else p.data_scope)
    if p.customer_id:
        from ..models.system_category import Customer as DB_Customer
        c_obj = db.query(DB_Customer).filter(DB_Customer.id == p.customer_id).first()
        if c_obj:
            p.customer_name = c_obj.name

    # If project business is "All", ensure customer is synced across both Business Units
    if p.business == "All" and p.customer_name and str(p.customer_name).strip():
        from ..models.system_category import Customer as DB_Customer
        c_name = str(p.customer_name).strip()
        c_obj = db.query(DB_Customer).filter(DB_Customer.name.ilike(c_name)).first()
        if c_obj:
            curr_bu = (c_obj.business_unit or "").lower()
            other_ws = next((w for w in get_workspaces(db) if w.code != curr_bu), None)
            other_bu = other_ws.code if other_ws else None
            other_c = db.query(DB_Customer).filter(
                DB_Customer.name.ilike(c_name),
                DB_Customer.business_unit == other_bu
            ).first()
            if other_bu and not other_c:
                other_c = DB_Customer(
                    name=c_name,
                    description=c_obj.description,
                    business_unit=other_bu
                )
                db.add(other_c)
                db.flush()
    if "data_scope" in body:
        requested_scope = str(body["data_scope"]).strip().lower()
        if not is_valid_scope(db, requested_scope):
            raise HTTPException(400, f"Invalid data scope. Must be one of: {sorted(valid_data_scopes(db))}")
        if requested_scope != p.data_scope and user_scope(current_user) != ALL_SCOPE and getattr(current_user, "role", None) not in {"super_admin", "admin", "leader"}:
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

    sales_ids = body.get("sales_ids")
    if sales_ids is not None:
        sync_members = True
        if sales_ids:
            p.sales_id = sales_ids[0]
        else:
            p.sales_id = None
    else:
        if "sales_id" in body:
            sync_members = True
            p.sales_id = body["sales_id"]
            sales_ids = [body["sales_id"]] if body["sales_id"] else []

    member_ids = body.get("member_ids")
    if member_ids is not None:
        sync_members = True

    if sync_members:
        if pm_ids is None:
            pm_ids = [r[0] for r in db.query(project_members.c.member_id).filter(project_members.c.project_id == pid, project_members.c.role == "PM").all()]
        if tl_ids is None:
            tl_ids = [r[0] for r in db.query(project_members.c.member_id).filter(project_members.c.project_id == pid, project_members.c.role == "Leader").all()]
        if sales_ids is None:
            sales_ids = [r[0] for r in db.query(project_members.c.member_id).filter(project_members.c.project_id == pid, project_members.c.role == "Sales").all()]
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
        for m_id in sales_ids:
            if m_id and (m_id, "Sales") not in inserted:
                db.execute(project_members.insert().values(project_id=pid, member_id=m_id, role="Sales"))
                inserted.add((m_id, "Sales"))
        for m_id in member_ids:
            if m_id and (m_id, "Member") not in inserted:
                db.execute(project_members.insert().values(project_id=pid, member_id=m_id, role="Member"))
                inserted.add((m_id, "Member"))

    db.commit()
    db.refresh(p)

    try:
        new_dict = {
            "name": p.name,
            "business": p.business,
            "customer_name": p.customer_name,
            "year": p.year,
            "status": p.status,
            "current_phase": p.current_phase,
            "description": p.description,
        }
        field_labels = {
            "name": "Tên dự án",
            "business": "Workspace",
            "customer_name": "Khách hàng",
            "year": "Năm dự án",
            "status": "Trạng thái",
            "current_phase": "Giai đoạn hiện tại",
            "description": "Mô tả dự án",
        }
        AuditService.record_diff(
            db=db,
            user_id=getattr(current_user, "id", None),
            module="Project",
            entity_type="Project",
            entity_id=p.id,
            old_dict=old_dict,
            new_dict=new_dict,
            project_id=p.id,
            field_labels=field_labels,
        )
        db.commit()
    except Exception as audit_err:
        print(f"[update_project] Warning: Audit log failed, continuing: {audit_err}")

    return serialize_project(p, db)


@router.delete("/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Project not found.")

    role = getattr(current_user, "role", ROLE_MEMBER)
    scope = user_scope(current_user)
    is_super = (role in [ROLE_SUPER_ADMIN, "admin"] or scope == ALL_SCOPE)
    is_proj_leader = (role == ROLE_LEADER and can_access_project(db, current_user, p))

    if not (is_super or is_proj_leader):
        raise HTTPException(403, "Bạn không có quyền xóa dự án này.")

    # Cascade delete all child tasks, task groups, phases, links, and project members
    phases = db.query(Phase).filter(Phase.project_id == pid).all()
    phase_ids = [ph.id for ph in phases]
    if phase_ids:
        task_groups = db.query(TaskGroup).filter(TaskGroup.phase_id.in_(phase_ids)).all()
        tg_ids = [tg.id for tg in task_groups]
        if tg_ids:
            db.query(Task).filter(Task.task_group_id.in_(tg_ids)).delete(synchronize_session=False)
            db.query(TaskGroup).filter(TaskGroup.id.in_(tg_ids)).delete(synchronize_session=False)
        db.query(Phase).filter(Phase.id.in_(phase_ids)).delete(synchronize_session=False)

    db.query(ProjectLink).filter(ProjectLink.project_id == pid).delete(synchronize_session=False)
    db.execute(project_members.delete().where(project_members.c.project_id == pid))

    # Additional cascade cleanup for associated entities
    try:
        from ..models.meeting import Meeting
        from ..models.ai_task_inbox import AITaskInbox
        from ..models.ai_review import AIPrompt, AIReviewLog
        db.query(Meeting).filter(Meeting.project_id == pid).delete(synchronize_session=False)
        db.query(AITaskInbox).filter(AITaskInbox.project_id == pid).delete(synchronize_session=False)
        db.query(AIPrompt).filter(AIPrompt.project_id == pid).delete(synchronize_session=False)
        db.query(AIReviewLog).filter(AIReviewLog.project_id == pid).delete(synchronize_session=False)
    except Exception as err:
        print("Cascade clean warning:", err)

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
    tg_count = 0
    task_count = 0
    try:
        tg_count = db.query(TaskGroup).filter(TaskGroup.phase_id == ph.id).count()
    except Exception:
        pass

    try:
        task_count = (
            db.query(Task)
            .join(TaskGroup, Task.task_group_id == TaskGroup.id)
            .filter(TaskGroup.phase_id == ph.id)
            .count()
        )
    except Exception:
        pass

    return {
        "id": ph.id,
        "project_id": ph.project_id,
        "name": ph.name,
        "description": ph.description,
        "sort_order": getattr(ph, "sort_order", 0) or 0,
        "status": getattr(ph, "status", "Waiting") or "Waiting",
        "task_group_count": tg_count,
        "task_count": task_count,
        "ai_status": getattr(ph, "ai_status", "NOT_CHECKED") or "NOT_CHECKED",
        "last_ai_check_at": str(ph.last_ai_check_at) if getattr(ph, "last_ai_check_at", None) else None,
        "last_ai_score": getattr(ph, "last_ai_score", None),
        "last_review_id": getattr(ph, "last_review_id", None),
        "created_at": str(ph.created_at) if getattr(ph, "created_at", None) else None,
    }


@router.get("/projects/{pid}/phases")
def list_phases(pid: int, db: Session = Depends(get_db)):
    try:
        phases = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order, Phase.id).all()
        return [serialize_phase(ph, db) for ph in phases]
    except Exception as exc:
        print(f"Error in list_phases for pid {pid}: {exc}")
        return []


@router.post("/projects/{pid}/phases")
def create_phase(pid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
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
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"Phase with name '{name}' already exists in this project, or another integrity constraint was violated.") from exc
    db.refresh(ph)
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Phase",
        entity_type="Phase",
        entity_id=ph.id,
        action="CREATE",
        project_id=pid,
        description=f"Đã thêm Phase '{ph.name}'"
    )
    db.commit()
    return {
        "id": ph.id,
        "project_id": ph.project_id,
        "name": ph.name,
        "description": ph.description,
        "sort_order": ph.sort_order,
        "status": ph.status,
        "task_group_count": 0,
        "task_count": 0,
        "ai_status": ph.ai_status,
        "last_ai_check_at": str(ph.last_ai_check_at) if ph.last_ai_check_at else None,
        "last_ai_score": ph.last_ai_score,
        "last_review_id": ph.last_review_id,
        "created_at": str(ph.created_at) if ph.created_at else None,
    }


@router.patch("/projects/{pid}/phases/{phid}")
def update_phase(pid: int, phid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    ph = db.query(Phase).filter(Phase.id == phid, Phase.project_id == pid).first()
    if not ph:
        raise HTTPException(404, "Phase not found.")
    old_name = ph.name
    old_status = ph.status
    for field in ["name", "description", "sort_order", "status"]:
        if field in body:
            setattr(ph, field, body[field])
    db.commit()
    db.refresh(ph)
    AuditService.record_diff(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Phase",
        entity_type="Phase",
        entity_id=ph.id,
        old_dict={"name": old_name, "status": old_status},
        new_dict={"name": ph.name, "status": ph.status},
        project_id=pid,
        field_labels={"name": "Tên Phase", "status": "Trạng thái Phase"}
    )
    db.commit()
    return serialize_phase(ph, db)


@router.delete("/projects/{pid}/phases/{phid}")
def delete_phase(pid: int, phid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    ph = db.query(Phase).filter(Phase.id == phid, Phase.project_id == pid).first()
    if not ph:
        raise HTTPException(404, "Phase not found.")
    tg_count = db.query(TaskGroup).filter(TaskGroup.phase_id == phid).count()
    if tg_count > 0:
        raise HTTPException(400, f"Không thể xóa Phase vì còn {tg_count} Task Group. Hãy xóa hết Task Group trước.")
    phase_name = ph.name
    db.delete(ph)
    db.commit()
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Phase",
        entity_type="Phase",
        entity_id=phid,
        action="DELETE",
        project_id=pid,
        description=f"Đã xóa Phase '{phase_name}'"
    )
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


# ═══════════════════════════════════════════════════════════
# AUDIT LOGS
# ═══════════════════════════════════════════════════════════

@router.get("/projects/{pid}/audit-logs")
def list_project_audit_logs(
    pid: int,
    module: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    require_project(db, current_user, pid)
    q = db.query(AuditLog).filter(AuditLog.project_id == pid)

    if module and module.strip().lower() != "all":
        q = q.filter(AuditLog.module.ilike(module.strip()))
    if action and action.strip().lower() != "all":
        q = q.filter(AuditLog.action.ilike(action.strip()))
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            or_(
                AuditLog.description.ilike(s),
                AuditLog.field_name.ilike(s),
                AuditLog.entity_type.ilike(s),
                AuditLog.old_value.ilike(s),
                AuditLog.new_value.ilike(s)
            )
        )
    if start_date:
        q = q.filter(AuditLog.created_at >= start_date)
    if end_date:
        q = q.filter(AuditLog.created_at <= end_date + " 23:59:59")

    total = q.count()
    logs = q.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
        "items": [log.to_dict() for log in logs]
    }


@router.get("/projects/{pid}/audit-logs/export")
def export_project_audit_logs(
    pid: int,
    module: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    import csv
    import io
    require_project(db, current_user, pid)
    q = db.query(AuditLog).filter(AuditLog.project_id == pid)

    if module and module.strip().lower() != "all":
        q = q.filter(AuditLog.module.ilike(module.strip()))
    if action and action.strip().lower() != "all":
        q = q.filter(AuditLog.action.ilike(action.strip()))
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            or_(
                AuditLog.description.ilike(s),
                AuditLog.field_name.ilike(s)
            )
        )

    logs = q.order_by(AuditLog.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Event ID", "Thời gian", "Người thực hiện", "Module", "Hành động", "Trường thay đổi", "Giá trị cũ", "Giá trị mới", "Mô tả"])

    for log in logs:
        user_name = log.user.full_name or log.user.display_name or log.user.email if log.user else "System"
        created_str = log.created_at.strftime("%d/%m/%Y %H:%M:%S") if log.created_at else ""
        writer.writerow([
            log.id,
            log.event_id or f"single-{log.id}",
            created_str,
            user_name,
            log.module,
            log.action,
            log.field_name or "",
            log.old_value or "",
            log.new_value or "",
            log.description or ""
        ])

    csv_data = "\ufeff" + output.getvalue()  # Add UTF-8 BOM for Excel
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=audit_logs_project_{pid}.csv"}
    )
