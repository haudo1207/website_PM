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
from ..models.user import User
from ..models.project import Project, project_members
from ..models.notification import Notification
from ..utils.kpi_engine import recalculate_task, parse_date
from ..utils.access import require_project, require_route_project_access, project_query_for_user, project_query_for_user_broad, user_scope, ALL_SCOPE, ROLE_LEADER, is_project_leader
from ..utils.auth import get_current_user
from ..utils.audit_service import AuditService
from ..services.zalo_task_parser import notify_task_done_if_zalo_linked
from ..services.document_storage import sync_task_link_documents, delete_task_link_documents
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


MAX_GROUP_MANDAY = 10


def validate_group_manday(manday_est) -> None:
    """Task Group MANDAY EST is capped at <= 10 going forward. Only checked
    against the incoming value on create/update — existing rows saved before
    this rule keep whatever value they already had, untouched."""
    if manday_est is not None and manday_est > MAX_GROUP_MANDAY:
        raise HTTPException(400, f"Manday EST của Task Group không được vượt quá {MAX_GROUP_MANDAY}.")


def validate_member_ids_for_project(ids, project_id: int, db: Session, label: str):
    """Dedup (preserve order) and confirm every id is a member of this
    project — mirrors the same check already done for Task assigned_id/
    support_id in create_task/update_task."""
    if not ids:
        return []
    deduped = list(dict.fromkeys(int(i) for i in ids))
    if project_id:
        valid_ids = {
            row.member_id for row in db.execute(
                project_members.select().where(
                    project_members.c.project_id == project_id,
                    project_members.c.member_id.in_(deduped),
                )
            ).all()
        }
        invalid = [i for i in deduped if i not in valid_ids]
        if invalid:
            raise HTTPException(400, f"{label}: thành viên {invalid} không thuộc dự án này.")
    return deduped


def add_to_group_list(tg, field: str, member_id) -> None:
    """Append member_id to tg.<field> (a JSON array of member ids) if not
    already present. Additive only — never removes an existing entry, even
    if the source task's assignee later changes."""
    if not member_id:
        return
    current = list(getattr(tg, field) or [])
    if member_id not in current:
        current.append(member_id)
        setattr(tg, field, current)


def get_group_index(tg, db) -> int:
    """Get 1-based index of this group within its phase (by sort_order)."""
    groups = db.query(TaskGroup).filter(
        TaskGroup.phase_id == tg.phase_id
    ).order_by(TaskGroup.sort_order, TaskGroup.id).all()
    for i, g in enumerate(groups):
        if g.id == tg.id:
            return i + 1
    return 1


def get_next_code_for_level(level_prefix: str, gid: int, db, exclude_task_id=None) -> str:
    """Generate the next sequence code at an arbitrary level — level_prefix is
    '{group_index}.' for root tasks or '{parent_code}.' for subtasks.
    exclude_task_id skips a task's own (possibly stale) row — needed when
    moving a task within its own group, where its old code is still sitting
    in the table under its own identity until the move finishes."""
    query = db.query(Task.id, Task.task_code).filter(Task.task_group_id == gid)
    if exclude_task_id is not None:
        query = query.filter(Task.id != exclude_task_id)
    max_seq = 0
    for (_id, code) in query.all():
        if not code or not code.startswith(level_prefix):
            continue
        rest = code[len(level_prefix):]
        if "." in rest:
            continue
        try:
            seq = int(rest)
            if seq > max_seq:
                max_seq = seq
        except ValueError:
            pass
    return f"{level_prefix}{max_seq + 1}"


def get_next_task_code(group_index: int, gid: int, db) -> str:
    """Generate next root-level task_code like '1.3' for group_index=1."""
    return get_next_code_for_level(f"{group_index}.", gid, db)


def get_own_seq(task_code: str):
    """Extract the trailing sequence number of a task_code, e.g. '1.3' -> 3, '1.2.1' -> 1."""
    if not task_code:
        return None
    try:
        return int(task_code.rsplit(".", 1)[-1])
    except ValueError:
        return None


def close_gap_after_removal(removed_code: str, gid: int, db: Session):
    """After a task with `removed_code` is gone from group `gid` (deleted or moved
    away), shift the sequence numbers of its remaining siblings down by 1 so the
    numbering stays contiguous, and cascade the renumbering to every descendant of
    each shifted sibling (they must keep following their parent's new code)."""
    parent_prefix = get_parent_code(removed_code)
    removed_seq = get_own_seq(removed_code)
    if not parent_prefix or removed_seq is None:
        return

    level_prefix = f"{parent_prefix}."
    candidates = db.query(Task).filter(
        Task.task_group_id == gid,
        Task.task_code.like(f"{level_prefix}%")
    ).all()

    # Only direct siblings at this exact level (no further "." after the prefix)
    siblings = []
    for t in candidates:
        rest = (t.task_code or "")[len(level_prefix):]
        if "." in rest:
            continue
        seq = get_own_seq(t.task_code)
        if seq is not None and seq > removed_seq:
            siblings.append((seq, t))

    # Ascending order: each new code frees up before the next sibling claims it
    siblings.sort(key=lambda pair: pair[0])

    for seq, sibling in siblings:
        old_code = sibling.task_code
        new_code = f"{level_prefix}{seq - 1}"
        sibling.task_code = new_code
        if old_code == new_code:
            continue
        old_desc_prefix = f"{old_code}."
        descendants = db.query(Task).filter(
            Task.task_group_id == gid,
            Task.task_code.like(f"{old_desc_prefix}%")
        ).all()
        for d in descendants:
            d.task_code = f"{new_code}." + d.task_code[len(old_desc_prefix):]


