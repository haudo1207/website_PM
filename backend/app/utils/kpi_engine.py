"""
KPI Calculation Engine for Task Management.

Centralizes all KPI formulas so they can be updated independently
when Remark/Send settings are configured later.

Recalculation Flow:
    Priority + Manday EST → KPI Base
    KPI Base + Days Late  → KPI Perform
    Remark               → KPI OT
    KPI Base + Perform + OT = KPI Final
    KPI Final × Ratio → KPI Assigned / KPI Support
"""
import datetime
import math
from decimal import Decimal


def parse_date(date_str):
    """Parse various date formats to a date object."""
    if not date_str:
        return None
    if isinstance(date_str, (datetime.date, datetime.datetime)):
        return date_str if isinstance(date_str, datetime.date) else date_str.date()
    date_str = str(date_str).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y"):
        try:
            return datetime.datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return None


def format_date(dt):
    """Format date to dd/MM/yyyy."""
    if not dt:
        return ""
    return dt.strftime("%d/%m/%Y")


def get_priority_kpi_base(priority_name: str, db) -> int:
    """Look up KPI base value from task_priorities table."""
    from ..models.system_category import TaskPriority
    if not priority_name:
        return 6  # default Normal
    prio = db.query(TaskPriority).filter(
        TaskPriority.name.ilike(priority_name.strip())
    ).first()
    if prio:
        return prio.kpi_base
    # Fallback aliases
    aliases = {
        "normal": ["normal", "medium"],
        "high": ["high"],
        "critical": ["critical", "urgent"],
        "interrupt": ["interrupt"],
    }
    for canonical, names in aliases.items():
        if priority_name.strip().lower() in names:
            prio = db.query(TaskPriority).filter(
                TaskPriority.name.ilike(canonical)
            ).first()
            if prio:
                return prio.kpi_base
    return 6  # safe default


def calc_end_date_est(start_date, manday_est) -> datetime.date:
    """5.15: End Date EST = Start Date + CEIL(Manday EST) - 1"""
    if not start_date or not manday_est:
        return None
    try:
        days_to_add = max(0, math.ceil(float(manday_est)) - 1)
        return start_date + datetime.timedelta(days=days_to_add)
    except (ValueError, TypeError):
        return None


def calc_manday_actual(status: str, start_date, end_date_actual):
    """5.16: Manday Actual = Status==Done ? EndActual - Start + 1 : NULL"""
    if not status or status.strip().lower() != "done":
        return None
    if not start_date or not end_date_actual:
        return None
    try:
        delta = (end_date_actual - start_date).days + 1
        return max(1, delta)
    except (TypeError, AttributeError):
        return None


def calc_days_late(status: str, end_date_est, end_date_actual, today=None):
    """
    5.18: Days Late formula:
    - Missing data → NULL
    - Cancel → -1
    - Done → End Actual - End EST
    - Not Done & Today <= End EST → -1 (ahead of schedule)
    - Not Done & Today > End EST → Today - End EST (overdue)
    """
    if today is None:
        today = datetime.date.today()

    if not status:
        return None

    status_lower = status.strip().lower()

    if status_lower == "cancel":
        return -1

    if status_lower == "done":
        if not end_date_est or not end_date_actual:
            return None
        return (end_date_actual - end_date_est).days

    # Status is Waiting, Process, Rework, To Do, etc.
    if not end_date_est:
        return None

    if today <= end_date_est:
        return -1  # ahead of schedule
    else:
        return (today - end_date_est).days  # overdue


def calc_kpi_base(priority_kpi: int, manday_est) -> Decimal:
    """5.19: KPI Base = Priority.kpi_base × Manday EST"""
    if not manday_est or not priority_kpi:
        return Decimal("0")
    try:
        return Decimal(str(priority_kpi)) * Decimal(str(manday_est))
    except (ValueError, TypeError):
        return Decimal("0")


def calc_kpi_perform(days_late, kpi_base, manday_est, manday_actual, priority_name: str, remark: str = None):
    """
    5.20: KPI Perform — depends on Days Late.
    
    Current default logic (will be refined when Remark setting is configured):
    - Days Late < 0 (early): bonus = abs(days_late) per day
    - Days Late == 0 (on time): 0
    - Days Late > 0 (late): penalty = -days_late per day
    """
    if days_late is None:
        return Decimal("0")

    # Remark-based adjustments will be added here later
    # when Setting → Remark is configured
    
    if days_late < 0:
        # Early completion bonus: 1 point per day early, capped at kpi_base
        bonus = min(abs(days_late), int(kpi_base) if kpi_base else 0)
        return Decimal(str(bonus))
    elif days_late == 0:
        return Decimal("0")
    else:
        # Late penalty: -1 point per day late
        return Decimal(str(-days_late))


