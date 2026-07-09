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
from ..models.project import project_members
from ..utils.kpi_engine import recalculate_task, parse_date

router = APIRouter(tags=["task-groups-and-tasks"])


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
    task_count = db.query(Task).filter(Task.task_group_id == tg.id).count()
    done_count = db.query(Task).filter(
        Task.task_group_id == tg.id,
        Task.status.in_(["Done", "done"])
    ).count()
    if group_index is None:
        group_index = get_group_index(tg, db)
    return {
        "id": tg.id,
        "phase_id": tg.phase_id,
        "name": tg.name,
        "description": tg.description,
        "status": tg.status,
        "progress": float(tg.progress or 0),
        "sort_order": tg.sort_order,
        "group_index": group_index,
        "roman_index": to_roman(group_index),
        "manday_est": float(tg.manday_est) if tg.manday_est else None,
        "start_date_est": str(tg.start_date_est) if tg.start_date_est else None,
        "end_date_est": str(tg.end_date_est) if tg.end_date_est else None,
        "manday_actual": float(tg.manday_actual) if tg.manday_actual else None,
        "end_date_actual": str(tg.end_date_actual) if tg.end_date_actual else None,
        "task_count": task_count,
        "done_count": done_count,
        "created_at": str(tg.created_at) if tg.created_at else None,
    }


@router.get("/phases/{phid}/task-groups")
def list_task_groups(phid: int, db: Session = Depends(get_db)):
    groups = db.query(TaskGroup).filter(TaskGroup.phase_id == phid).order_by(TaskGroup.sort_order, TaskGroup.id).all()
    return [serialize_task_group(g, db, i + 1) for i, g in enumerate(groups)]


@router.post("/phases/{phid}/task-groups")
def create_task_group(phid: int, body: dict, db: Session = Depends(get_db)):
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
    return serialize_task_group(tg, db)


@router.patch("/phases/{phid}/task-groups/{gid}")
def update_task_group(phid: int, gid: int, body: dict, db: Session = Depends(get_db)):
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
    if not tg:
        raise HTTPException(404, "Task group not found.")

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
    tg = recalculate_task_group_dates(tg, db)

    new_status = tg.status

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
        elif new_status and new_status.strip().lower() == "done":
            # Commit KPI: recalculate to ensure values are final
            for t in tasks:
                recalculate_task(t, db)

    db.commit()
    db.refresh(tg)
    return serialize_task_group(tg, db)


@router.delete("/phases/{phid}/task-groups/{gid}")
def delete_task_group(phid: int, gid: int, db: Session = Depends(get_db)):
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
    if not tg:
        raise HTTPException(404, "Task group not found.")
    task_count = db.query(Task).filter(Task.task_group_id == gid).count()
    if task_count > 0:
        raise HTTPException(400, f"Không thể xóa Task Group vì còn {task_count} Task. Hãy xóa hết Task trước.")
    db.delete(tg)
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
def move_task_group_to_phase(phid: int, gid: int, body: dict, db: Session = Depends(get_db)):
    target_phase_id = body.get("target_phase_id")
    if not target_phase_id:
        raise HTTPException(400, "target_phase_id is required.")
        
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid, TaskGroup.phase_id == phid).first()
    if not tg:
        raise HTTPException(404, "Task group not found in this phase.")
        
    target_phase = db.query(Phase).filter(Phase.id == target_phase_id).first()
    if not target_phase:
        raise HTTPException(404, "Target Phase not found.")
        
    max_order = db.query(sql_func.max(TaskGroup.sort_order)).filter(TaskGroup.phase_id == target_phase_id).scalar() or 0
    
    tg.phase_id = target_phase_id
    tg.sort_order = max_order + 1
    
    db.commit()
    db.refresh(tg)
    return serialize_task_group(tg, db)


# ═══════════════════════════════════════════════════════════
# TASK CRUD
# ═══════════════════════════════════════════════════════════