def open_gap_for_insertion(level_prefix: str, insert_seq: int, gid: int, db: Session, exclude_task_id=None):
    """Opposite of close_gap_after_removal: shift the sequence numbers of direct
    siblings at this level with seq >= insert_seq UP by 1, freeing up `insert_seq`
    for a new task, cascading the renumbering to every descendant of each shifted
    sibling. Must process from the HIGHEST sequence down so each vacated slot
    exists before the next (lower) sibling claims it.

    exclude_task_id skips a task's own (possibly stale) row — needed when
    moving a task within its own group: its old code is still sitting in the
    table under its own identity at this point, and would otherwise look like
    a second task occupying the same slot as whichever sibling now carries
    that number, corrupting the shift."""
    query = db.query(Task).filter(
        Task.task_group_id == gid,
        Task.task_code.like(f"{level_prefix}%")
    )
    if exclude_task_id is not None:
        query = query.filter(Task.id != exclude_task_id)
    candidates = query.all()

    siblings = []
    for t in candidates:
        rest = (t.task_code or "")[len(level_prefix):]
        if "." in rest:
            continue
        seq = get_own_seq(t.task_code)
        if seq is not None and seq >= insert_seq:
            siblings.append((seq, t))

    # Descending order: the highest sibling moves first, freeing its old slot
    siblings.sort(key=lambda pair: -pair[0])

    for seq, sibling in siblings:
        old_code = sibling.task_code
        new_code = f"{level_prefix}{seq + 1}"
        sibling.task_code = new_code
        if old_code == new_code:
            continue
        old_desc_prefix = f"{old_code}."
        descendants = db.query(Task).filter(
            Task.task_group_id == gid,
            Task.task_code.like(f"{old_desc_prefix}%")
        ).all()
        for d in descendants:
            d.task_code = f"{new_code}." + d.task_code[len(old_desc_prefix):]


def resync_group_sort_order(gid: int, db: Session):
    """Keep sort_order in lockstep with task_code's hierarchical display order
    (parent, then its own children in order, then the next sibling — exactly
    what a numeric tuple-compare of the dot-separated segments gives). Some
    read paths (list_tasks, the project-wide task export) order by sort_order
    directly instead of re-deriving the tree client-side like the main table
    does, so it must never drift out of sync after task_code gets shifted by
    an insert, delete, move, duplicate, or drag-and-drop reorder."""
    def sort_key(t):
        parts = []
        for p in (t.task_code or "").split("."):
            try:
                parts.append(int(p))
            except ValueError:
                parts.append(0)
        return parts

    tasks = db.query(Task).filter(Task.task_group_id == gid).all()
    tasks.sort(key=sort_key)
    for idx, t in enumerate(tasks):
        t.sort_order = idx


def resolve_insert_seq(level_prefix: str, after_code, before_code):
    """Turn the frontend's positional hint (insert after/before a given sibling
    code) into a concrete sequence number at this level. Falls back to "insert
    as the first item of this level" (seq=1) whenever the hint doesn't actually
    point at a direct sibling of this level (e.g. it points at the parent row
    itself, which happens when the user asks to insert above the very first
    child of a group). Returns None when there's no positional hint at all,
    meaning "append at the end" — the pre-existing default behavior."""
    def seq_if_sibling(code):
        if not code or not code.startswith(level_prefix):
            return None
        rest = code[len(level_prefix):]
        if "." in rest:
            return None
        return get_own_seq(code)

    if before_code:
        seq = seq_if_sibling(before_code)
        return seq if seq is not None else 1
    if after_code:
        seq = seq_if_sibling(after_code)
        return (seq + 1) if seq is not None else 1
    return None


def serialize_task_group(tg, db, group_index=None, members_map=None):
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

    assigned_ids = list(getattr(tg, "assigned_ids", None) or [])
    support_ids = list(getattr(tg, "support_ids", None) or [])

    def _resolve_names(ids):
        if not ids:
            return []
        if members_map is not None:
            return [members_map[i] for i in ids if i in members_map]
        rows = db.query(Member).filter(Member.id.in_(ids)).all()
        by_id = {m.id: (m.display_name or m.full_name) for m in rows}
        return [by_id[i] for i in ids if i in by_id]

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
        "assigned_ids": assigned_ids,
        "support_ids": support_ids,
        "assigned_names": _resolve_names(assigned_ids),
        "support_names": _resolve_names(support_ids),
    }


