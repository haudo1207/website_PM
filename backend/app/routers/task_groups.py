"""
Task Groups Router — CRUD for task groups within a phase.
Tasks Router — CRUD for tasks within a task group.

Business Rules:
- TaskGroup displayed as table row with Roman numeral ID (I, II, III...)
- TaskGroup editable fields: name, manday_est, status, start_date_est
- TaskGroup Done → Commit KPI (badge ✓ on child tasks)
- TaskGroup Cancel → Discard KPI (all child task KPIs = 0)
- Task is the ONLY entity where KPI is calculated
- Task ID format: <group_index>.<seq> (e.g. 1.1, 1.2, 2.1)
"""
from fastapi import APIRouter, Depends, HTTPException
import math
from datetime import timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from decimal import Decimal
from ..database import get_db
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from ..models.project import Project, project_members
from ..utils.kpi_engine import recalculate_task, parse_date
from ..utils.access import require_project, require_route_project_access, project_query_for_user, user_scope, ALL_SCOPE, ROLE_LEADER
from ..utils.auth import get_current_user
from ..utils.audit_service import AuditService
# Đảm bảo có import date/datetime để tính ngày
from datetime import date, datetime
from decimal import Decimal
from ..utils.kpi_engine import recalculate_task

router = APIRouter(tags=["task-groups-and-tasks"], dependencies=[Depends(require_route_project_access)])


# ═══════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════

ROMAN_MAP = [(1000,'M'),(900,'CM'),(500,'D'),(400,'CD'),(100,'C'),(90,'XC'),
             (50,'L'),(40,'XL'),(10,'X'),(9,'IX'),(5,'V'),(4,'IV'),(1,'I')]

def to_roman(n: int) -> str:
    if n <= 0: return str(n)
    result = ''
    for value, numeral in ROMAN_MAP:
        while n >= value:
            result += numeral
            n -= value
    return result


def calc_group_progress(task_group_id: int, db: Session) -> float:
    total = db.query(Task).filter(Task.task_group_id == task_group_id).count()
    if total == 0:
        return 0.0
    done = db.query(Task).filter(
        Task.task_group_id == task_group_id,
        Task.status.in_(["Done", "done"])
    ).count()
    return round((done / total) * 100, 2)


def recalculate_task_group_dates(tg, db):
    """Auto-calculate end_date_est from start_date_est + manday_est."""
    if tg.start_date_est and tg.manday_est:
        days = int(math.ceil(float(tg.manday_est))) - 1
        tg.end_date_est = tg.start_date_est + timedelta(days=max(days, 0))
    elif not tg.manday_est:
        tg.end_date_est = None
    return tg


def sync_group_dates(tg, db, extra_start=None, extra_end=None):
    """Sync TaskGroup start_date_est (min) and end_date_est (max) from child tasks.
    extra_start: start_date of a newly added/modified task not yet committed.
    extra_end: end_date_est of a newly added/modified task not yet committed.
    """
    rows = db.query(Task.start_date, Task.end_date_est).filter(
        Task.task_group_id == tg.id
    ).all()
    start_dates = [r[0] for r in rows if r[0] is not None]
    end_dates   = [r[1] for r in rows if r[1] is not None]
    if extra_start is not None:
        start_dates.append(extra_start)
    if extra_end is not None:
        end_dates.append(extra_end)
    tg.start_date_est = min(start_dates) if start_dates else None
    tg.end_date_est   = max(end_dates)   if end_dates   else None
    return tg


def sync_group_actual_dates(tg, db):
    """Sync TaskGroup end_date_actual (max) from child tasks.
    
    Removed the child task synchronization as per user request.
    If the TaskGroup is marked Done, it will just keep its end_date_actual.
    """
    return tg


def get_parent_code(task_code: str):
    if not task_code or "." not in task_code:
        return None
    return task_code.rsplit(".", 1)[0]


