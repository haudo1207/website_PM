from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json
import re

from sqlalchemy import func as sql_func, or_ as sql_or
from ..database import get_db
from ..models.system_category import Position, Department, TaskPriority, TaskStatus, Team, Customer, Workspace
from ..models.master_phase import MasterPhase
from ..models.user import User
from ..models.task import Task
from ..models.workspace_access import UserWorkspaceAccess
from ..utils.auth import require_admin, get_current_user
from ..utils.audit_service import AuditService
from ..utils.access import (
    default_scope,
    is_valid_scope,
    user_scope,
    user_allowed_scopes,
    resolve_workspace,
    customer_query_for_user,
    ALL_SCOPE,
    ROLE_SUPER_ADMIN,
    WORKSPACE_SCOPED_ROLES,
)

router = APIRouter()

# ----------------- POSITIONS -----------------
@router.get("/positions")
def list_positions(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Position).order_by(Position.name.asc()).all()

@router.post("/positions")
def create_position(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên chức vụ không được để trống")

    desc = str(body.get("description", "")).strip()

    existing = db.query(Position).filter(Position.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Chức vụ '{name}' đã tồn tại")

    pos = Position(name=name, description=desc or None)
    db.add(pos)
    db.commit()
    db.refresh(pos)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Position", entity_type="Position",
        entity_id=pos.id, action="CREATE", resource_name=pos.name,
        description=f"Tạo chức vụ '{pos.name}'"
    )
    db.commit()
    return pos

@router.put("/positions/{id}")
def update_position(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    pos = db.query(Position).filter(Position.id == id).first()
    if not pos:
        raise HTTPException(404, "Không tìm thấy chức vụ")

    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên chức vụ không được để trống")

    desc = str(body.get("description", "")).strip()

    existing = db.query(Position).filter(Position.name.ilike(name), Position.id != id).first()
    if existing:
        raise HTTPException(400, f"Chức vụ '{name}' đã tồn tại")

    old_dict = {"name": pos.name, "description": pos.description}
    old_name = pos.name
    pos.name = name
    pos.description = desc or None

    # Cascade name update to existing users
    if old_name.lower() != name.lower():
        db.query(User).filter(User.position == old_name).update({User.position: name})

    db.commit()
    db.refresh(pos)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Position", entity_type="Position",
        entity_id=pos.id, old_dict=old_dict, new_dict={"name": pos.name, "description": pos.description},
        field_labels={"name": "Tên chức vụ", "description": "Mô tả"}
    )
    db.commit()
    return pos

@router.delete("/positions/{id}")
def delete_position(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    pos = db.query(Position).filter(Position.id == id).first()
    if not pos:
        raise HTTPException(404, "Không tìm thấy chức vụ")

    # Check if used by any user
    user_using = db.query(User).filter(User.position == pos.name).first()
    if user_using:
        raise HTTPException(400, f"Không thể xóa chức vụ '{pos.name}' vì đang được sử dụng bởi thành viên khác")

    pos_name = pos.name
    db.delete(pos)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Position", entity_type="Position",
        entity_id=id, action="DELETE", resource_name=pos_name,
        description=f"Xóa chức vụ '{pos_name}'"
    )
    db.commit()
    return {"message": "Đã xóa chức vụ thành công"}


# ----------------- DEPARTMENTS -----------------
@router.get("/departments")
def list_departments(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Department).order_by(Department.name.asc()).all()

@router.post("/departments")
def create_department(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên phòng ban không được để trống")

    desc = str(body.get("description", "")).strip()

    existing = db.query(Department).filter(Department.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Phòng ban '{name}' đã tồn tại")

    dept = Department(name=name, description=desc or None)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Department", entity_type="Department",
        entity_id=dept.id, action="CREATE", resource_name=dept.name,
        description=f"Tạo phòng ban '{dept.name}'"
    )
    db.commit()
    return dept

@router.put("/departments/{id}")
def update_department(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    dept = db.query(Department).filter(Department.id == id).first()
    if not dept:
        raise HTTPException(404, "Không tìm thấy phòng ban")

    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên phòng ban không được để trống")

    desc = str(body.get("description", "")).strip()

    existing = db.query(Department).filter(Department.name.ilike(name), Department.id != id).first()
    if existing:
        raise HTTPException(400, f"Phòng ban '{name}' đã tồn tại")

    old_dict = {"name": dept.name, "description": dept.description}
    old_name = dept.name
    dept.name = name
    dept.description = desc or None

    # Cascade name update to existing users
    if old_name.lower() != name.lower():
        db.query(User).filter(User.department == old_name).update({User.department: name})

    db.commit()
    db.refresh(dept)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Department", entity_type="Department",
        entity_id=dept.id, old_dict=old_dict, new_dict={"name": dept.name, "description": dept.description},
        field_labels={"name": "Tên phòng ban", "description": "Mô tả"}
    )
    db.commit()
    return dept

@router.delete("/departments/{id}")
def delete_department(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    dept = db.query(Department).filter(Department.id == id).first()
    if not dept:
        raise HTTPException(404, "Không tìm thấy phòng ban")

    # Check if used by any user
    user_using = db.query(User).filter(User.department == dept.name).first()
    if user_using:
        raise HTTPException(400, f"Không thể xóa phòng ban '{dept.name}' vì đang được sử dụng bởi thành viên khác")

    dept_name = dept.name
    db.delete(dept)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Department", entity_type="Department",
        entity_id=id, action="DELETE", resource_name=dept_name,
        description=f"Xóa phòng ban '{dept_name}'"
    )
    db.commit()
    return {"message": "Đã xóa phòng ban thành công"}


# ----------------- PRIORITIES -----------------
@router.get("/priorities")
def list_priorities(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TaskPriority).order_by(TaskPriority.kpi_base.asc()).all()

@router.post("/priorities")
def create_priority(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên mức độ ưu tiên không được để trống")

    try:
        kpi = int(body.get("kpi_base", 6))
    except (ValueError, TypeError):
        raise HTTPException(400, "KPI Base phải là số nguyên")

    if kpi <= 0:
        raise HTTPException(400, "KPI Base phải lớn hơn 0")

    color = str(body.get("color", "")).strip()
    if not color:
        raise HTTPException(400, "Màu sắc hiển thị không được để trống")

    existing = db.query(TaskPriority).filter(TaskPriority.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Mức độ ưu tiên '{name}' đã tồn tại")

    prio = TaskPriority(name=name, kpi_base=kpi, color=color)
    db.add(prio)
    db.commit()
    db.refresh(prio)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Priority", entity_type="TaskPriority",
        entity_id=prio.id, action="CREATE", resource_name=prio.name,
        description=f"Tạo mức độ ưu tiên '{prio.name}' (KPI Base={prio.kpi_base})"
    )
    db.commit()
    return prio

@router.put("/priorities/{id}")
def update_priority(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    prio = db.query(TaskPriority).filter(TaskPriority.id == id).first()
    if not prio:
        raise HTTPException(404, "Không tìm thấy mức độ ưu tiên")

    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên mức độ ưu tiên không được để trống")

    try:
        kpi = int(body.get("kpi_base", prio.kpi_base))
    except (ValueError, TypeError):
        raise HTTPException(400, "KPI Base phải là số nguyên")

    if kpi <= 0:
        raise HTTPException(400, "KPI Base phải lớn hơn 0")

    color = str(body.get("color", prio.color)).strip()
    if not color:
        raise HTTPException(400, "Màu sắc hiển thị không được để trống")

    existing = db.query(TaskPriority).filter(TaskPriority.name.ilike(name), TaskPriority.id != id).first()
    if existing:
        raise HTTPException(400, f"Mức độ ưu tiên '{name}' đã tồn tại")

    old_dict = {"name": prio.name, "kpi_base": prio.kpi_base, "color": prio.color}
    old_name = prio.name
    prio.name = name
    prio.kpi_base = kpi
    prio.color = color

    # Cascade name updates inside task priority column
    if old_name.lower() != name.lower():
        db.query(Task).filter(Task.priority.ilike(old_name)).update({Task.priority: name}, synchronize_session=False)

    db.commit()
    db.refresh(prio)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Priority", entity_type="TaskPriority",
        entity_id=prio.id, old_dict=old_dict,
        new_dict={"name": prio.name, "kpi_base": prio.kpi_base, "color": prio.color},
        field_labels={"name": "Tên", "kpi_base": "KPI Base", "color": "Màu sắc"}
    )
    db.commit()
    return prio

@router.delete("/priorities/{id}")
def delete_priority(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    prio = db.query(TaskPriority).filter(TaskPriority.id == id).first()
    if not prio:
        raise HTTPException(404, "Không tìm thấy mức độ ưu tiên")

    # Check if used by any task
    in_use = db.query(Task).filter(Task.priority.ilike(prio.name)).first() is not None

    if in_use:
        raise HTTPException(400, f"Không thể xóa mức độ ưu tiên '{prio.name}' vì đang được sử dụng bởi một hoặc nhiều task")

    prio_name = prio.name
    db.delete(prio)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Priority", entity_type="TaskPriority",
        entity_id=id, action="DELETE", resource_name=prio_name,
        description=f"Xóa mức độ ưu tiên '{prio_name}'"
    )
    db.commit()
    return {"message": "Đã xóa mức độ ưu tiên thành công"}


# ----------------- STATUSES -----------------
@router.get("/statuses")
def list_statuses(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TaskStatus).order_by(TaskStatus.name.asc()).all()

@router.post("/statuses")
def create_status(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên trạng thái không được để trống")

    existing = db.query(TaskStatus).filter(TaskStatus.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Trạng thái '{name}' đã tồn tại")

    st = TaskStatus(name=name)
    db.add(st)
    db.commit()
    db.refresh(st)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Status", entity_type="TaskStatus",
        entity_id=st.id, action="CREATE", resource_name=st.name,
        description=f"Tạo trạng thái '{st.name}'"
    )
    db.commit()
    return st

@router.put("/statuses/{id}")
def update_status(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    st = db.query(TaskStatus).filter(TaskStatus.id == id).first()
    if not st:
        raise HTTPException(404, "Không tìm thấy trạng thái")

    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên trạng thái không được để trống")

    existing = db.query(TaskStatus).filter(TaskStatus.name.ilike(name), TaskStatus.id != id).first()
    if existing:
        raise HTTPException(400, f"Trạng thái '{name}' đã tồn tại")

    old_name = st.name
    st.name = name

    # Cascade name updates inside task status column
    if old_name.lower() != name.lower():
        db.query(Task).filter(Task.status.ilike(old_name)).update({Task.status: name}, synchronize_session=False)

    db.commit()
    db.refresh(st)
    if old_name != st.name:
        AuditService.record(
            db=db, user_id=getattr(current_user, "id", None), module="Status", entity_type="TaskStatus",
            entity_id=st.id, action="UPDATE", resource_name=st.name, field_name="name",
            old_value=old_name, new_value=st.name,
            description=f"Đổi tên trạng thái '{old_name}' → '{st.name}'"
        )
        db.commit()
    return st

@router.delete("/statuses/{id}")
def delete_status(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    st = db.query(TaskStatus).filter(TaskStatus.id == id).first()
    if not st:
        raise HTTPException(404, "Không tìm thấy trạng thái")

    # Check if used by any task
    in_use = db.query(Task).filter(Task.status.ilike(st.name)).first() is not None

    if in_use:
        raise HTTPException(400, f"Không thể xóa trạng thái '{st.name}' vì đang được sử dụng bởi một hoặc nhiều task")

    st_name = st.name
    db.delete(st)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Status", entity_type="TaskStatus",
        entity_id=id, action="DELETE", resource_name=st_name,
        description=f"Xóa trạng thái '{st_name}'"
    )
    db.commit()
    return {"message": "Đã xóa trạng thái thành công"}


# ----------------- TEAMS -----------------
@router.get("/teams")
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Team).order_by(Team.name.asc()).all()

@router.post("/teams")
def create_team(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên team không được để trống")
    if db.query(Team).filter(Team.name.ilike(name)).first():
        raise HTTPException(400, f"Team '{name}' đã tồn tại")
    t = Team(name=name, description=body.get("description") or None)
    db.add(t)
    db.commit()
    db.refresh(t)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Team", entity_type="Team",
        entity_id=t.id, action="CREATE", resource_name=t.name,
        description=f"Tạo team '{t.name}'"
    )
    db.commit()
    return t

@router.put("/teams/{id}")
def update_team(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    t = db.query(Team).filter(Team.id == id).first()
    if not t:
        raise HTTPException(404, "Không tìm thấy team")
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên team không được để trống")
    dup = db.query(Team).filter(Team.name.ilike(name), Team.id != id).first()
    if dup:
        raise HTTPException(400, f"Team '{name}' đã tồn tại")
    old_dict = {"name": t.name, "description": t.description}
    t.name = name
    t.description = body.get("description") or None
    db.commit()
    db.refresh(t)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Team", entity_type="Team",
        entity_id=t.id, old_dict=old_dict, new_dict={"name": t.name, "description": t.description},
        field_labels={"name": "Tên team", "description": "Mô tả"}
    )
    db.commit()
    return t

@router.delete("/teams/{id}")
def delete_team(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    t = db.query(Team).filter(Team.id == id).first()
    if not t:
        raise HTTPException(404, "Không tìm thấy team")
    t_name = t.name
    db.delete(t)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Team", entity_type="Team",
        entity_id=id, action="DELETE", resource_name=t_name,
        description=f"Xóa team '{t_name}'"
    )
    db.commit()
    return {"message": "Đã xóa team thành công"}

# ----------------- CUSTOMERS -----------------
@router.get("/customers")
def list_customers(business_unit: Optional[str] = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = db.query(Customer)
    # Workspace data scope: for Leader, Member and Viewer the effective Workspace
    # comes from the authenticated user, so the business_unit query parameter can
    # never bypass the caller's assigned Workspace.
    if getattr(current_user, "role", None) in WORKSPACE_SCOPED_ROLES and user_scope(current_user) != ALL_SCOPE:
        business_unit = user_scope(current_user)
    if business_unit:
        q = q.filter(Customer.business_unit == business_unit.lower().strip())
    return q.order_by(Customer.name.asc()).all()


@router.get("/customers/by-workspace/{code}")
def list_customers_by_workspace(code: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Project Hub — Customers tab. A Customer's effective Workspace is derived
    from its linked Projects, not `Customer.business_unit` (confirmed
    unreliable/unmaintained by a production data audit — see
    access.customer_query_for_user for details). 403 if the caller hasn't
    been granted *code*.
    """
    from ..models.project import Project as ProjectModel

    ws = resolve_workspace(db, code)
    if not ws:
        raise HTTPException(404, "Không tìm thấy workspace")

    role = getattr(current_user, "role", None)
    if role != ROLE_SUPER_ADMIN:
        scopes = user_allowed_scopes(db, current_user)
        if scopes != ALL_SCOPE and ws.code not in scopes:
            raise HTTPException(403, "Bạn không có quyền truy cập Workspace này.")

    base = customer_query_for_user(db, current_user)
    customer_ids_in_ws = db.query(ProjectModel.customer_id).filter(
        ProjectModel.customer_id.isnot(None),
        sql_or(ProjectModel.business == ws.name, ProjectModel.business == "All"),
    ).subquery()
    return base.filter(Customer.id.in_(customer_ids_in_ws)).order_by(Customer.name.asc()).all()


@router.post("/customers")
def create_customer(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    bu = str(body.get("business_unit") or default_scope(db)).strip().lower()
    if not is_valid_scope(db, bu):
        raise HTTPException(400, f"Business Unit '{bu}' không hợp lệ")
    if not name:
        raise HTTPException(400, "Tên khách hàng không được để trống")
    if db.query(Customer).filter(Customer.name.ilike(name), Customer.business_unit == bu).first():
        raise HTTPException(400, f"Khách hàng '{name}' đã tồn tại")
    c = Customer(name=name, description=body.get("description") or None, business_unit=bu)
    db.add(c)
    db.commit()
    db.refresh(c)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Customer", entity_type="Customer",
        entity_id=c.id, action="CREATE", resource_name=c.name, business_unit=c.business_unit,
        description=f"Tạo khách hàng '{c.name}' (BU: {c.business_unit})"
    )
    db.commit()
    return c

@router.put("/customers/{id}")
def update_customer(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    name = str(body.get("name", "")).strip()
    bu = str(body.get("business_unit") or c.business_unit or default_scope(db)).strip().lower()
    if not is_valid_scope(db, bu):
        raise HTTPException(400, f"Business Unit '{bu}' không hợp lệ")
    if not name:
        raise HTTPException(400, "Tên khách hàng không được để trống")
    dup = db.query(Customer).filter(Customer.name.ilike(name), Customer.business_unit == bu, Customer.id != id).first()
    if dup:
        raise HTTPException(400, f"Khách hàng '{name}' đã tồn tại")
    old_dict = {"name": c.name, "business_unit": c.business_unit, "description": c.description}
    c.name = name
    c.business_unit = bu
    c.description = body.get("description") or None
    db.commit()
    db.refresh(c)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Customer", entity_type="Customer",
        entity_id=c.id, old_dict=old_dict,
        new_dict={"name": c.name, "business_unit": c.business_unit, "description": c.description},
        business_unit=c.business_unit,
        field_labels={"name": "Tên khách hàng", "business_unit": "Business Unit", "description": "Mô tả"}
    )
    db.commit()
    return c

@router.delete("/customers/{id}")
def delete_customer(id: int, cascade_projects: bool = False, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    from sqlalchemy import or_
    from ..models.project import Project, project_members, ProjectLink
    from ..models.phase import Phase
    from ..models.task_group import TaskGroup

    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")

    # Find associated projects
    linked_projects = db.query(Project).filter(
        or_(
            Project.customer_id == id,
            (Project.customer_name == c.name if c.name else False)
        )
    ).all()

    if cascade_projects:
        for p in linked_projects:
            phases = db.query(Phase).filter(Phase.project_id == p.id).all()
            phase_ids = [ph.id for ph in phases]
            if phase_ids:
                task_groups = db.query(TaskGroup).filter(TaskGroup.phase_id.in_(phase_ids)).all()
                tg_ids = [tg.id for tg in task_groups]
                if tg_ids:
                    db.query(Task).filter(Task.task_group_id.in_(tg_ids)).delete(synchronize_session=False)
                    db.query(TaskGroup).filter(TaskGroup.id.in_(tg_ids)).delete(synchronize_session=False)
                db.query(Phase).filter(Phase.id.in_(phase_ids)).delete(synchronize_session=False)
            db.query(ProjectLink).filter(ProjectLink.project_id == p.id).delete(synchronize_session=False)
            db.execute(project_members.delete().where(project_members.c.project_id == p.id))
            db.delete(p)
    else:
        for p in linked_projects:
            p.customer_id = None
            p.customer_name = None

    c_name = c.name
    c_bu = c.business_unit
    db.delete(c)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Customer", entity_type="Customer",
        entity_id=id, action="DELETE", resource_name=c_name, business_unit=c_bu,
        description=f"Xóa khách hàng '{c_name}'" + (f" (kèm {len(linked_projects)} dự án liên kết)" if cascade_projects and linked_projects else "")
    )
    db.commit()
    return {"message": "Đã xóa khách hàng thành công"}


# ----------------- MASTER PHASES -----------------
@router.get("/master-phases")
def list_master_phases(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(MasterPhase).order_by(MasterPhase.sort_order.asc(), MasterPhase.id.asc()).all()

@router.post("/master-phases")
def create_master_phase(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên giai đoạn không được để trống")
    desc = str(body.get("description", "")).strip()
    max_order = db.query(sql_func.max(MasterPhase.sort_order)).scalar() or 0
    mp = MasterPhase(name=name, description=desc or None, sort_order=max_order + 1, is_active=True)
    db.add(mp)
    db.commit()
    db.refresh(mp)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Master Phase", entity_type="MasterPhase",
        entity_id=mp.id, action="CREATE", resource_name=mp.name,
        description=f"Tạo giai đoạn master '{mp.name}'"
    )
    db.commit()
    return mp

@router.put("/master-phases/reorder")
def reorder_master_phases(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    order_ids = body.get("ids", [])
    for idx, mp_id in enumerate(order_ids):
        db.query(MasterPhase).filter(MasterPhase.id == mp_id).update({"sort_order": idx + 1})
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Master Phase", entity_type="MasterPhase",
        entity_id=None, action="UPDATE",
        description=f"Sắp xếp lại thứ tự {len(order_ids)} giai đoạn master"
    )
    db.commit()
    return {"message": "Đã cập nhật thứ tự giai đoạn"}

@router.put("/master-phases/{id}")
def update_master_phase(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    mp = db.query(MasterPhase).filter(MasterPhase.id == id).first()
    if not mp:
        raise HTTPException(404, "Không tìm thấy giai đoạn master")
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên giai đoạn không được để trống")
    old_dict = {"name": mp.name, "description": mp.description, "sort_order": mp.sort_order, "is_active": mp.is_active}
    mp.name = name
    if "description" in body:
        mp.description = body["description"]
    if "sort_order" in body:
        mp.sort_order = body["sort_order"]
    if "is_active" in body:
        mp.is_active = body["is_active"]
    db.commit()
    db.refresh(mp)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Master Phase", entity_type="MasterPhase",
        entity_id=mp.id, old_dict=old_dict,
        new_dict={"name": mp.name, "description": mp.description, "sort_order": mp.sort_order, "is_active": mp.is_active},
        field_labels={"name": "Tên", "description": "Mô tả", "sort_order": "Thứ tự", "is_active": "Đang áp dụng"}
    )
    db.commit()
    return mp

@router.delete("/master-phases/{id}")
def delete_master_phase(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    mp = db.query(MasterPhase).filter(MasterPhase.id == id).first()
    if not mp:
        raise HTTPException(404, "Không tìm thấy giai đoạn master")
    mp_name = mp.name
    db.delete(mp)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Master Phase", entity_type="MasterPhase",
        entity_id=id, action="DELETE", resource_name=mp_name,
        description=f"Xóa giai đoạn master '{mp_name}'"
    )
    db.commit()
    return {"message": "Đã xóa giai đoạn thành công"}


# ----------------- WORKSPACES -----------------
@router.get("/workspaces")
def list_workspaces(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = db.query(Workspace).order_by(Workspace.id.asc())
    # Workspace access: Leader, Member and Viewer only get the Workspace(s)
    # they've been granted (one or more — see user_workspace_access), so the
    # Sidebar / Project Hub can never switch to a Workspace outside that set.
    if getattr(current_user, "role", None) in WORKSPACE_SCOPED_ROLES:
        scopes = user_allowed_scopes(db, current_user)
        if scopes != ALL_SCOPE:
            q = q.filter(Workspace.code.in_(scopes))
    return q.all()

@router.post("/workspaces")
def create_workspace(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    code = str(body.get("code", "")).strip().lower()
    if not name:
        raise HTTPException(400, "Tên workspace không được để trống")
    if not code:
        raise HTTPException(400, "Mã workspace không được để trống")
    if not re.match(r"^[a-z0-9_-]+$", code):
        raise HTTPException(400, "Mã workspace chỉ được chứa chữ thường, số, gạch dưới hoặc gạch ngang")
    if db.query(Workspace).filter(Workspace.name.ilike(name)).first():
        raise HTTPException(400, f"Workspace '{name}' đã tồn tại")
    if db.query(Workspace).filter(Workspace.code == code).first():
        raise HTTPException(400, f"Mã workspace '{code}' đã tồn tại")
    w = Workspace(name=name, code=code, description=body.get("description") or None)
    db.add(w)
    db.commit()
    db.refresh(w)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Workspace", entity_type="Workspace",
        entity_id=w.id, action="CREATE", resource_name=w.name,
        description=f"Tạo workspace '{w.name}' (mã: {w.code})"
    )
    db.commit()
    return w

@router.put("/workspaces/{id}")
def update_workspace(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    w = db.query(Workspace).filter(Workspace.id == id).first()
    if not w:
        raise HTTPException(404, "Không tìm thấy workspace")
    name = str(body.get("name", "")).strip()
    code = str(body.get("code", "")).strip().lower()
    if not name:
        raise HTTPException(400, "Tên workspace không được để trống")
    if not code:
        raise HTTPException(400, "Mã workspace không được để trống")
    if not re.match(r"^[a-z0-9_-]+$", code):
        raise HTTPException(400, "Mã workspace chỉ được chứa chữ thường, số, gạch dưới hoặc gạch ngang")
    if db.query(Workspace).filter(Workspace.name.ilike(name), Workspace.id != id).first():
        raise HTTPException(400, f"Workspace '{name}' đã tồn tại")
    if db.query(Workspace).filter(Workspace.code == code, Workspace.id != id).first():
        raise HTTPException(400, f"Mã workspace '{code}' đã tồn tại")

    old_name = w.name
    old_code = w.code
    w.name = name
    w.code = code
    w.description = body.get("description") or None

    # Cascade changes to every entity that stores workspace values
    if old_name.lower() != name.lower():
        from ..models.project import Project
        db.query(Project).filter(Project.business == old_name).update({Project.business: name}, synchronize_session=False)
        from ..models.audit_log import AuditLog
        db.query(AuditLog).filter(AuditLog.business_unit == old_name).update({AuditLog.business_unit: name}, synchronize_session=False)
    if old_code != code:
        db.query(User).filter(User.data_scope == old_code).update({User.data_scope: code}, synchronize_session=False)
        from ..models.project import Project
        db.query(Project).filter(Project.data_scope == old_code).update({Project.data_scope: code}, synchronize_session=False)
        db.query(Customer).filter(Customer.business_unit == old_code).update({Customer.business_unit: code}, synchronize_session=False)
    db.commit()
    db.refresh(w)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Workspace", entity_type="Workspace",
        entity_id=w.id, old_dict={"name": old_name, "code": old_code},
        new_dict={"name": w.name, "code": w.code},
        field_labels={"name": "Tên workspace", "code": "Mã workspace"}
    )
    db.commit()
    return w

@router.delete("/workspaces/{id}")
def delete_workspace(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    w = db.query(Workspace).filter(Workspace.id == id).first()
    if not w:
        raise HTTPException(404, "Không tìm thấy workspace")
    from ..models.project import Project
    if db.query(User).filter(User.data_scope == w.code).first():
        raise HTTPException(400, f"Không thể xóa workspace '{w.name}' vì đang được sử dụng bởi một hoặc nhiều tài khoản")
    if db.query(UserWorkspaceAccess).filter(UserWorkspaceAccess.workspace_id == w.id).first():
        raise HTTPException(400, f"Không thể xóa workspace '{w.name}' vì đang được cấp quyền cho một hoặc nhiều tài khoản")
    if db.query(Project).filter(Project.data_scope == w.code).first():
        raise HTTPException(400, f"Không thể xóa workspace '{w.name}' vì đang được sử dụng bởi một hoặc nhiều dự án")
    if db.query(Customer).filter(Customer.business_unit == w.code).first():
        raise HTTPException(400, f"Không thể xóa workspace '{w.name}' vì đang được sử dụng bởi một hoặc nhiều khách hàng")
    w_name, w_code = w.name, w.code
    db.delete(w)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Workspace", entity_type="Workspace",
        entity_id=id, action="DELETE", resource_name=w_name,
        description=f"Xóa workspace '{w_name}' (mã: {w_code})"
    )
    db.commit()
    return {"message": "Đã xóa workspace thành công"}