@router.get("/phases/{phid}/task-groups")
def list_task_groups(phid: int, db: Session = Depends(get_db)):
    try:
        groups = db.query(TaskGroup).filter(TaskGroup.phase_id == phid).order_by(TaskGroup.sort_order, TaskGroup.id).all()
        members_map = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}
        out = []
        for i, g in enumerate(groups):
            try:
                out.append(serialize_task_group(g, db, i + 1, members_map))
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
    validate_group_manday(manday_est)

    assigned_ids = validate_member_ids_for_project(body.get("assigned_ids"), phase.project_id, db, "Người thực hiện")
    support_ids = validate_member_ids_for_project(body.get("support_ids"), phase.project_id, db, "SP")

    max_order = db.query(sql_func.max(TaskGroup.sort_order)).filter(TaskGroup.phase_id == phid).scalar() or 0
    tg = TaskGroup(
        phase_id=phid,
        name=name,
        description=body.get("description"),
        status=body.get("status", "Waiting"),
        manday_est=manday_est,
        sort_order=max_order + 1,
        start_date_est=parse_date(body.get("start_date_est")),
        assigned_ids=assigned_ids,
        support_ids=support_ids,
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
        validate_group_manday(val)
        tg.manday_est = val
    if "start_date_est" in body:
        tg.start_date_est = parse_date(body["start_date_est"])
    if "end_date_actual_override" in body:
        tg.end_date_actual_override = parse_date(body["end_date_actual_override"])

    project_id = tg.phase.project_id if tg.phase else None
    if "assigned_ids" in body:
        tg.assigned_ids = validate_member_ids_for_project(body["assigned_ids"], project_id, db, "Người thực hiện")
    if "support_ids" in body:
        tg.support_ids = validate_member_ids_for_project(body["support_ids"], project_id, db, "SP")

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


def serialize_task(t, db, members_map=None, groups_map=None, skills_map=None, users_map=None, tasks_map=None):
    assigned_name = None
    support_name = None
    solution_name = None
    vendor_name = None

    def _resolve_user_name(user_id):
        if not user_id:
            return None
        if users_map is not None:
            return users_map.get(user_id)
        u = db.query(User).filter(User.id == user_id).first()
        return u.full_name if u else None

    def _resolve_blocking_task(task_id):
        """blocked_by_task_id chỉ là 1 self-reference đơn giản (chưa có bảng
        dependency thật) - trả (task_code, detail) để hiển thị 'Đang chờ: Task
        X', không phải cả object Task đầy đủ."""
        if not task_id:
            return None
        if tasks_map is not None:
            return tasks_map.get(task_id)
        bt = db.query(Task).filter(Task.id == task_id).first()
        return {"task_code": bt.task_code, "detail": bt.detail} if bt else None

    try:
        if t.assigned_id:
            if members_map is not None:
                assigned_name = members_map.get(t.assigned_id)
            else:
                m = db.query(Member).filter(Member.id == t.assigned_id).first()
                assigned_name = m.display_name if m else None
    except Exception:
        pass

    try:
        if t.support_id:
            if members_map is not None:
                support_name = members_map.get(t.support_id)
            else:
                m = db.query(Member).filter(Member.id == t.support_id).first()
                support_name = m.display_name if m else None
    except Exception:
        pass

    try:
        if t.skill_solution_id:
            if groups_map is not None:
                solution_name = groups_map.get(t.skill_solution_id)
            else:
                from ..models.skill_master import Group
                g = db.query(Group).filter(Group.id == t.skill_solution_id).first()
                solution_name = g.name if g else None
    except Exception:
        pass

    try:
        if t.skill_vendor_id:
            if skills_map is not None:
                vendor_name = skills_map.get(t.skill_vendor_id)
            else:
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
        # Review workflow - layer riêng, KHÔNG thay thế `status`.
        "review_status": getattr(t, "review_status", None),
        "review_requested_at": str(t.review_requested_at) if getattr(t, "review_requested_at", None) else None,
        "review_requested_by": getattr(t, "review_requested_by", None),
        "review_requested_by_name": _resolve_user_name(getattr(t, "review_requested_by", None)),
        "approved_at": str(t.approved_at) if getattr(t, "approved_at", None) else None,
        "approved_by": getattr(t, "approved_by", None),
        "approved_by_name": _resolve_user_name(getattr(t, "approved_by", None)),
        "change_requested_at": str(t.change_requested_at) if getattr(t, "change_requested_at", None) else None,
        "change_requested_by": getattr(t, "change_requested_by", None),
        "change_requested_by_name": _resolve_user_name(getattr(t, "change_requested_by", None)),
        "change_request_reason": getattr(t, "change_request_reason", None),
        "last_review_action_at": str(t.last_review_action_at) if getattr(t, "last_review_action_at", None) else None,
        # Blocking workflow - layer riêng, KHÔNG thay thế `status`.
        "is_blocked": bool(getattr(t, "is_blocked", False)),
        "blocked_at": str(t.blocked_at) if getattr(t, "blocked_at", None) else None,
        "blocked_by": getattr(t, "blocked_by", None),
        "blocked_by_name": _resolve_user_name(getattr(t, "blocked_by", None)),
        "blocked_reason": getattr(t, "blocked_reason", None),
        "blocked_by_task_id": getattr(t, "blocked_by_task_id", None),
        "blocked_by_task": _resolve_blocking_task(getattr(t, "blocked_by_task_id", None)),
        "unblocked_at": str(t.unblocked_at) if getattr(t, "unblocked_at", None) else None,
        "unblocked_by": getattr(t, "unblocked_by", None),
        "unblocked_by_name": _resolve_user_name(getattr(t, "unblocked_by", None)),
    }


@router.get("/task-groups/{gid}/tasks")
def list_tasks(gid: int, db: Session = Depends(get_db)):
    from ..models.skill_master import Group, Skill
    try:
        tasks = db.query(Task).filter(Task.task_group_id == gid).order_by(Task.sort_order, Task.id).all()
        members_map = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}
        groups_map = {g.id: g.name for g in db.query(Group).all()}
        skills_map = {s.id: s.name for s in db.query(Skill).all()}
        out = []
        for t in tasks:
            try:
                out.append(serialize_task(t, db, members_map, groups_map, skills_map))
            except Exception as e:
                print(f"Error serializing task {getattr(t, 'id', None)} in list_tasks: {e}")
        return out
    except Exception as exc:
        print(f"Error in list_tasks for gid {gid}: {exc}")
        return []