def serialize_task(t, db):
    assigned_name = None
    support_name = None
    solution_name = None
    vendor_name = None

    if t.assigned_id:
        m = db.query(Member).filter(Member.id == t.assigned_id).first()
        assigned_name = m.display_name if m else None
    if t.support_id:
        m = db.query(Member).filter(Member.id == t.support_id).first()
        support_name = m.display_name if m else None
    if t.skill_solution_id:
        from ..models.skill_master import Group
        g = db.query(Group).filter(Group.id == t.skill_solution_id).first()
        solution_name = g.name if g else None
    if t.skill_vendor_id:
        from ..models.skill_master import Skill
        s = db.query(Skill).filter(Skill.id == t.skill_vendor_id).first()
        vendor_name = s.name if s else None

    return {
        "id": t.id,
        "task_group_id": t.task_group_id,
        "task_code": t.task_code,
        "detail": t.detail,
        "priority": t.priority,
        "manday_est": float(t.manday_est) if t.manday_est else None,
        "status": t.status,
        "start_date": str(t.start_date) if t.start_date else None,
        "assigned_id": t.assigned_id,
        "assigned_name": assigned_name,
        "support_id": t.support_id,
        "support_name": support_name,
        "kpi_ratio_assign": t.kpi_ratio_assign,
        "kpi_ratio_support": t.kpi_ratio_support,
        "skill_solution_id": t.skill_solution_id,
        "skill_solution_name": solution_name,
        "skill_vendor_id": t.skill_vendor_id,
        "skill_vendor_name": vendor_name,
        "ticket_id": t.ticket_id,
        "remark": t.remark,
        "send": t.send,
        "sort_order": t.sort_order,
        # Computed
        "end_date_est": str(t.end_date_est) if t.end_date_est else None,
        "manday_actual": float(t.manday_actual) if t.manday_actual else None,
        "end_date_actual": str(t.end_date_actual) if t.end_date_actual else None,
        "days_late": t.days_late,
        "kpi_base": float(t.kpi_base) if t.kpi_base else 0,
        "kpi_perform": float(t.kpi_perform) if t.kpi_perform else 0,
        "kpi_ot": float(t.kpi_ot) if t.kpi_ot else 0,
        "kpi_final": float(t.kpi_final) if t.kpi_final else 0,
        "kpi_assigned": float(t.kpi_assigned) if t.kpi_assigned else 0,
        "kpi_support": float(t.kpi_support) if t.kpi_support else 0,
        "notes": t.notes,
        "solution": t.solution,
        "created_at": str(t.created_at) if t.created_at else None,
    }


@router.get("/task-groups/{gid}/tasks")
def list_tasks(gid: int, db: Session = Depends(get_db)):
    tasks = db.query(Task).filter(Task.task_group_id == gid).order_by(Task.sort_order, Task.id).all()
    return [serialize_task(t, db) for t in tasks]


@router.get("/projects/{pid}/all-tasks")
def list_all_project_tasks(pid: int, phase_id: int = None, db: Session = Depends(get_db)):
    """Get all tasks for a project, optionally filtered by phase. Used by Master view."""
    query = (
        db.query(Task, TaskGroup, Phase)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .filter(Phase.project_id == pid)
    )
    if phase_id:
        query = query.filter(Phase.id == phase_id)

    query = query.order_by(Phase.sort_order, TaskGroup.sort_order, Task.sort_order, Task.id)
    results = query.all()

    output = []
    for task, tg, phase in results:
        t_dict = serialize_task(task, db)
        t_dict["task_group_name"] = tg.name
        t_dict["task_group_status"] = tg.status
        t_dict["phase_name"] = phase.name
        t_dict["phase_id"] = phase.id
        output.append(t_dict)
    return output


@router.post("/task-groups/{gid}/tasks")
def create_task(gid: int, body: dict, db: Session = Depends(get_db)):
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

    task = Task(
        task_group_id=gid,
        task_code=body.get("task_code", next_code),
        detail=detail,
        priority=body.get("priority", "Normal"),
        manday_est=manday_est,
        status=body.get("status", "Waiting"),
        start_date=parse_date(body.get("start_date")),
        assigned_id=assigned_id,
        support_id=support_id,
        kpi_ratio_assign=body.get("kpi_ratio_assign", 100),
        kpi_ratio_support=body.get("kpi_ratio_support", 0),
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

    # Update group progress
    tg.progress = Decimal(str(calc_group_progress(gid, db)))

    db.commit()
    db.refresh(task)
    return serialize_task(task, db)


@router.patch("/task-groups/{gid}/tasks/{tid}")
def update_task(gid: int, tid: int, body: dict, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")

    # Get project_id for member validation
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

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

    # Status
    if "status" in body:
        task.status = body["status"]

    # Dates
    if "start_date" in body:
        task.start_date = parse_date(body["start_date"])
    if "end_date_actual" in body:
        if body["end_date_actual"]:
            if task.status and task.status.strip().lower() not in ["done"]:
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
    if "kpi_ratio_assign" in body:
        task.kpi_ratio_assign = body["kpi_ratio_assign"]
    if "kpi_ratio_support" in body:
        task.kpi_ratio_support = body["kpi_ratio_support"]

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

    # Recalculate KPI
    task = recalculate_task(task, db)

    # Update group progress
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    if tg:
        tg.progress = Decimal(str(calc_group_progress(gid, db)))

    db.commit()
    db.refresh(task)
    return serialize_task(task, db)


@router.delete("/task-groups/{gid}/tasks/{tid}")
def delete_task(gid: int, tid: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")
    db.delete(task)

    # Update group progress
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    if tg:
        tg.progress = Decimal(str(calc_group_progress(gid, db)))

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
def move_task(gid: int, tid: int, body: dict, db: Session = Depends(get_db)):
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

    old_group_id = task.task_group_id
    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == new_group_id).scalar() or 0
    task.task_group_id = new_group_id
    task.sort_order = max_order + 1

    # Auto-generate new task_code for target group
    new_group_index = get_group_index(new_group, db)
    task.task_code = get_next_task_code(new_group_index, new_group_id, db)

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