def decimal_or_zero(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def format_decimal(value: Decimal) -> str:
    return format(value.normalize(), "f")


def validate_kpi_ratio(assign, support):
    try:
        assign_val = int(assign)
        support_val = int(support)
    except (TypeError, ValueError):
        raise HTTPException(400, "KPI RATIO phải là số hợp lệ, ví dụ 90/10 hoặc 50/50.")

    if assign_val < 0 or support_val < 0 or assign_val > 100 or support_val > 100:
        raise HTTPException(400, "KPI RATIO mỗi giá trị phải nằm trong khoảng 0 đến 100.")

    if assign_val + support_val != 100:
        raise HTTPException(400, "Tổng KPI RATIO phải bằng 100, ví dụ 90/10 hoặc 50/50.")

    return assign_val, support_val


def validate_manday_budget(gid: int, task_code: str, manday_est, db: Session, exclude_task_id: int = None):
    """Ensure direct child tasks do not exceed their parent Task/TaskGroup MANDAY EST."""
    if manday_est is None or not task_code:
        return

    new_manday = decimal_or_zero(manday_est)
    if new_manday <= 0:
        return

    parent_code = get_parent_code(task_code)
    if not parent_code:
        return

    parent_task = db.query(Task).filter(
        Task.task_group_id == gid,
        Task.task_code == parent_code
    ).first()

    if parent_task:
        parent_label = f"task cha {parent_code}"
        parent_manday = decimal_or_zero(parent_task.manday_est)
    else:
        tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
        if not tg:
            return
        parent_label = f"Task Group {tg.name}"
        parent_manday = decimal_or_zero(tg.manday_est)

    if parent_manday <= 0:
        return

    siblings = db.query(Task).filter(Task.task_group_id == gid).all()
    used_manday = Decimal("0")
    for sibling in siblings:
        if exclude_task_id is not None and sibling.id == exclude_task_id:
            continue
        if get_parent_code(sibling.task_code) == parent_code:
            used_manday += decimal_or_zero(sibling.manday_est)

    if used_manday >= parent_manday:
        raise HTTPException(
            400,
            f"Tổng MANDAY EST của task con ({format_decimal(used_manday)}) đã đạt/vượt "
            f"MANDAY EST của {parent_label} ({format_decimal(parent_manday)}), không thể thêm task mới."
        )

    total_manday = used_manday + new_manday
    if total_manday > parent_manday:
        remaining = parent_manday - used_manday
        raise HTTPException(
            400,
            f"MANDAY EST task mới ({format_decimal(new_manday)}) làm tổng task con "
            f"vượt MANDAY EST của {parent_label}. Còn lại tối đa {format_decimal(remaining)} manday."
        )


def get_group_index(tg, db) -> int:
    """Get 1-based index of this group within its phase (by sort_order)."""
    groups = db.query(TaskGroup).filter(
        TaskGroup.phase_id == tg.phase_id
    ).order_by(TaskGroup.sort_order, TaskGroup.id).all()
    for i, g in enumerate(groups):
        if g.id == tg.id:
            return i + 1
    return 1


def get_next_task_code(group_index: int, gid: int, db) -> str:
    """Generate next task_code like '1.3' for group_index=1."""
    existing = db.query(Task.task_code).filter(Task.task_group_id == gid).all()
    max_seq = 0
    prefix = f"{group_index}."
    for (code,) in existing:
        if code and code.startswith(prefix):
            try:
                seq = int(code[len(prefix):])
                if seq > max_seq:
                    max_seq = seq
            except ValueError:
                pass
    return f"{group_index}.{max_seq + 1}"


def serialize_task_group(tg, db, group_index=None):
    task_count = 0
    done_count = 0
    try:
        task_count = db.query(Task).filter(Task.task_group_id == tg.id).count()
        done_count = db.query(Task).filter(
            Task.task_group_id == tg.id,
            Task.status.in_(["Done", "done"])
        ).count()
    except Exception:
        pass

    if group_index is None:
        try:
            group_index = get_group_index(tg, db)
        except Exception:
            group_index = 1

    return {
        "id": tg.id,
        "phase_id": tg.phase_id,
        "name": tg.name,
        "description": tg.description,
        "status": getattr(tg, "status", "Waiting") or "Waiting",
        "progress": safe_float(getattr(tg, "progress", 0)) or 0.0,
        "sort_order": getattr(tg, "sort_order", 0) or 0,
        "group_index": group_index,
        "roman_index": to_roman(group_index),
        "manday_est": safe_float(getattr(tg, "manday_est", None)),
        "start_date_est": str(tg.start_date_est) if getattr(tg, "start_date_est", None) else None,
        "end_date_est": str(tg.end_date_est) if getattr(tg, "end_date_est", None) else None,
        "manday_actual": safe_float(getattr(tg, "manday_actual", None)),
        "end_date_actual": str(getattr(tg, "end_date_actual_override", None) or getattr(tg, "end_date_actual", None)) if (getattr(tg, "end_date_actual_override", None) or getattr(tg, "end_date_actual", None)) else None,
        "end_date_actual_auto": str(tg.end_date_actual) if getattr(tg, "end_date_actual", None) else None,
        "end_date_actual_override": str(tg.end_date_actual_override) if getattr(tg, "end_date_actual_override", None) else None,
        "task_count": task_count,
        "done_count": done_count,
        "created_at": str(tg.created_at) if getattr(tg, "created_at", None) else None,
    }


@router.get("/phases/{phid}/task-groups")
def list_task_groups(phid: int, db: Session = Depends(get_db)):
    try:
        groups = db.query(TaskGroup).filter(TaskGroup.phase_id == phid).order_by(TaskGroup.sort_order, TaskGroup.id).all()
        out = []
        for i, g in enumerate(groups):
            try:
                out.append(serialize_task_group(g, db, i + 1))
            except Exception as e:
                print(f"Error serializing task group {getattr(g, 'id', None)}: {e}")
        return out
    except Exception as exc:
        print(f"Error in list_task_groups for phid {phid}: {exc}")
        return []


@router.post("/phases/{phid}/task-groups")
def create_task_group(phid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    phase = db.query(Phase).filter(Phase.id == phid).first()
    if not phase:
        raise HTTPException(404, "Phase not found.")
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Task group name is required.")

    manday_est = body.get("manday_est")
    if manday_est is not None:
        try:
            manday_est = float(manday_est)
        except (ValueError, TypeError):
            raise HTTPException(400, "Manday EST must be a number.")

    max_order = db.query(sql_func.max(TaskGroup.sort_order)).filter(TaskGroup.phase_id == phid).scalar() or 0
    tg = TaskGroup(
        phase_id=phid,
        name=name,
        description=body.get("description"),
        status=body.get("status", "Waiting"),
        manday_est=manday_est,
        sort_order=max_order + 1,
        start_date_est=parse_date(body.get("start_date_est")),
    )
    tg = recalculate_task_group_dates(tg, db)
    db.add(tg)
    db.commit()
    db.refresh(tg)
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task Group",
        entity_type="TaskGroup",
        entity_id=tg.id,
        action="CREATE",
        project_id=phase.project_id,
        description=f"Đã tạo Task Cha '{tg.name}'"
    )
    db.commit()
    return serialize_task_group(tg, db)


@router.patch("/phases/{phid}/task-groups/{gid}")
def update_task_group(phid: int, gid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
    if not tg:
        raise HTTPException(404, "Task group not found.")

    old_dict = {
        "name": tg.name,
        "status": tg.status,
        "manday_est": float(tg.manday_est) if tg.manday_est is not None else None,
        "description": tg.description,
    }

    old_status = tg.status

    for field in ["name", "description", "sort_order", "status"]:
        if field in body:
            setattr(tg, field, body[field])
    if "manday_est" in body:
        val = body["manday_est"]
        if val is not None:
            try:
                val = float(val)
            except (ValueError, TypeError):
                raise HTTPException(400, "Manday EST must be a number.")
        tg.manday_est = val
    if "start_date_est" in body:
        tg.start_date_est = parse_date(body["start_date_est"])
    if "end_date_actual_override" in body:
        tg.end_date_actual_override = parse_date(body["end_date_actual_override"])
    tg = recalculate_task_group_dates(tg, db)

    new_status = tg.status

    # === END ACTUAL tự động khi TaskGroup chuyển sang Done ===
    # Khi TaskGroup chuyển sang "Done" → set END ACTUAL = ngày hôm nay (ngày chuyển trạng thái)
    if new_status and new_status.strip().lower() == "done":
        if not tg.end_date_actual_override:
            tg.end_date_actual = date.today()
    # Khi TaskGroup không còn "Done" → xóa END ACTUAL tự động (giữ override nếu có)
    elif old_status and old_status.strip().lower() == "done":
        tg.end_date_actual = None

    # Recalculate progress
    tg.progress = Decimal(str(calc_group_progress(gid, db)))

    # === KPI Commit / Discard Logic ===
    if old_status != new_status:
        tasks = db.query(Task).filter(Task.task_group_id == gid).all()
        if new_status and new_status.strip().lower() == "cancel":
            # Discard KPI: set all child task KPIs to 0
            for t in tasks:
                t.kpi_base = Decimal("0")
                t.kpi_perform = Decimal("0")
                t.kpi_ot = Decimal("0")
                t.kpi_final = Decimal("0")
                t.kpi_assigned = Decimal("0")
                t.kpi_support = Decimal("0")
        else:
            # Recalculate child tasks (handles done, process, waiting, etc.)
            for t in tasks:
                recalculate_task(t, db)

    db.commit()
    db.refresh(tg)

    new_dict = {
        "name": tg.name,
        "status": tg.status,
        "manday_est": float(tg.manday_est) if tg.manday_est is not None else None,
        "description": tg.description,
    }
    field_labels = {
        "name": "Tên Task Cha",
        "status": "Trạng thái Task Cha",
        "manday_est": "Manday EST Task Cha",
        "description": "Mô tả Task Cha",
    }
    project_id = tg.phase.project_id if tg.phase else None
    AuditService.record_diff(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task Group",
        entity_type="TaskGroup",
        entity_id=tg.id,
        old_dict=old_dict,
        new_dict=new_dict,
        project_id=project_id,
        field_labels=field_labels,
    )
    db.commit()
    return serialize_task_group(tg, db)


@router.delete("/phases/{phid}/task-groups/{gid}")
def delete_task_group(phid: int, gid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
    if not tg:
        raise HTTPException(404, "Task group not found.")
    task_count = db.query(Task).filter(Task.task_group_id == gid).count()
    if task_count > 0:
        raise HTTPException(400, f"Không thể xóa Task Group vì còn {task_count} Task. Hãy xóa hết Task trước.")
    tg_name = tg.name
    project_id = tg.phase.project_id if tg.phase else None
    db.delete(tg)
    db.commit()
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task Group",
        entity_type="TaskGroup",
        entity_id=gid,
        action="DELETE",
        project_id=project_id,
        description=f"Đã xóa Task Cha '{tg_name}'"
    )
    db.commit()
    return {"ok": True}


@router.patch("/phases/{phid}/task-groups/reorder")
def reorder_task_groups(phid: int, body: dict, db: Session = Depends(get_db)):
    """Expects body: { "order": [gid1, gid2, gid3, ...] }"""
    order = body.get("order", [])
    for idx, gid in enumerate(order):
        tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
        if tg:
            tg.sort_order = idx
    db.commit()
    return {"ok": True}


@router.post("/phases/{phid}/task-groups/{gid}/move")
def move_task_group_to_phase(phid: int, gid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    target_phase_id = body.get("target_phase_id")
    if not target_phase_id:
        raise HTTPException(400, "target_phase_id is required.")
        
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
    if not tg:
        raise HTTPException(404, "Task group not found in this phase.")
        
    target_phase = db.query(Phase).filter(Phase.id == target_phase_id).first()
    if not target_phase:
        raise HTTPException(404, "Target Phase not found.")
    require_project(db, current_user, target_phase.project_id)
        
    max_order = db.query(sql_func.max(TaskGroup.sort_order)).filter(TaskGroup.phase_id == target_phase_id).scalar() or 0
    
    tg.phase_id = target_phase_id
    tg.sort_order = max_order + 1
    
    db.commit()
    db.refresh(tg)
    return serialize_task_group(tg, db)


# ═══════════════════════════════════════════════════════════
# TASK CRUD
# ═══════════════════════════════════════════════════════════

def safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def serialize_task(t, db):
    assigned_name = None
    support_name = None
    solution_name = None
    vendor_name = None

    try:
        if t.assigned_id:
            m = db.query(Member).filter(Member.id == t.assigned_id).first()
            assigned_name = m.display_name if m else None
    except Exception:
        pass

    try:
        if t.support_id:
            m = db.query(Member).filter(Member.id == t.support_id).first()
            support_name = m.display_name if m else None
    except Exception:
        pass

    try:
        if t.skill_solution_id:
            from ..models.skill_master import Group
            g = db.query(Group).filter(Group.id == t.skill_solution_id).first()
            solution_name = g.name if g else None
    except Exception:
        pass

    try:
        if t.skill_vendor_id:
            from ..models.skill_master import Skill
            s = db.query(Skill).filter(Skill.id == t.skill_vendor_id).first()
            vendor_name = s.name if s else None
    except Exception:
        pass

    return {
        "id": t.id,
        "task_group_id": t.task_group_id,
        "task_code": getattr(t, "task_code", None),
        "detail": t.detail,
        "priority": getattr(t, "priority", "Normal") or "Normal",
        "manday_est": safe_float(getattr(t, "manday_est", None)),
        "status": getattr(t, "status", "Waiting") or "Waiting",
        "start_date": str(t.start_date) if getattr(t, "start_date", None) else None,
        "assigned_id": getattr(t, "assigned_id", None),
        "assigned_name": assigned_name,
        "support_id": getattr(t, "support_id", None),
        "support_name": support_name,
        "kpi_ratio_assign": getattr(t, "kpi_ratio_assign", 90),
        "kpi_ratio_support": getattr(t, "kpi_ratio_support", 10),
        "skill_solution_id": getattr(t, "skill_solution_id", None),
        "skill_solution_name": solution_name,
        "skill_vendor_id": getattr(t, "skill_vendor_id", None),
        "skill_vendor_name": vendor_name,
        "ticket_id": getattr(t, "ticket_id", None),
        "remark": getattr(t, "remark", None),
        "send": getattr(t, "send", None),
        "sort_order": getattr(t, "sort_order", 0) or 0,
        # Computed
        "end_date_est": str(t.end_date_est) if getattr(t, "end_date_est", None) else None,
        "manday_actual": safe_float(getattr(t, "manday_actual", None)),
        "end_date_actual": str(t.end_date_actual) if getattr(t, "end_date_actual", None) else None,
        "days_late": getattr(t, "days_late", None),
        "kpi_base": safe_float(getattr(t, "kpi_base", 0)),
        "kpi_perform": safe_float(getattr(t, "kpi_perform", 0)),
        "kpi_ot": safe_float(getattr(t, "kpi_ot", 0)),
        "kpi_final": safe_float(getattr(t, "kpi_final", 0)),
        "kpi_assigned": safe_float(getattr(t, "kpi_assigned", 0)),
        "kpi_support": safe_float(getattr(t, "kpi_support", 0)),
        "notes": getattr(t, "notes", None),
        "solution": getattr(t, "solution", None),
        "ai_status": getattr(t, "ai_status", "NOT_CHECKED") or "NOT_CHECKED",
        "last_ai_check_at": str(t.last_ai_check_at) if getattr(t, "last_ai_check_at", None) else None,
        "last_ai_score": getattr(t, "last_ai_score", None),
        "last_review_id": getattr(t, "last_review_id", None),
        "created_at": str(t.created_at) if getattr(t, "created_at", None) else None,
    }


@router.get("/task-groups/{gid}/tasks")
def list_tasks(gid: int, db: Session = Depends(get_db)):
    try:
        tasks = db.query(Task).filter(Task.task_group_id == gid).order_by(Task.sort_order, Task.id).all()
        out = []
        for t in tasks:
            try:
                out.append(serialize_task(t, db))
            except Exception as e:
                print(f"Error serializing task {getattr(t, 'id', None)} in list_tasks: {e}")
        return out
    except Exception as exc:
        print(f"Error in list_tasks for gid {gid}: {exc}")
        return []


@router.get("/all-tasks-global")
def list_all_tasks_global(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Get all tasks across all projects in 1 single query to prevent DB connection pool exhaustion."""
    from ..models.project import Project
    from ..models.phase import Phase
    from ..models.task_group import TaskGroup
    from ..models.task import Task

    # Leader data scope: only tasks belonging to the Leader's Workspace.
    leader_scoped = (
        getattr(current_user, "role", None) == ROLE_LEADER
        and user_scope(current_user) != ALL_SCOPE
    )

    base_query = (
        db.query(Task, TaskGroup, Phase, Project)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .join(Project, Phase.project_id == Project.id)
    )
    if leader_scoped:
        scoped_project_ids = (
            project_query_for_user(db, current_user).with_entities(Project.id).subquery()
        )
        base_query = base_query.filter(Project.id.in_(scoped_project_ids))

    results = base_query.all()

    members = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}

    output = []
    found_task_ids = set()

    today = date.today()
    for task, tg, phase, project in results:
        try:
            t_dict = serialize_task(task, db)
            t_dict["name"] = task.detail or f"Task #{task.id}"
            t_dict["project_id"] = project.id
            t_dict["projectName"] = project.name
            t_dict["customerName"] = project.customer_name
            t_dict["year"] = project.year
            t_dict["task_group_name"] = tg.name
            t_dict["phase_name"] = phase.name
            t_dict["assigned_name"] = members.get(task.assigned_id, t_dict.get("assigned_name"))
            t_dict["support_name"] = members.get(task.support_id, t_dict.get("support_name"))
            
            # Compute days_late
            days_late = 0
            if task.status not in ["Done", "done", "Cancel", "cancel"] and task.end_date_est:
                if task.end_date_est < today:
                    days_late = (today - task.end_date_est).days
            t_dict["days_late"] = days_late
            
            output.append(t_dict)
            found_task_ids.add(task.id)
        except Exception as e:
            print(f"Error serializing task {getattr(task, 'id', None)}: {e}")

    # Fallback for any standalone tasks
    if not leader_scoped:
        all_tasks = db.query(Task).all()
        for task in all_tasks:
            if task.id not in found_task_ids:
                try:
                    t_dict = serialize_task(task, db)
                    t_dict["name"] = task.detail or f"Task #{task.id}"
                    t_dict["assigned_name"] = members.get(task.assigned_id, t_dict.get("assigned_name"))
                    t_dict["support_name"] = members.get(task.support_id, t_dict.get("support_name"))
                    output.append(t_dict)
                except Exception:
                    pass

    return output


@router.get("/projects/{pid}/all-tasks")
def list_all_project_tasks(pid: int, phase_id: int = None, db: Session = Depends(get_db)):
    """Get all tasks for a project, optionally filtered by phase. Used by Master view."""
    output = []
    found_task_ids = set()

    try:
        query = (
            db.query(Task, TaskGroup, Phase)
            .join(TaskGroup, Task.task_group_id == TaskGroup.id)
            .join(Phase, TaskGroup.phase_id == Phase.id)
            .filter(Phase.project_id == pid)
        )
        if phase_id:
            query = query.filter(Phase.id == phase_id)

        results = query.order_by(Phase.sort_order, TaskGroup.sort_order, Task.sort_order, Task.id).all()
        for task, tg, phase in results:
            try:
                t_dict = serialize_task(task, db)
                t_dict["task_group_name"] = tg.name
                t_dict["task_group_status"] = tg.status
                t_dict["phase_name"] = phase.name
                t_dict["phase_id"] = phase.id
                output.append(t_dict)
                found_task_ids.add(task.id)
            except Exception as e:
                print(f"Error serializing task {getattr(task, 'id', None)}: {e}")
    except Exception as exc:
        print(f"Error in primary list_all_project_tasks query for pid {pid}: {exc}")

    # Fallback: catch any tasks belonging to task groups in project's phases that weren't captured by join
    try:
        if not phase_id:
            phases = db.query(Phase).filter(Phase.project_id == pid).all()
            phase_map = {ph.id: ph for ph in phases}
            if phases:
                tgs = db.query(TaskGroup).filter(TaskGroup.phase_id.in_([ph.id for ph in phases])).all()
                tg_map = {g.id: g for g in tgs}
                if tgs:
                    all_tasks = db.query(Task).filter(Task.task_group_id.in_([g.id for g in tgs])).all()
                    for t in all_tasks:
                        if t.id not in found_task_ids:
                            try:
                                tg = tg_map.get(t.task_group_id)
                                ph = phase_map.get(tg.phase_id) if tg else None
                                t_dict = serialize_task(t, db)
                                t_dict["task_group_name"] = tg.name if tg else ""
                                t_dict["task_group_status"] = tg.status if tg else "Waiting"
                                t_dict["phase_name"] = ph.name if ph else ""
                                t_dict["phase_id"] = ph.id if ph else None
                                output.append(t_dict)
                            except Exception as e:
                                print(f"Error serializing fallback task {t.id}: {e}")
    except Exception as exc:
        print(f"Error in fallback list_all_project_tasks query for pid {pid}: {exc}")

    return output


@router.post("/task-groups/{gid}/tasks")
def create_task(gid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    if not tg:
        raise HTTPException(404, "Task Group not found.")

    detail = body.get("detail", "").strip()
    if not detail:
        raise HTTPException(400, "Detail task is required.")
    if len(detail) > 500:
        raise HTTPException(400, "Detail task max 500 characters.")

    # Auto task_code based on group_index
    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == gid).scalar() or 0
    group_index = get_group_index(tg, db)
    next_code = get_next_task_code(group_index, gid, db)

    # Validate manday_est
    manday_est = body.get("manday_est")
    if manday_est is not None:
        try:
            manday_est = float(manday_est)
            if manday_est < 0.25 or manday_est > 365:
                raise HTTPException(400, "Manday EST must be between 0.25 and 365.")
        except (ValueError, TypeError):
            raise HTTPException(400, "Manday EST must be a number.")

    # Validate assigned membership
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first()
    project_id = phase.project_id if phase else None

    assigned_id = body.get("assigned_id")
    support_id = body.get("support_id")

    if assigned_id and project_id:
        exists = db.execute(
            project_members.select().where(
                project_members.c.project_id == project_id,
                project_members.c.member_id == assigned_id
            )
        ).first()
        if not exists:
            raise HTTPException(400, "Assigned member must be a member of this project.")

    if support_id and project_id:
        exists = db.execute(
            project_members.select().where(
                project_members.c.project_id == project_id,
                project_members.c.member_id == support_id
            )
        ).first()
        if not exists:
            raise HTTPException(400, "Support member must be a member of this project.")

    if assigned_id and support_id and assigned_id == support_id:
        raise HTTPException(400, "Support cannot be the same as Assigned.")

    task_code = body.get("task_code", next_code)
    validate_manday_budget(gid, task_code, manday_est, db)
    ratio_assign, ratio_support = validate_kpi_ratio(
        body.get("kpi_ratio_assign", 100),
        body.get("kpi_ratio_support", 0),
    )

    task = Task(
        task_group_id=gid,
        task_code=task_code,
        detail=detail,
        priority=body.get("priority", "Normal"),
        manday_est=manday_est,
        status=body.get("status", "Waiting"),
        start_date=parse_date(body.get("start_date")),
        assigned_id=assigned_id,
        support_id=support_id,
        kpi_ratio_assign=ratio_assign,
        kpi_ratio_support=ratio_support,
        skill_solution_id=body.get("skill_solution_id"),
        skill_vendor_id=body.get("skill_vendor_id"),
        ticket_id=body.get("ticket_id"),
        remark=body.get("remark"),
        send=body.get("send"),
        notes=body.get("notes"),
        sort_order=max_order + 1,
    )
    db.add(task)
    db.flush()

    # Recalculate KPI
    task = recalculate_task(task, db)

    # Sync group start_date (min) and end_date_est (max) from child tasks
    tg = sync_group_dates(tg, db, extra_start=task.start_date, extra_end=task.end_date_est)
    tg = sync_group_actual_dates(tg, db)

    # Update group progress
    tg.progress = Decimal(str(calc_group_progress(gid, db)))

    db.commit()
    db.refresh(task)
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task",
        entity_type="Task",
        entity_id=task.id,
        action="CREATE",
        project_id=project_id,
        description=f"Tạo nhiệm vụ mới '{task.detail}' (Mã: {task.task_code})"
    )
    db.commit()
    return serialize_task(task, db)


@router.post("/task-groups/{gid}/tasks/{tid}/copy")
def copy_task(gid: int, tid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    source_task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not source_task:
        raise HTTPException(404, "Source task not found.")

    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    project_id = tg.phase.project_id if (tg and tg.phase) else None

    # Calculate max sort order and next code
    group_index = get_group_index(tg, db)
    next_code = get_next_task_code(group_index, gid, db)
    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == gid).scalar() or 0

    new_task = Task(
        task_group_id=gid,
        task_code=next_code,
        detail=f"{source_task.detail} (Copy)",
        priority=source_task.priority,
        manday_est=source_task.manday_est,
        status="Waiting",
        start_date=source_task.start_date,
        assigned_id=source_task.assigned_id,
        support_id=source_task.support_id,
        kpi_ratio_assign=source_task.kpi_ratio_assign,
        kpi_ratio_support=source_task.kpi_ratio_support,
        skill_solution_id=source_task.skill_solution_id,
        skill_vendor_id=source_task.skill_vendor_id,
        ticket_id=source_task.ticket_id,
        remark=source_task.remark,
        send=source_task.send,
        notes=source_task.notes,
        sort_order=max_order + 1,
    )
    db.add(new_task)
    db.flush()
    new_task = recalculate_task(new_task, db)

    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task",
        entity_type="Task",
        entity_id=new_task.id,
        action="COPY",
        project_id=project_id,
        old_value=source_task.task_code,
        new_value=new_task.task_code,
        description=f"Đã sao chép Task '{source_task.detail}' ({source_task.task_code}) → '{new_task.detail}' ({new_task.task_code})"
    )
    db.commit()
    return serialize_task(new_task, db)


@router.patch("/task-groups/{gid}/tasks/{tid}")
def update_task(gid: int, tid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")

    # Get project_id for member validation
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    # Snapshot old values for Audit Logs
    old_dict = {
        "detail": task.detail,
        "priority": task.priority,
        "status": task.status,
        "manday_est": task.manday_est,
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "end_date_actual": task.end_date_actual.isoformat() if task.end_date_actual else None,
        "assigned_id": task.assigned_id,
        "support_id": task.support_id,
        "kpi_ratio_assign": task.kpi_ratio_assign,
        "kpi_ratio_support": task.kpi_ratio_support,
        "ticket": getattr(task, "ticket", None),
        "remark": getattr(task, "remark", None),
        "notes": getattr(task, "notes", None),
    }

    # Detail validation
    if "detail" in body:
        if not body["detail"].strip():
            raise HTTPException(400, "Detail task is required.")
        if len(body["detail"]) > 500:
            raise HTTPException(400, "Detail task max 500 characters.")
        task.detail = body["detail"]

    # Priority
    if "priority" in body:
        if not body["priority"]:
            raise HTTPException(400, "Priority is required.")
        task.priority = body["priority"]

    # Manday EST
    if "manday_est" in body:
        val = body["manday_est"]
        if val is not None:
            try:
                val = float(val)
                if val < 0.25 or val > 365:
                    raise HTTPException(400, "Manday EST must be between 0.25 and 365.")
            except (ValueError, TypeError):
                raise HTTPException(400, "Manday EST must be a number.")
        task.manday_est = val

    is_parent_being_set_to_done = False
    if "status" in body and body["status"].strip().lower() == 'done':
        # A task is a parent if it has children (tasks with a more specific task_code)
        is_parent = db.query(Task).filter(
            Task.task_group_id == gid,
            Task.task_code.like(f"{task.task_code}.%")
        ).first() is not None
        if is_parent:
            is_parent_being_set_to_done = True

    # Status
    if "status" in body:
        task.status = body["status"]

    # Dates
    if "start_date" in body:
        task.start_date = parse_date(body["start_date"])
    
    if is_parent_being_set_to_done:
        task.end_date_actual = date.today()
    elif "end_date_actual" in body:
        if body["end_date_actual"]:
            # The status might not have been updated yet if it's not in the body, so check body first
            status_to_check = body.get("status", task.status)
            if status_to_check and status_to_check.strip().lower() not in ["done"]:
                raise HTTPException(400, "End Date Actual only available when Status = Done.")
        task.end_date_actual = parse_date(body["end_date_actual"])

    # Assigned / Support
    if "assigned_id" in body:
        task.assigned_id = body["assigned_id"]
    if "support_id" in body:
        task.support_id = body["support_id"]

    # Validate membership
    if task.assigned_id and project_id:
        exists = db.execute(
            project_members.select().where(
                project_members.c.project_id == project_id,
                project_members.c.member_id == task.assigned_id
            )
        ).first()
        if not exists:
            raise HTTPException(400, "Assigned member must be a member of this project.")

    if task.support_id and project_id:
        exists = db.execute(
            project_members.select().where(
                project_members.c.project_id == project_id,
                project_members.c.member_id == task.support_id
            )
        ).first()
        if not exists:
            raise HTTPException(400, "Support member must be a member of this project.")

    if task.assigned_id and task.support_id and task.assigned_id == task.support_id:
        raise HTTPException(400, "Support cannot be the same as Assigned.")

    # KPI Ratio
    if "kpi_ratio_assign" in body or "kpi_ratio_support" in body:
        ratio_assign, ratio_support = validate_kpi_ratio(
            body.get("kpi_ratio_assign", task.kpi_ratio_assign),
            body.get("kpi_ratio_support", task.kpi_ratio_support),
        )
        task.kpi_ratio_assign = ratio_assign
        task.kpi_ratio_support = ratio_support

    # Skill
    if "skill_solution_id" in body:
        task.skill_solution_id = body["skill_solution_id"]
    if "skill_vendor_id" in body:
        task.skill_vendor_id = body["skill_vendor_id"]

    # Other text fields
    for field in ["task_code", "ticket_id", "remark", "send", "notes"]:
        if field in body:
            setattr(task, field, body[field])

    # Sort order
    if "sort_order" in body:
        task.sort_order = body["sort_order"]

    if "manday_est" in body or "task_code" in body:
        validate_manday_budget(gid, task.task_code, task.manday_est, db, exclude_task_id=task.id)

    # Recalculate KPI
    task = recalculate_task(task, db)

    # Cascading recalculation for child tasks of this task
    if task.task_code:
        child_tasks = db.query(Task).filter(
            Task.task_group_id == gid,
            Task.task_code.like(f"{task.task_code}.%")
        ).all()
        # Sort hierarchically to calculate correct values for nested subtasks
        child_tasks = sorted(child_tasks, key=lambda t: t.task_code)
        for child in child_tasks:
            recalculate_task(child, db)

    # Flush changes to the DB so that queries in sync functions see the latest state
    db.flush()

    # Update group progress
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    if tg:
        tg.progress = Decimal(str(calc_group_progress(gid, db)))
        # Sync group start_date from earliest child task start_date
        tg = sync_group_dates(tg, db)
        tg = sync_group_actual_dates(tg, db)

    # Trigger Recheck logic: check if any trigger fields are present in the update payload
    trigger_fields = ["detail", "priority", "manday_est", "status", "start_date", "end_date_actual", "assigned_id", "support_id", "remark"]
    if any(f in body for f in trigger_fields):
        task.ai_status = "NEED_RECHECK"
        if phase:
            phase.ai_status = "NEED_RECHECK"
            project = db.query(Project).filter(Project.id == phase.project_id).first()
            if project:
                project.ai_status = "NEED_RECHECK"

    db.commit()
    db.refresh(task)

    new_dict = {
        "detail": task.detail,
        "priority": task.priority,
        "status": task.status,
        "manday_est": task.manday_est,
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "end_date_actual": task.end_date_actual.isoformat() if task.end_date_actual else None,
        "assigned_id": task.assigned_id,
        "support_id": task.support_id,
        "kpi_ratio_assign": task.kpi_ratio_assign,
        "kpi_ratio_support": task.kpi_ratio_support,
        "ticket": getattr(task, "ticket", None),
        "remark": getattr(task, "remark", None),
        "notes": getattr(task, "notes", None),
    }
    AuditService.record_diff(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task",
        entity_type="Task",
        entity_id=task.id,
        old_dict=old_dict,
        new_dict=new_dict,
        project_id=project_id,
        field_labels={
            "detail": "Nội dung Task",
            "priority": "Độ ưu tiên",
            "status": "Trạng thái",
            "manday_est": "Manday EST",
            "assigned_id": "Người thực hiện",
            "support_id": "Người hỗ trợ",
            "start_date": "Ngày bắt đầu",
            "end_date_actual": "Ngày hoàn thành",
            "kpi_ratio_assign": "Tỷ lệ KPI Assign",
            "kpi_ratio_support": "Tỷ lệ KPI Support",
            "ticket": "Mã Ticket",
            "remark": "Ghi chú Remark",
            "notes": "Ghi chú Note"
        }
    )
    db.commit()
    return serialize_task(task, db)


@router.delete("/task-groups/{gid}/tasks/{tid}")
def delete_task(gid: int, tid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")

    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    task_desc = f"Xóa nhiệm vụ [{task.task_code}] '{task.detail}'"
    db.delete(task)

    # Update group progress and sync start_date
    if tg:
        tg.progress = Decimal(str(calc_group_progress(gid, db)))
        tg = sync_group_dates(tg, db)
        tg = sync_group_actual_dates(tg, db)

    db.commit()
    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Task",
        entity_type="Task",
        entity_id=tid,
        action="DELETE",
        project_id=project_id,
        description=task_desc
    )
    db.commit()
    return {"ok": True}


@router.post("/task-groups/{gid}/tasks/{tid}/duplicate")
def duplicate_task(gid: int, tid: int, db: Session = Depends(get_db)):
    original = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not original:
        raise HTTPException(404, "Task not found.")

    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    group_index = get_group_index(tg, db) if tg else 1
    new_code = get_next_task_code(group_index, gid, db)
    validate_manday_budget(gid, new_code, original.manday_est, db)

    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == gid).scalar() or 0
    new_task = Task(
        task_group_id=gid,
        task_code=new_code,
        detail=original.detail + " (copy)",
        priority=original.priority,
        manday_est=original.manday_est,
        status="Waiting",
        start_date=original.start_date,
        assigned_id=original.assigned_id,
        support_id=original.support_id,
        kpi_ratio_assign=original.kpi_ratio_assign,
        kpi_ratio_support=original.kpi_ratio_support,
        skill_solution_id=original.skill_solution_id,
        skill_vendor_id=original.skill_vendor_id,
        ticket_id=original.ticket_id,
        notes=original.notes,
        sort_order=max_order + 1,
    )
    db.add(new_task)
    db.flush()
    new_task = recalculate_task(new_task, db)
    db.commit()
    db.refresh(new_task)
    return serialize_task(new_task, db)


@router.post("/task-groups/{gid}/tasks/{tid}/move")
def move_task(gid: int, tid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Move a task to a different task group. Auto-generates new task_code."""
    new_group_id = body.get("target_group_id")
    if not new_group_id:
        raise HTTPException(400, "target_group_id is required.")

    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")

    new_group = db.query(TaskGroup).filter(TaskGroup.id == new_group_id).first()
    if not new_group:
        raise HTTPException(404, "Target task group not found.")
    target_phase = db.query(Phase).filter(Phase.id == new_group.phase_id).first()
    if not target_phase:
        raise HTTPException(404, "Target phase not found.")
    require_project(db, current_user, target_phase.project_id)

    old_group_id = task.task_group_id
    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == new_group_id).scalar() or 0
    task.task_group_id = new_group_id
    task.sort_order = max_order + 1

    # Auto-generate new task_code for target group
    new_group_index = get_group_index(new_group, db)
    new_task_code = get_next_task_code(new_group_index, new_group_id, db)
    validate_manday_budget(new_group_id, new_task_code, task.manday_est, db, exclude_task_id=task.id)
    task.task_code = new_task_code

    # Update progress for both groups
    old_tg = db.query(TaskGroup).filter(TaskGroup.id == old_group_id).first()
    if old_tg:
        old_tg.progress = Decimal(str(calc_group_progress(old_group_id, db)))
    new_group.progress = Decimal(str(calc_group_progress(new_group_id, db)))

    db.commit()
    db.refresh(task)
    return serialize_task(task, db)


@router.patch("/task-groups/{gid}/tasks/reorder")
def reorder_tasks(gid: int, body: dict, db: Session = Depends(get_db)):
    """Expects body: { "order": [tid1, tid2, tid3, ...] }"""
    order = body.get("order", [])
    for idx, tid in enumerate(order):
        task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
        if task:
            task.sort_order = idx
    db.commit()
    return {"ok": True}