@router.get("/all-tasks-global")
def list_all_tasks_global(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Get all tasks across all projects in a fixed, small number of queries
    regardless of task count — avoids the previous N+1 (per-task Member/Group/
    Skill lookups inside serialize_task) that made this endpoint issue
    thousands of queries on a full task list."""
    from ..models.project import Project
    from ..models.phase import Phase
    from ..models.task_group import TaskGroup
    from ..models.task import Task
    from ..models.skill_master import Group, Skill

    # Leader data scope: only tasks belonging to the Leader's Workspace(s).
    # Deliberately uses the "broad" variant (blanket per-Workspace access,
    # not assignment-only) — this feeds Dashboard's team-wide KPI/task
    # totals, where a Leader needs the FULL picture of their team's
    # workload across every Workspace they're associated with (Chính AND
    # Phụ), even projects they personally aren't a member of. Opening a
    # specific project's own page is a separate, stricter check
    # (can_access_project) that still gates Phụ-Workspace projects to
    # assigned members only.
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
            project_query_for_user_broad(db, current_user).with_entities(Project.id).subquery()
        )
        base_query = base_query.filter(Project.id.in_(scoped_project_ids))

    results = base_query.all()

    members_map = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}
    groups_map = {g.id: g.name for g in db.query(Group).all()}
    skills_map = {s.id: s.name for s in db.query(Skill).all()}

    output = []
    found_task_ids = set()

    today = date.today()
    for task, tg, phase, project in results:
        try:
            t_dict = serialize_task(task, db, members_map, groups_map, skills_map)
            t_dict["name"] = task.detail or f"Task #{task.id}"
            t_dict["project_id"] = project.id
            t_dict["projectName"] = project.name
            t_dict["projectDataScope"] = project.data_scope
            t_dict["customerName"] = project.customer_name
            t_dict["year"] = project.year
            t_dict["task_group_name"] = tg.name
            t_dict["phase_name"] = phase.name

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

    # Fallback for any standalone tasks — filtered in SQL (id NOT IN), not a
    # full-table fetch-then-filter-in-Python like before.
    if not leader_scoped:
        remaining = (
            db.query(Task).filter(Task.id.notin_(found_task_ids)).all()
            if found_task_ids else db.query(Task).all()
        )
        for task in remaining:
            try:
                t_dict = serialize_task(task, db, members_map, groups_map, skills_map)
                t_dict["name"] = task.detail or f"Task #{task.id}"
                output.append(t_dict)
            except Exception:
                pass

    return output


@router.get("/all-tasks-global/summary")
def get_all_tasks_global_summary(db: Session = Depends(get_db)):
    """Server-side aggregates for Dashboard Overview instead of shipping every
    task row to the browser. Additive — /all-tasks-global is left untouched
    so the current Overview page keeps working unmodified; the frontend can
    migrate its per-leader/per-project rollups to this once ready."""
    from sqlalchemy import case

    today = date.today()
    done_expr = case((Task.status == "Done", 1), else_=0)
    overdue_expr = case(
        (
            (Task.status.notin_(["Done", "done", "Cancel", "cancel"]))
            & (Task.end_date_est.isnot(None))
            & (Task.end_date_est < today),
            1,
        ),
        else_=0,
    )

    by_status = {
        status or "Unknown": count
        for status, count in db.query(Task.status, sql_func.count(Task.id)).group_by(Task.status).all()
    }

    def member_rows(column):
        return (
            db.query(
                column,
                sql_func.count(Task.id),
                sql_func.sum(done_expr),
                sql_func.sum(overdue_expr),
                sql_func.sum(Task.manday_actual),
            )
            .filter(column.isnot(None))
            .group_by(column)
            .all()
        )

    by_member = {}
    for member_id, total, done, overdue, manday in member_rows(Task.assigned_id):
        row = by_member.setdefault(member_id, {
            "member_id": member_id,
            "assigned_total": 0, "assigned_done": 0, "assigned_overdue": 0,
            "support_total": 0, "support_done": 0, "support_overdue": 0,
            "manday_actual": 0.0,
        })
        row["assigned_total"] = total
        row["assigned_done"] = int(done or 0)
        row["assigned_overdue"] = int(overdue or 0)
        row["manday_actual"] += float(manday or 0)
    for member_id, total, done, overdue, manday in member_rows(Task.support_id):
        row = by_member.setdefault(member_id, {
            "member_id": member_id,
            "assigned_total": 0, "assigned_done": 0, "assigned_overdue": 0,
            "support_total": 0, "support_done": 0, "support_overdue": 0,
            "manday_actual": 0.0,
        })
        row["support_total"] = total
        row["support_done"] = int(done or 0)
        row["support_overdue"] = int(overdue or 0)
        row["manday_actual"] += float(manday or 0)

    project_rows = (
        db.query(Project.id, Project.name, sql_func.count(Task.id), sql_func.sum(done_expr))
        .select_from(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .join(Project, Phase.project_id == Project.id)
        .group_by(Project.id, Project.name)
        .all()
    )
    by_project = [
        {"project_id": pid, "name": name, "total": total, "done": int(done or 0)}
        for pid, name, total, done in project_rows
    ]

    return {
        "total_tasks": sum(by_status.values()),
        "by_status": by_status,
        "by_member": list(by_member.values()),
        "by_project": by_project,
    }


@router.get("/projects/{pid}/all-tasks")
def list_all_project_tasks(pid: int, phase_id: int = None, db: Session = Depends(get_db)):
    """Get all tasks for a project, optionally filtered by phase. Used by Master view.
    Batch-loads Member/Group/Skill once instead of letting serialize_task query
    them per task — this endpoint is opened every time a project is viewed."""
    from ..models.skill_master import Group, Skill

    output = []
    found_task_ids = set()
    members_map = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}
    groups_map = {g.id: g.name for g in db.query(Group).all()}
    skills_map = {s.id: s.name for s in db.query(Skill).all()}
    users_map = {u.id: u.full_name for u in db.query(User).all()}
    # blocked_by_task_id resolution - chỉ cần task_code/detail của các task
    # TRONG CHÍNH project này (blocking self-reference không xuyên project).
    tasks_map = {
        row.id: {"task_code": row.task_code, "detail": row.detail}
        for row in db.query(Task.id, Task.task_code, Task.detail)
            .join(TaskGroup, Task.task_group_id == TaskGroup.id)
            .join(Phase, TaskGroup.phase_id == Phase.id)
            .filter(Phase.project_id == pid)
            .all()
    }

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
                t_dict = serialize_task(task, db, members_map, groups_map, skills_map, users_map, tasks_map)
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
                                t_dict = serialize_task(t, db, members_map, groups_map, skills_map, users_map, tasks_map)
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

    # Position the new task: at a specific spot if the caller supplied one
    # (insert_after_code / insert_before_code — set whenever the user picked
    # "add above/below" a specific row or dropped it between two rows),
    # otherwise append at the end of this level like before.
    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == gid).scalar() or 0
    group_index = get_group_index(tg, db)
    parent_code = (body.get("parent_code") or "").strip() or None
    level_prefix = f"{parent_code}." if parent_code else f"{group_index}."
    insert_after_code = (body.get("insert_after_code") or "").strip() or None
    insert_before_code = (body.get("insert_before_code") or "").strip() or None
    insert_seq = resolve_insert_seq(level_prefix, insert_after_code, insert_before_code)
    if insert_seq is not None:
        open_gap_for_insertion(level_prefix, insert_seq, gid, db)
        next_code = f"{level_prefix}{insert_seq}"
    else:
        next_code = get_next_code_for_level(level_prefix, gid, db)

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

    # task_code is always server-computed now (see next_code above) — the
    # client only supplies positional hints (parent_code / insert_after_code /
    # insert_before_code), never the code itself, so numbering can't drift out
    # of sync with the actual position it was inserted at.
    task_code = next_code
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
        end_date_actual=parse_date(body.get("end_date_actual")),
        sort_order=max_order + 1,
    )
    # Safety net: a task created directly with status = Done (import/API
    # callers) still needs a completion date, otherwise it silently drops
    # out of the /api/members KPI aggregate (end_date_actual IS NOT NULL).
    if (task.status or "").strip().lower() == "done" and not task.end_date_actual:
        task.end_date_actual = date.today()
    db.add(task)
    db.flush()
    resync_group_sort_order(gid, db)

    # Recalculate KPI
    task = recalculate_task(task, db)

    # Mirror the LINK column into the Resources hub as an auto-managed link document
    if project_id is not None:
        sync_task_link_documents(
            db, task, project_id, phase.id if phase else None, getattr(current_user, "id", None),
            uploader_is_leader=is_project_leader(db, current_user, project_id),
        )

    # Sync group start_date (min) and end_date_est (max) from child tasks
    tg = sync_group_dates(tg, db, extra_start=task.start_date, extra_end=task.end_date_est)
    tg = sync_group_actual_dates(tg, db)

    # This task's assigned/support member joins the group's roster too
    # (additive, deduped — never removes an existing entry).
    add_to_group_list(tg, "assigned_ids", task.assigned_id)
    add_to_group_list(tg, "support_ids", task.support_id)

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

    if task.status == "Done":
        notify_task_done_if_zalo_linked(db, task, project_id)

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
        "review_status": task.review_status,
        "is_blocked": task.is_blocked,
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
        # Review workflow sync - CHỈ khi status thực sự chuyển VÀO/RA khỏi 1
        # status chứa "review" (edge, không phải mọi save trong lúc status vẫn
        # đang là Review) để không reset lịch sử approve/changes_requested đã
        # có mỗi lần task được sửa. Không tự đổi ngược task.status ở đây -
        # review_status là layer riêng, độc lập.
        new_status_l = (task.status or "").strip().lower()
        old_status_l = (old_dict["status"] or "").strip().lower()
        entered_review = "review" in new_status_l and "review" not in old_status_l
        left_review = "review" not in new_status_l and "review" in old_status_l
        if entered_review and task.review_status != "pending":
            task.review_status = "pending"
            task.review_requested_at = datetime.utcnow()
            task.review_requested_by = getattr(current_user, "id", None)
            task.last_review_action_at = datetime.utcnow()
        elif left_review and task.review_status == "pending":
            # Bị chuyển khỏi Review trước khi ai duyệt/yêu cầu sửa - bỏ cờ
            # pending (không phải attention nữa) nhưng KHÔNG đụng tới record
            # approved/changes_requested đã có (đó là lịch sử thật).
            task.review_status = None

        # Blocking workflow sync - cùng mô hình edge-detection với Review ở
        # trên: chỉ set/clear is_blocked khi status THỰC SỰ chuyển vào/ra khỏi
        # 1 status chứa "block", không đè lên block/unblock đã làm qua API
        # riêng (/block, /unblock) nếu status giữ nguyên không đổi.
        entered_blocked = "block" in new_status_l and "block" not in old_status_l
        left_blocked = "block" not in new_status_l and "block" in old_status_l
        if entered_blocked and not task.is_blocked:
            task.is_blocked = True
            task.blocked_at = datetime.utcnow()
            task.blocked_by = getattr(current_user, "id", None)
            task.blocked_reason = task.blocked_reason or "Chuyển Status sang trạng thái Blocked"
        elif left_blocked and task.is_blocked:
            task.is_blocked = False
            task.unblocked_at = datetime.utcnow()
            task.unblocked_by = getattr(current_user, "id", None)

    # Dates
    if "start_date" in body:
        task.start_date = parse_date(body["start_date"])
    
    new_status_lower = (task.status or "").strip().lower()
    old_status_lower = (old_dict["status"] or "").strip().lower()

    if is_parent_being_set_to_done:
        task.end_date_actual = date.today()
    elif "end_date_actual" in body:
        if body["end_date_actual"]:
            # The status might not have been updated yet if it's not in the body, so check body first
            status_to_check = body.get("status", task.status)
            if status_to_check and status_to_check.strip().lower() not in ["done"]:
                raise HTTPException(400, "End Date Actual only available when Status = Done.")
        task.end_date_actual = parse_date(body["end_date_actual"])
    elif new_status_lower == "done" and old_status_lower != "done":
        # Server-side safety net: stamp the completion date on every Done
        # transition even when the caller doesn't send end_date_actual
        # (duplicate/copy/import flows, direct API calls, or a future
        # frontend regression). Without this, the task's own kpi_final can
        # still compute, but /api/members' KPI aggregate requires
        # end_date_actual IS NOT NULL — so it silently drops out of the
        # member's KPI total while looking "Done" everywhere else.
        task.end_date_actual = date.today()
    elif new_status_lower != "done" and old_status_lower == "done":
        task.end_date_actual = None

    # Assigned / Support
    if "assigned_id" in body:
        task.assigned_id = body["assigned_id"]
    if "support_id" in body:
        task.support_id = body["support_id"]

    # Validate membership - CHỈ khi request này thực sự đổi assigned_id/
    # support_id. Trước đây check chạy vô điều kiện trên giá trị HIỆN TẠI của
    # task, nên 1 task đã gán cho người sau đó bị gỡ khỏi project_members (vd
    # đổi vai trò, xoá khỏi team) sẽ chặn luôn MỌI update khác của task đó
    # (kể cả chỉ đổi Status) với lỗi "Assigned member must be a member of this
    # project." dù người dùng không hề đụng tới field Assigned/Support.
    if "assigned_id" in body and task.assigned_id and project_id:
        exists = db.execute(
            project_members.select().where(
                project_members.c.project_id == project_id,
                project_members.c.member_id == task.assigned_id
            )
        ).first()
        if not exists:
            raise HTTPException(400, "Assigned member must be a member of this project.")

    if "support_id" in body and task.support_id and project_id:
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

    # This task's assigned/support member joins the parent group's roster
    # too (additive, deduped) whenever either was actually touched.
    if tg and ("assigned_id" in body or "support_id" in body):
        add_to_group_list(tg, "assigned_ids", task.assigned_id)
        add_to_group_list(tg, "support_ids", task.support_id)

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

    # Mirror the LINK column into the Resources hub as an auto-managed link document
    if project_id is not None and ("ticket_id" in body or "detail" in body):
        sync_task_link_documents(
            db, task, project_id, phase.id if phase else None, getattr(current_user, "id", None),
            uploader_is_leader=is_project_leader(db, current_user, project_id),
        )

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
        "review_status": task.review_status,
        "is_blocked": task.is_blocked,
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
            "notes": "Ghi chú Note",
            "review_status": "Trạng thái Review",
            "is_blocked": "Đang bị chặn",
        }
    )
    db.commit()

    if old_dict["status"] != "Done" and task.status == "Done":
        notify_task_done_if_zalo_linked(db, task, project_id)

    return serialize_task(task, db)


# ═══════════════════════════════════════════════════════════
# TASK REVIEW WORKFLOW (Leader Review: approve / request changes)
# review_status is a layer SEPARATE from `status` (tenant-configurable free
# text) — see models/task.py. Permission reuses is_project_leader (the same
# gate already used for approving/rejecting Resources), not a new role.
# ═══════════════════════════════════════════════════════════

def _notify_assignee(db: Session, task, current_user, message: str, notification_type: str):
    """Best-effort notify: task.assigned_id is a Member id, Notification.recipient_id
    is a Users id — resolve the Member's own login account (User.member_id) and
    skip silently if that Member has no User account (e.g. no login yet)."""
    if not task.assigned_id:
        return
    recipient = db.query(User).filter(User.member_id == task.assigned_id).first()
    if not recipient or recipient.id == getattr(current_user, "id", None):
        return
    try:
        db.add(Notification(
            recipient_id=recipient.id,
            sender_id=getattr(current_user, "id", None),
            task_id=task.id,
            message=message,
            notification_type=notification_type,
            is_read=False,
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Error creating review notification for task {task.id}: {e}")


@router.post("/task-groups/{gid}/tasks/{tid}/approve")
def approve_task(gid: int, tid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    if not is_project_leader(db, current_user, project_id):
        raise HTTPException(403, "Bạn không có quyền duyệt task này.")
    if task.review_status != "pending":
        raise HTTPException(400, "Task hiện không ở trạng thái chờ review nên không thể duyệt.")

    old_review_status = task.review_status
    old_status = task.status
    now = datetime.utcnow()
    task.review_status = "approved"
    task.approved_by = getattr(current_user, "id", None)
    task.approved_at = now
    task.last_review_action_at = now

    # Duyệt = leader xác nhận task đã xong -> chuyển thẳng sang Done (theo yêu
    # cầu business đã chốt), mirror đúng các side-effect mà update_task làm khi
    # status chuyển sang Done (stamp end_date_actual, recalc KPI/manday của
    # task + cascade con, cập nhật progress của group, notify Zalo nếu có).
    became_done = (old_status or "").strip().lower() != "done"
    if became_done:
        task.status = "Done"
        if not task.end_date_actual:
            task.end_date_actual = date.today()

    db.commit()
    db.refresh(task)

    if became_done:
        task = recalculate_task(task, db)
        if task.task_code:
            child_tasks = db.query(Task).filter(
                Task.task_group_id == gid,
                Task.task_code.like(f"{task.task_code}.%")
            ).all()
            for child in sorted(child_tasks, key=lambda c: c.task_code):
                recalculate_task(child, db)
        db.flush()
        if tg:
            tg.progress = Decimal(str(calc_group_progress(gid, db)))
            tg = sync_group_dates(tg, db)
            tg = sync_group_actual_dates(tg, db)
        db.commit()
        db.refresh(task)

    actor_name = getattr(current_user, "full_name", None) or getattr(current_user, "email", "Một quản lý")
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Task", entity_type="Task",
        entity_id=task.id, action="APPROVE", project_id=project_id,
        field_name="review_status", old_value=old_review_status, new_value="approved",
        description=f"{actor_name} đã duyệt task '{task.detail}'" + (" và chuyển sang Done" if became_done else ""),
    )
    if became_done:
        AuditService.record(
            db=db, user_id=getattr(current_user, "id", None), module="Task", entity_type="Task",
            entity_id=task.id, action="UPDATE", project_id=project_id,
            field_name="status", old_value=old_status, new_value="Done",
            description=f"{actor_name} đã chuyển trạng thái task '{task.detail}' sang Done (do duyệt review)",
        )
    _notify_assignee(db, task, current_user, f"{actor_name} đã duyệt task '{task.detail}'.", "task_review_approved")
    if became_done:
        notify_task_done_if_zalo_linked(db, task, project_id)

    return serialize_task(task, db)


@router.post("/task-groups/{gid}/tasks/{tid}/request-changes")
def request_task_changes(gid: int, tid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    reason = (body.get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(400, "Vui lòng nhập lý do yêu cầu sửa (tối thiểu 5 ký tự).")
    if len(reason) > 1000:
        raise HTTPException(400, "Lý do yêu cầu sửa tối đa 1000 ký tự.")

    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    if not is_project_leader(db, current_user, project_id):
        raise HTTPException(403, "Bạn không có quyền yêu cầu sửa task này.")
    if task.review_status != "pending":
        raise HTTPException(400, "Task hiện không ở trạng thái chờ review nên không thể yêu cầu sửa.")

    old_review_status = task.review_status
    now = datetime.utcnow()
    task.review_status = "changes_requested"
    task.change_requested_by = getattr(current_user, "id", None)
    task.change_requested_at = now
    task.change_request_reason = reason
    task.last_review_action_at = now
    db.commit()
    db.refresh(task)

    actor_name = getattr(current_user, "full_name", None) or getattr(current_user, "email", "Một quản lý")
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Task", entity_type="Task",
        entity_id=task.id, action="REQUEST_CHANGES", project_id=project_id,
        field_name="review_status", old_value=old_review_status, new_value="changes_requested",
        description=f"{actor_name} đã yêu cầu sửa task '{task.detail}': {reason}",
    )
    _notify_assignee(db, task, current_user, f"{actor_name} yêu cầu sửa task '{task.detail}': {reason}", "task_review_changes_requested")

    return serialize_task(task, db)


@router.post("/task-groups/{gid}/tasks/{tid}/request-review")
def request_task_review(gid: int, tid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Đưa task vào lại hàng đợi review (review_status='pending') mà KHÔNG cần
    đổi task.status qua lại (status='Review' -> khác -> lại 'Review') như
    update_task's edge-detection yêu cầu - trực tiếp hơn cho việc gửi lại
    review sau khi đã sửa xong theo yêu cầu. KHÔNG xoá approved_at/
    change_requested_at/change_request_reason cũ - đó là lịch sử, giữ nguyên
    để hiển thị "từng bị yêu cầu sửa" ngay cả khi đang pending trở lại."""
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    if not is_project_leader(db, current_user, project_id):
        raise HTTPException(403, "Bạn không có quyền gửi task này để review.")
    if task.review_status == "pending":
        raise HTTPException(400, "Task đã đang ở trạng thái chờ review.")

    old_review_status = task.review_status
    now = datetime.utcnow()
    task.review_status = "pending"
    task.review_requested_at = now
    task.review_requested_by = getattr(current_user, "id", None)
    task.last_review_action_at = now
    db.commit()
    db.refresh(task)

    actor_name = getattr(current_user, "full_name", None) or getattr(current_user, "email", "Một quản lý")
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Task", entity_type="Task",
        entity_id=task.id, action="REQUEST_REVIEW", project_id=project_id,
        field_name="review_status", old_value=old_review_status, new_value="pending",
        description=f"{actor_name} đã gửi lại task '{task.detail}' để review",
    )

    return serialize_task(task, db)


