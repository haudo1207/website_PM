from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json
import re

from sqlalchemy import func as sql_func, or_ as sql_or
from ..database import get_db
from ..models.system_category import Position, Department, TaskPriority, TaskStatus, Team, Customer, Workspace, WorkspaceIntegrationSecret
from ..models.master_phase import MasterPhase
from ..models.user import User
from ..models.task import Task
from ..models.workspace_access import UserWorkspaceAccess
from ..utils.auth import require_admin, get_current_user, get_current_user_or_support_key, require_admin_or_support_key_write, is_support_key_write_user
from ..utils.audit_service import AuditService
from ..utils.access import (
    default_scope,
    is_valid_scope,
    user_scope,
    user_allowed_scopes,
    resolve_workspace,
    customer_query_for_user,
    customer_in_workspace_filter,
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
def list_priorities(db: Session = Depends(get_db), _=Depends(get_current_user_or_support_key)):
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
def list_statuses(db: Session = Depends(get_db), _=Depends(get_current_user_or_support_key)):
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
    # Workspace data scope: for Leader, Member and Viewer the effective
    # Workspace(s) come from the authenticated user's FULL grant set (Chính +
    # every Phụ via user_allowed_scopes) — not just their primary data_scope
    # column — so a Phụ Workspace grant isn't silently invisible here the way
    # it used to be. The business_unit query parameter can never bypass this
    # for a scoped role.
    role = getattr(current_user, "role", None)
    if role in WORKSPACE_SCOPED_ROLES:
        scopes = user_allowed_scopes(db, current_user)
        if scopes != ALL_SCOPE:
            # Issue 2 fix — derive Customer Workspace from the Customer's
            # linked Projects (in the user's granted Workspaces) instead of
            # trusting Customer.business_unit alone, so the dropdown never
            # exposes a Customer whose Projects the Leader can't actually see.
            q = customer_query_for_user(db, current_user)
    bu = (business_unit or "").strip().lower()
    if bu and bu not in ("all", "null", "none"):
        # Same Workspace rule as the project form (project-derived, with a
        # business_unit fallback only for project-less Customers) — the legacy
        # Customer.business_unit column alone hid Customers of "All" projects
        # and of projects whose Customer row carries a stale BU.
        ws = resolve_workspace(db, bu)
        if ws:
            q = q.filter(customer_in_workspace_filter(db, ws))
        else:
            q = q.filter(sql_or(Customer.business_unit == bu, Customer.business_unit == ALL_SCOPE))
    return q.order_by(Customer.name.asc()).all()


@router.get("/customer-project-version")
def customer_project_version(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Cheap change stamp the frontend polls to refresh Customer/Project lists
    when another user edits them (no WebSocket/Redis, and uvicorn runs several
    workers, so an in-process push channel wouldn't reach every client).

    Built from aggregates instead of a dedicated column: counts/max ids catch
    creates and deletes, Project.updated_at catches project edits, and the
    Customer audit trail catches renames (Customer has no updated_at; its
    audit rows survive deletion — customer_id is SET NULL, not CASCADE).
    """
    from ..models.project import Project as ProjectModel
    from ..models.audit_log import AuditLog

    c_count, c_max = db.query(sql_func.count(Customer.id), sql_func.max(Customer.id)).one()
    p_count, p_max, p_updated = db.query(
        sql_func.count(ProjectModel.id), sql_func.max(ProjectModel.id), sql_func.max(ProjectModel.updated_at)
    ).one()
    c_audit = db.query(sql_func.max(AuditLog.id)).filter(AuditLog.module == "Customer").scalar()
    return {"version": f"{c_count}:{c_max}:{c_audit}:{p_count}:{p_max}:{p_updated or ''}"}


@router.get("/customers/by-workspace/{code}")
def list_customers_by_workspace(code: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Project Hub — Customers tab. A Customer's effective Workspace is derived
    from its linked Projects, not `Customer.business_unit` (confirmed
    unreliable/unmaintained by a production data audit — see
    access.customer_query_for_user for details). 403 if the caller hasn't
    been granted *code*.
    """
    ws = resolve_workspace(db, code)
    if not ws:
        raise HTTPException(404, "Không tìm thấy workspace")

    role = getattr(current_user, "role", None)
    if role != ROLE_SUPER_ADMIN:
        scopes = user_allowed_scopes(db, current_user)
        if scopes != ALL_SCOPE and ws.code not in scopes:
            raise HTTPException(403, "Bạn không có quyền truy cập Workspace này.")

    # Project-derived Workspace, plus a business_unit fallback for Customers with
    # no Projects yet — otherwise a freshly created Customer could never be
    # picked when creating its first Project.
    base = customer_query_for_user(db, current_user)
    return base.filter(customer_in_workspace_filter(db, ws)).order_by(Customer.name.asc()).all()


@router.post("/customers")
def create_customer(body: dict, db: Session = Depends(get_db), current_user=Depends(require_admin_or_support_key_write)):
    name = str(body.get("name", "")).strip()
    bu = str(body.get("business_unit") or default_scope(db)).strip().lower()
    if not is_valid_scope(db, bu):
        raise HTTPException(400, f"Business Unit '{bu}' không hợp lệ")
    if not name:
        raise HTTPException(400, "Tên khách hàng không được để trống")
    if db.query(Customer).filter(sql_func.lower(Customer.name) == name.lower(), Customer.business_unit == bu).first():
        raise HTTPException(400, f"Khách hàng '{name}' đã tồn tại")
    c = Customer(name=name, description=body.get("description") or None, business_unit=bu)
    db.add(c)
    db.commit()
    db.refresh(c)
    via_key = is_support_key_write_user(current_user)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Customer", entity_type="Customer",
        entity_id=c.id, action="CREATE", resource_name=c.name, business_unit=c.business_unit,
        description=f"Tạo khách hàng '{c.name}' (BU: {c.business_unit})" + (" [qua SUPPORT_INTEGRATION_API_KEY]" if via_key else "")
    )
    db.commit()
    return c

def _customer_projects_filter(c: Customer):
    """Projects linked to Customer *c*: by customer_id, or — legacy rows only,
    where customer_id is NULL — by customer_name. Never match by name a
    Project that already points at another Customer (same-named Customers
    exist in different Workspaces)."""
    from sqlalchemy import and_
    from ..models.project import Project
    cond = Project.customer_id == c.id
    if c.name:
        cond = sql_or(cond, and_(Project.customer_id.is_(None), Project.customer_name == c.name))
    return cond


def _sync_project_customer_name(db: Session, c: Customer, old_name: str) -> None:
    """After a rename, keep Projects' denormalised customer_name in step and
    adopt legacy name-only Projects (customer_id NULL, old name) so they don't
    silently detach — unless another Customer still carries the old name, in
    which case those legacy rows are ambiguous and left alone."""
    from sqlalchemy import and_
    from ..models.project import Project
    db.query(Project).filter(Project.customer_id == c.id).update(
        {Project.customer_name: c.name}, synchronize_session=False
    )
    if old_name and not db.query(Customer.id).filter(Customer.name == old_name, Customer.id != c.id).first():
        db.query(Project).filter(
            and_(Project.customer_id.is_(None), Project.customer_name == old_name)
        ).update({Project.customer_id: c.id, Project.customer_name: c.name}, synchronize_session=False)


@router.get("/customers/{id}/linked-projects")
def list_customer_linked_projects(id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    """Every Project a delete of this Customer would cascade to / unlink —
    across ALL Workspaces, not just the one on screen — so the delete dialog
    can show the real list before the user confirms."""
    from ..models.project import Project
    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    rows = db.query(Project).filter(_customer_projects_filter(c)).order_by(Project.year.desc(), Project.name.asc()).all()
    return [{"id": p.id, "name": p.name, "year": p.year, "business": p.business} for p in rows]


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
    dup = db.query(Customer).filter(sql_func.lower(Customer.name) == name.lower(), Customer.business_unit == bu, Customer.id != id).first()
    if dup:
        raise HTTPException(400, f"Khách hàng '{name}' đã tồn tại")
    old_dict = {"name": c.name, "business_unit": c.business_unit, "description": c.description}
    old_name = c.name
    c.name = name
    c.business_unit = bu
    # The inline rename only sends `name` — don't wipe the description then.
    if "description" in body:
        c.description = body.get("description") or None
    if old_name != name:
        _sync_project_customer_name(db, c, old_name)
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
    from ..models.project import Project
    from .projects import delete_project_rows

    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")

    # Find associated projects
    linked_projects = db.query(Project).filter(_customer_projects_filter(c)).all()

    if cascade_projects:
        # Same cascade as deleting a project directly (tasks, phases, links,
        # members, meetings — shared meetings handed over, AI rows), all in
        # this one transaction with the Customer delete.
        for p in linked_projects:
            delete_project_rows(db, p)
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
    progress_pct = body.get("progress_pct")
    # Validate progress_pct is in 0..100 if provided.
    if progress_pct is not None:
        try:
            progress_pct = float(progress_pct)
        except (TypeError, ValueError):
            raise HTTPException(400, "progress_pct phải là số trong khoảng 0..100")
        if progress_pct < 0 or progress_pct > 100:
            raise HTTPException(400, "progress_pct phải nằm trong khoảng 0..100")
    mp = MasterPhase(
        name=name,
        description=desc or None,
        sort_order=max_order + 1,
        is_active=True,
        progress_pct=progress_pct,
    )
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
    old_dict = {
        "name": mp.name, "description": mp.description,
        "sort_order": mp.sort_order, "is_active": mp.is_active,
        "progress_pct": float(mp.progress_pct) if mp.progress_pct is not None else None,
    }
    mp.name = name
    if "description" in body:
        mp.description = body["description"]
    if "sort_order" in body:
        mp.sort_order = body["sort_order"]
    if "is_active" in body:
        mp.is_active = body["is_active"]
    # Project Progress configured percentage — Issue 3. Bounded to 0..100.
    if "progress_pct" in body and body["progress_pct"] is not None:
        try:
            new_pct = float(body["progress_pct"])
        except (TypeError, ValueError):
            raise HTTPException(400, "progress_pct phải là số trong khoảng 0..100")
        if new_pct < 0 or new_pct > 100:
            raise HTTPException(400, "progress_pct phải nằm trong khoảng 0..100")
        mp.progress_pct = new_pct
    elif "progress_pct" in body and body["progress_pct"] is None:
        mp.progress_pct = None
    db.commit()
    db.refresh(mp)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Master Phase", entity_type="MasterPhase",
        entity_id=mp.id, old_dict=old_dict,
        new_dict={
            "name": mp.name, "description": mp.description,
            "sort_order": mp.sort_order, "is_active": mp.is_active,
            "progress_pct": float(mp.progress_pct) if mp.progress_pct is not None else None,
        },
        field_labels={"name": "Tên", "description": "Mô tả", "sort_order": "Thứ tự", "is_active": "Đang áp dụng", "progress_pct": "Tiến độ (%)"}
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
def _with_secret_flags(db: Session, workspaces):
    """Attach has_n8n_webhook_secret (never the secret itself) for the
    Settings UI."""
    rows = workspaces if isinstance(workspaces, list) else [workspaces]
    ids = [w.id for w in rows]
    configured = {
        wid for (wid, sec) in db.query(WorkspaceIntegrationSecret.workspace_id, WorkspaceIntegrationSecret.n8n_webhook_secret)
        .filter(WorkspaceIntegrationSecret.workspace_id.in_(ids)).all()
        if sec
    } if ids else set()
    for w in rows:
        w.has_n8n_webhook_secret = w.id in configured
    return workspaces


def _apply_n8n_secret(db: Session, workspace_id: int, body: dict) -> Optional[str]:
    """Set (non-empty `n8n_webhook_secret`) or clear (`clear_n8n_webhook_secret`)
    the Workspace's inbound n8n secret. Omitted = unchanged. Returns an audit
    note, never the value."""
    new_secret = str(body.get("n8n_webhook_secret") or "").strip()
    clear = bool(body.get("clear_n8n_webhook_secret"))
    if not new_secret and not clear:
        return None
    if new_secret and len(new_secret) < 16:
        raise HTTPException(400, "Secret webhook n8n phải có ít nhất 16 ký tự")
    if new_secret and db.query(WorkspaceIntegrationSecret).filter(
        WorkspaceIntegrationSecret.n8n_webhook_secret == new_secret,
        WorkspaceIntegrationSecret.workspace_id != workspace_id,
    ).first():
        # The secret is what identifies the Workspace on an inbound call.
        raise HTTPException(400, "Secret này đang được Workspace khác sử dụng")
    row = db.query(WorkspaceIntegrationSecret).filter(WorkspaceIntegrationSecret.workspace_id == workspace_id).first()
    if not row:
        row = WorkspaceIntegrationSecret(workspace_id=workspace_id)
        db.add(row)
    row.n8n_webhook_secret = None if clear and not new_secret else new_secret
    return "Đặt secret webhook n8n" if row.n8n_webhook_secret else "Xóa secret webhook n8n"


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
    return _with_secret_flags(db, q.all())

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
    w = Workspace(
        name=name, code=code, description=body.get("description") or None,
        n8n_webhook_url=body.get("n8n_webhook_url") or None,
        expected_google_email=body.get("expected_google_email") or None,
    )
    db.add(w)
    db.flush()
    secret_note = _apply_n8n_secret(db, w.id, body)
    db.commit()
    db.refresh(w)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Workspace", entity_type="Workspace",
        entity_id=w.id, action="CREATE", resource_name=w.name,
        description=f"Tạo workspace '{w.name}' (mã: {w.code})" + (f" — {secret_note}" if secret_note else "")
    )
    db.commit()
    return _with_secret_flags(db, w)

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
    old_webhook = w.n8n_webhook_url
    old_expected_email = w.expected_google_email
    w.name = name
    w.code = code
    w.description = body.get("description") or None
    w.n8n_webhook_url = body.get("n8n_webhook_url") or None
    w.expected_google_email = body.get("expected_google_email") or None
    secret_note = _apply_n8n_secret(db, w.id, body)

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
        entity_id=w.id,
        old_dict={"name": old_name, "code": old_code, "n8n_webhook_url": old_webhook, "expected_google_email": old_expected_email},
        new_dict={"name": w.name, "code": w.code, "n8n_webhook_url": w.n8n_webhook_url, "expected_google_email": w.expected_google_email},
        field_labels={"name": "Tên workspace", "code": "Mã workspace", "n8n_webhook_url": "Webhook n8n", "expected_google_email": "Email Google dự kiến"}
    )
    if secret_note:
        AuditService.record(
            db=db, user_id=getattr(current_user, "id", None), module="Workspace", entity_type="Workspace",
            entity_id=w.id, action="UPDATE", resource_name=w.name,
            description=f"{secret_note} cho workspace '{w.name}'"
        )
    db.commit()
    return _with_secret_flags(db, w)

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