def calc_kpi_ot(remark: str = None, priority_name: str = None):
    """
    5.21: KPI OT — depends on Remark + Priority.
    
    Current placeholder logic (will be refined when Remark setting is configured):
    - If remark contains 'OT': add bonus based on priority
    """
    if not remark:
        return Decimal("0")

    remark_lower = remark.strip().lower()

    # Simple OT detection — will be replaced with Setting-driven logic later
    if "ot" in remark_lower or "overtime" in remark_lower:
        # OT bonus depends on priority
        priority_bonuses = {
            "normal": 3,
            "high": 6,
            "critical": 10,
            "interrupt": 3,
        }
        pname = (priority_name or "normal").strip().lower()
        return Decimal(str(priority_bonuses.get(pname, 3)))

    return Decimal("0")


def calc_kpi_final(kpi_base, kpi_perform, kpi_ot):
    """5.22: KPI Final = KPI Base + KPI Perform + KPI OT"""
    base = Decimal(str(kpi_base or 0))
    perform = Decimal(str(kpi_perform or 0))
    ot = Decimal(str(kpi_ot or 0))
    return base + perform + ot


def calc_kpi_split(kpi_final, ratio_assign: int, ratio_support: int):
    """5.22: Split KPI Final by Assign/Support ratio."""
    final = Decimal(str(kpi_final or 0))
    if ratio_assign + ratio_support == 0:
        return Decimal("0"), Decimal("0")
    kpi_assigned = (final * Decimal(str(ratio_assign))) / Decimal("100")
    kpi_support = (final * Decimal(str(ratio_support))) / Decimal("100")
    return kpi_assigned.quantize(Decimal("0.01")), kpi_support.quantize(Decimal("0.01"))


def lookup_solution(skill_vendor_id: int, db) -> str:
    """
    5.26: Solution = Skill Vendor → Group → Category name.
    E.g., skill "mosa" → group "Switching & Routing" → category "Network Solutions"
    """
    if not skill_vendor_id:
        return ""
    from ..models.skill_master import Skill, Group, Category
    skill = db.query(Skill).filter(Skill.id == skill_vendor_id).first()
    if not skill:
        return ""
    group = db.query(Group).filter(Group.id == skill.group_id).first()
    if not group:
        return ""
    category = db.query(Category).filter(Category.id == group.category_id).first()
    if not category:
        return ""
    return category.name


def recalculate_task(task, db):
    """
    Central recalculation function.
    
    Called after any PATCH/PUT to a task.
    Updates all computed fields based on current values.
    """
    # 1. End Date EST
    task.end_date_est = calc_end_date_est(task.start_date, task.manday_est)

    # 2. Manday Actual
    task.manday_actual = calc_manday_actual(task.status, task.start_date, task.end_date_actual)

    # 3. Days Late
    task.days_late = calc_days_late(task.status, task.end_date_est, task.end_date_actual)

    # 4. KPI Base
    priority_kpi = get_priority_kpi_base(task.priority, db)
    task.kpi_base = calc_kpi_base(priority_kpi, task.manday_est)

    # 5. KPI Perform
    task.kpi_perform = calc_kpi_perform(
        task.days_late, task.kpi_base, task.manday_est,
        task.manday_actual, task.priority, task.remark
    )

    # 6. KPI OT
    task.kpi_ot = calc_kpi_ot(task.remark, task.priority)

    # 7. KPI Final
    task.kpi_final = calc_kpi_final(task.kpi_base, task.kpi_perform, task.kpi_ot)

    # If status is Cancel, do not calculate KPI (set all to 0)
    if task.status and task.status.strip().lower() == "cancel":
        task.kpi_base = Decimal("0")
        task.kpi_perform = Decimal("0")
        task.kpi_ot = Decimal("0")
        task.kpi_final = Decimal("0")

    # 8. Auto-set ratio if no support
    if not task.support_id:
        task.kpi_ratio_assign = 100
        task.kpi_ratio_support = 0

    # 9. KPI Split
    task.kpi_assigned, task.kpi_support = calc_kpi_split(
        task.kpi_final, task.kpi_ratio_assign or 100, task.kpi_ratio_support or 0
    )

    # 10. Solution lookup
    task.solution = lookup_solution(task.skill_vendor_id, db)

    return task