# ═══════════════════════════════════════════════════════════
# TASK BLOCKING WORKFLOW (Leader Review: block / unblock)
# is_blocked là layer riêng, tách khỏi `status`. Permission: KHÔNG dùng
# is_project_leader như Review - block/unblock là hành động "báo cáo trạng
# thái công việc", cùng cấp quyền với sửa task thường (chỉ router-level
# require_route_project_access, không role gate thêm) - audit update_task xác
# nhận nó cũng không có role gate nào ngoài project membership.
# ═══════════════════════════════════════════════════════════

@router.post("/task-groups/{gid}/tasks/{tid}/block")
def block_task(gid: int, tid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    reason = (body.get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(400, "Vui lòng nhập lý do bị chặn (tối thiểu 5 ký tự).")
    if len(reason) > 1000:
        raise HTTPException(400, "Lý do bị chặn tối đa 1000 ký tự.")

    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    blocked_by_task_id = body.get("blocked_by_task_id")
    blocking_task = None
    if blocked_by_task_id:
        blocking_task = db.query(Task).filter(Task.id == blocked_by_task_id).first()
        if not blocking_task:
            raise HTTPException(400, "Task phụ thuộc không tồn tại.")
        bt_tg = db.query(TaskGroup).filter(TaskGroup.id == blocking_task.task_group_id).first()
        bt_phase = db.query(Phase).filter(Phase.id == bt_tg.phase_id).first() if bt_tg else None
        if not bt_phase or bt_phase.project_id != project_id:
            raise HTTPException(400, "Task phụ thuộc phải thuộc cùng project.")
        if blocking_task.id == task.id:
            raise HTTPException(400, "Task không thể phụ thuộc chính nó.")

    old_is_blocked = task.is_blocked
    now = datetime.utcnow()
    task.is_blocked = True
    task.blocked_at = now
    task.blocked_by = getattr(current_user, "id", None)
    task.blocked_reason = reason
    task.blocked_by_task_id = blocking_task.id if blocking_task else None
    db.commit()
    db.refresh(task)

    actor_name = getattr(current_user, "full_name", None) or getattr(current_user, "email", "Một thành viên")
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Task", entity_type="Task",
        entity_id=task.id, action="BLOCK_TASK", project_id=project_id,
        field_name="is_blocked", old_value=str(old_is_blocked), new_value="True",
        description=f"{actor_name} đánh dấu task '{task.detail}' bị chặn: {reason}"
                    + (f" (phụ thuộc task '{blocking_task.detail}')" if blocking_task else ""),
    )
    _notify_assignee(db, task, current_user, f"{actor_name} đánh dấu task '{task.detail}' bị chặn: {reason}", "task_blocked")
    if blocking_task:
        _notify_assignee(
            db, blocking_task, current_user,
            f"Task '{blocking_task.detail}' đang được xem là điều kiện chặn task '{task.detail}' ({actor_name} đánh dấu).",
            "task_blocking_dependency",
        )

    return serialize_task(task, db)


@router.post("/task-groups/{gid}/tasks/{tid}/unblock")
def unblock_task(gid: int, tid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")
    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    if not task.is_blocked:
        raise HTTPException(400, "Task hiện không bị block.")

    old_is_blocked = task.is_blocked
    now = datetime.utcnow()
    task.is_blocked = False
    task.unblocked_at = now
    task.unblocked_by = getattr(current_user, "id", None)
    # Giữ nguyên blocked_at/blocked_by/blocked_reason/blocked_by_task_id -
    # đó là lịch sử ("từng bị chặn"), không xoá (mirror change_request_reason
    # ở Review workflow).
    db.commit()
    db.refresh(task)

    actor_name = getattr(current_user, "full_name", None) or getattr(current_user, "email", "Một thành viên")
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Task", entity_type="Task",
        entity_id=task.id, action="UNBLOCK_TASK", project_id=project_id,
        field_name="is_blocked", old_value=str(old_is_blocked), new_value="False",
        description=f"{actor_name} đã gỡ chặn task '{task.detail}'",
    )
    _notify_assignee(db, task, current_user, f"{actor_name} đã gỡ chặn task '{task.detail}'.", "task_unblocked")

    return serialize_task(task, db)


@router.delete("/task-groups/{gid}/tasks/{tid}")
def delete_task(gid: int, tid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == tid, Task.task_group_id == gid).first()
    if not task:
        raise HTTPException(404, "Task not found.")

    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    phase = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
    project_id = phase.project_id if phase else None

    removed_code = task.task_code

    # Cascade-delete every descendant (child, grandchild, ...) of this task
    descendant_count = 0
    descendants = []
    if removed_code:
        descendants = db.query(Task).filter(
            Task.task_group_id == gid,
            Task.task_code.like(f"{removed_code}.%")
        ).all()
        descendant_count = len(descendants)
        for d in descendants:
            db.delete(d)

    task_desc = f"Xóa nhiệm vụ [{removed_code}] '{task.detail}'"
    if descendant_count:
        task_desc += f" (kèm {descendant_count} task con)"

    delete_task_link_documents(db, [tid] + [d.id for d in descendants])
    db.delete(task)
    db.flush()

    # Close the numbering gap so remaining siblings (and their descendants) stay contiguous
    if removed_code:
        close_gap_after_removal(removed_code, gid, db)
        resync_group_sort_order(gid, db)

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
    # Duplicate a subtask into the same parent's level, not the group root.
    parent_code = get_parent_code(original.task_code)
    level_prefix = f"{parent_code}." if parent_code and db.query(Task).filter(
        Task.task_group_id == gid, Task.task_code == parent_code
    ).first() else f"{group_index}."
    new_code = get_next_code_for_level(level_prefix, gid, db)
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
    resync_group_sort_order(gid, db)
    new_task = recalculate_task(new_task, db)
    db.commit()
    db.refresh(new_task)
    return serialize_task(new_task, db)


@router.post("/task-groups/{gid}/tasks/{tid}/move")
def move_task(gid: int, tid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Move a task — within its own group, to a different group in the same
    Phase, or to a group in a different Phase entirely (a task's Phase is
    just whatever Phase its Task Group belongs to, so moving groups already
    moves Phases). Optionally at a precise root-level position
    (insert_after_task_id / insert_before_task_id — the DB id, never the
    mutable display code, of a task in the TARGET group; e.g. picked via the
    "Move Task" modal's position dropdown, or the row being dropped on during
    drag-and-drop). Defaults to appending at the end of the target group when
    no position is given."""
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
    old_code = task.task_code
    same_group = new_group_id == old_group_id

    # Snapshot the sub-tree before mutating this task's own group/code
    descendants = []
    if old_code:
        descendants = db.query(Task).filter(
            Task.task_group_id == old_group_id,
            Task.task_code.like(f"{old_code}.%")
        ).all()

    if same_group and old_code:
        # Free the task's own slot FIRST, via identity (its own row is never
        # touched by this — only strictly-later siblings shift down), so the
        # position resolved just below reflects the OTHER tasks' real current
        # codes rather than a layout that still counts this task's old spot.
        close_gap_after_removal(old_code, old_group_id, db)
        db.flush()

    # Position in the target group. Anchors are DB ids, resolved to their
    # CURRENT code only now (after the same-group gap-close above, if any) —
    # never trust a code string handed in from before this request started,
    # since same-group siblings may have just shifted.
    new_group_index = get_group_index(new_group, db)
    level_prefix = f"{new_group_index}."

    def anchor_code(anchor_task_id):
        if not anchor_task_id or anchor_task_id == tid:
            return None
        t = db.query(Task).filter(Task.id == anchor_task_id, Task.task_group_id == new_group_id).first()
        return t.task_code if t else None

    insert_after_code = anchor_code(body.get("insert_after_task_id"))
    insert_before_code = anchor_code(body.get("insert_before_task_id"))
    insert_seq = resolve_insert_seq(level_prefix, insert_after_code, insert_before_code)
    if insert_seq is not None:
        open_gap_for_insertion(level_prefix, insert_seq, new_group_id, db, exclude_task_id=task.id)
        new_task_code = f"{level_prefix}{insert_seq}"
    else:
        new_task_code = get_next_code_for_level(level_prefix, new_group_id, db, exclude_task_id=task.id)
    validate_manday_budget(new_group_id, new_task_code, task.manday_est, db, exclude_task_id=task.id)

    max_order = db.query(sql_func.max(Task.sort_order)).filter(Task.task_group_id == new_group_id).scalar() or 0
    task.task_group_id = new_group_id
    task.sort_order = max_order + 1
    task.task_code = new_task_code

    # Bring the whole sub-tree along, rewritten under the new parent code
    if old_code and descendants:
        old_prefix = f"{old_code}."
        new_prefix = f"{new_task_code}."
        for d in descendants:
            d.task_group_id = new_group_id
            d.task_code = new_prefix + d.task_code[len(old_prefix):]

    db.flush()

    # Cross-group: close the numbering gap left behind in the source group.
    # Same-group: already closed above, before the new position was resolved.
    if not same_group and old_code:
        close_gap_after_removal(old_code, old_group_id, db)
        resync_group_sort_order(old_group_id, db)
    resync_group_sort_order(new_group_id, db)

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
    """Expects body: { "order": [tid1, tid2, tid3, ...] } — the full new
    flattened order of every task in this group (parents and children
    interleaved as displayed). The frontend renders/sorts tasks by task_code,
    not sort_order, so a drag-and-drop reorder must renumber task_code to
    match the new order — otherwise the reorder has no visible effect after
    reload (sort_order alone silently drifts out of sync with the display)."""
    order = body.get("order", [])
    if not order:
        return {"ok": True}

    tg = db.query(TaskGroup).filter(TaskGroup.id == gid).first()
    group_index = get_group_index(tg, db) if tg else 1

    tasks_by_id = {
        t.id: t for t in db.query(Task).filter(Task.task_group_id == gid, Task.id.in_(order)).all()
    }
    ordered_tasks = [tasks_by_id[tid] for tid in order if tid in tasks_by_id]
    if not ordered_tasks:
        return {"ok": True}

    # Nesting doesn't change via this drag — only the relative order of
    # siblings within each level does. Parentage must be pinned by stable
    # object identity (task.id) up front, captured from the ORIGINAL codes,
    # because string prefixes shift as siblings get renumbered below.
    original_code_by_id = {t.id: t.task_code for t in ordered_tasks}
    task_by_original_code = {
        code: t for t in ordered_tasks if (code := original_code_by_id[t.id])
    }
    depth_by_id = {
        t.id: (original_code_by_id[t.id] or "").count(".") for t in ordered_tasks
    }

    def original_parent_id(t):
        parent_code = get_parent_code(original_code_by_id[t.id])
        parent_task = task_by_original_code.get(parent_code)
        return parent_task.id if parent_task else None

    buckets = {}
    for t in ordered_tasks:
        buckets.setdefault(original_parent_id(t), []).append(t)

    new_code_by_id = {}

    def new_prefix_for(pid):
        if pid is None:
            return f"{group_index}."
        return f"{new_code_by_id[pid]}."

    # Process shallowest levels first so a parent's new code is finalized
    # before its children's bucket computes its new prefix from it.
    for pid in sorted(buckets.keys(), key=lambda k: depth_by_id[k] if k is not None else -1):
        prefix = new_prefix_for(pid)
        for seq, t in enumerate(buckets[pid], start=1):
            new_code_by_id[t.id] = f"{prefix}{seq}"

    for t in ordered_tasks:
        new_code = new_code_by_id.get(t.id)
        if new_code and t.task_code != new_code:
            t.task_code = new_code

    db.flush()
    resync_group_sort_order(gid, db)

    db.commit()
    return {"ok": True}
