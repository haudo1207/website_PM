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


def parse_datetime(value):
    """Parse a datetime for Task.scheduled_at. None/empty → None (unscheduled —
    the task drops into the Calendar's "chưa xếp lịch" tray). The value is
    treated as naive Asia/Ho_Chi_Minh wall-clock time (see utils/timezone.py) —
    an aware input is converted to VN time and stripped of tzinfo rather than
    stored as UTC, to stay consistent with every other scheduling datetime in
    this app (meetings.py)."""
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        dt = value
    else:
        value = str(value).strip()
        dt = None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                dt = datetime.datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
        if dt is None:
            return None
    if dt.tzinfo is not None:
        from .timezone import VN_TZ
        dt = dt.astimezone(VN_TZ).replace(tzinfo=None)
    return dt


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
    - If status is not "done" -> NULL (leave it empty)
    - If status is "done" -> End Actual - End EST
    """
    if not status:
        return None

    status_lower = status.strip().lower()

    if status_lower == "done":
        if not end_date_est or not end_date_actual:
            return None
        return (end_date_actual - end_date_est).days

    return None


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


def calc_kpi_ot(days_late=None, kpi_base=None, priority_name: str = None):
    """
    KPI Overtime:
    - Normal: abs(days_late) * 1
    - High: abs(days_late) * 2
    - Critical: abs(days_late) * 3
    - Cap at 50% KPI Base
    - Early bonus is additionally capped at 20 points
    - Late is negative, early is positive
    """
    if days_late is None or days_late == 0:
        return Decimal("0")

    priority_multipliers = {
        "normal": Decimal("1"),
        "medium": Decimal("1"),
        "high": Decimal("2"),
        "critical": Decimal("3"),
    }
    pname = (priority_name or "normal").strip().lower()
    multiplier = priority_multipliers.get(pname, Decimal("1"))

    raw_value = Decimal(str(abs(days_late))) * multiplier
    cap = Decimal(str(kpi_base or 0)) * Decimal("0.5")
    if days_late < 0:
        cap = min(cap, Decimal("20"))
    capped_value = min(raw_value, cap)

    return -capped_value if days_late > 0 else capped_value


def calc_legacy_remark_kpi_ot(remark: str = None, priority_name: str = None):
    """Deprecated placeholder kept for backward compatibility with old imports."""
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
    from ..models.performance_setting import PerformanceSetting

    # 1. End Date EST
    task.end_date_est = calc_end_date_est(task.start_date, task.manday_est)

    # 2. Manday Actual
    task.manday_actual = calc_manday_actual(task.status, task.start_date, task.end_date_actual)
 
    # 3. Days Late
    task.days_late = calc_days_late(task.status, task.end_date_est, task.end_date_actual)

    is_done = task.status and task.status.strip().lower() == "done"
    is_cancel = task.status and task.status.strip().lower() == "cancel"

    # 4. KPI Base
    if is_done:
        priority_kpi = get_priority_kpi_base(task.priority, db)
        task.kpi_base = calc_kpi_base(priority_kpi, task.manday_est)
    elif is_cancel:
        task.kpi_base = Decimal("0")
    else:
        task.kpi_base = None

    # Parse remark using dynamic performance settings from the DB
    remark_str = (task.remark or "").strip().lower()
    remark_perform = Decimal("0")
    multiplier = Decimal("1.0")

    # Split remark by common separators to match multiple rules
    remark_parts = [p.strip() for p in remark_str.replace(';', ',').split(',') if p.strip()]

    try:
        rules = db.query(PerformanceSetting).filter(PerformanceSetting.is_active == True).all()
        for rule in rules:
            rule_perf = rule.performance.strip().lower()
            clean_rule_perf = rule_perf
            if rule_perf.startswith('(t)') or rule_perf.startswith('(p)'):
                clean_rule_perf = rule_perf[3:].strip()

            # Robust matching check
            is_matched = False
            for part in remark_parts:
                # 1. Match by ID if the part is numeric
                if part.isdigit() and int(part) == rule.id:
                    is_matched = True
                    break
                # 2. Match by exact text or clean text
                if rule_perf in part or clean_rule_perf in part:
                    is_matched = True
                    break
                if part == rule_perf or part == clean_rule_perf:
                    is_matched = True
                    break
                if '-' in rule_perf:
                    parts = rule_perf.split('-', 1)
                    prefix = parts[0].strip()
                    if prefix == part:
                        is_matched = True
                        break
                if len(part) >= 5 and part in clean_rule_perf:
                    is_matched = True
                    break

            if is_matched:
                rule_kpi = Decimal(str(rule.kpi))
                
                # Handle parent remarks first and exclusively for multipliers.
                # Coefficient always comes from the configured rule.kpi (Settings
                # → Cấu hình hiệu suất) — "Fail 1"/"Fail 2" used to be hardcoded
                # to 0.7/0.5 here regardless of what was actually configured, so
                # changing their coefficient in Settings silently had no effect.
                if getattr(rule, 'is_parent', False):
                    if (0.0 <= rule_kpi <= 1.0): # Parent remarks that are multipliers
                        multiplier *= rule_kpi
                    else: # Parent remarks that are additive
                        remark_perform += rule_kpi
                    continue # This is critical to prevent double-counting

                # For non-parent rules, apply multiplier ONLY if it's not a parent-like remark
                # This check helps prevent a generic "fail" rule from matching "(p) fail 1"
                is_parent_like_match = False
                for part in remark_parts:
                    if part.startswith('(p)') and (rule_perf in part or clean_rule_perf in part):
                        is_parent_like_match = True
                        break
                
                if (0.0 <= rule_kpi <= 1.0) and ("fail" in rule_perf or "rework" in rule_perf):
                    if not is_parent_like_match:
                         multiplier *= rule_kpi
                    # If it is parent-like, it has been handled by the block above, so we do nothing here.
                else:
                    remark_perform += rule_kpi
    except Exception as e:
        print(f"[!] Error parsing performance settings: {e}")

    # Find the parent TaskGroup status
    from ..models.task_group import TaskGroup
    parent_group = db.query(TaskGroup).filter(TaskGroup.id == task.task_group_id).first()
    parent_done = False
    if parent_group:
        parent_done = parent_group.status and parent_group.status.strip().lower() == "done"

    # 5. KPI Perform, OT, Final
    if is_done:
        if parent_done:
            task.kpi_perform = remark_perform
            task.kpi_ot = calc_kpi_ot(task.days_late, task.kpi_base, task.priority)
            task.kpi_final = (task.kpi_base + task.kpi_perform + task.kpi_ot) * multiplier
        else:
            task.kpi_perform = remark_perform if remark_str else None
            task.kpi_ot = None
            task.kpi_final = None
    elif is_cancel:
        task.kpi_base = Decimal("0")
        task.kpi_perform = Decimal("0")
        task.kpi_ot = Decimal("0")
        task.kpi_final = Decimal("0")
    else:
        task.kpi_perform = remark_perform if remark_str else None
        task.kpi_ot = None
        task.kpi_final = None

    # 8. Auto-set ratio if no support
    if not task.support_id:
        task.kpi_ratio_assign = 100
        task.kpi_ratio_support = 0

    # 9. KPI Split
    if task.kpi_final is not None:
        task.kpi_assigned, task.kpi_support = calc_kpi_split(
            task.kpi_final, task.kpi_ratio_assign or 90, task.kpi_ratio_support or 10
        )
    else:
        task.kpi_assigned = None
        task.kpi_support = None

    # 10. Solution lookup
    task.solution = lookup_solution(task.skill_vendor_id, db)

    return task

# ═══════════════════════════════════════════════════════════
# END ACTUAL TỰ ĐỘNG TỪ TASK CON
# - Khi task con có status = Done, lấy end_date_actual của task con đó
# - Nếu nhiều task con Done, lấy ngày trễ nhất (MAX)
# - Nếu task con chuyển từ Done sang khác, xóa end_date_actual của cha
# - Đệ quy lên toàn bộ cây phân cấp (cháu → con → cha → ông)
# ═══════════════════════════════════════════════════════════
def recalculate_parent_end_actual(task, db):
    """
    Tự động cập nhật END ACTUAL của task cha dựa trên task con.
    
    Logic:
    - END ACTUAL của cha = MAX(end_date_actual của các task con có status = "Done")
    - Nếu không có task con nào Done → END ACTUAL của cha = None
    - Đệ quy lên ông/bà (grandparent) để cập nhật toàn bộ chuỗi
    
    Gọi sau khi PATCH một task con (khi status thay đổi).
    """
    from ..models.task import Task
    
    task_code = task.task_code
    if not task_code or '.' not in task_code:
        return  # Root task (e.g., "1") không có cha
    
    # Lấy mã cha: "1.1.1" → cha "1.1", "1.2" → cha "1"
    parent_code = task_code.rsplit('.', 1)[0]
    gid = task.task_group_id
    
    # Tìm task cha
    parent_task = db.query(Task).filter(
        Task.task_group_id == gid,
        Task.task_code == parent_code
    ).first()
    
    if not parent_task:
        return
    
    # Tìm tất cả task con TRỰC TIẾP (cùng group, code bắt đầu bằng prefix, không có dấu chấm thêm)
    prefix = parent_code + "."
    all_descendants = db.query(Task).filter(
        Task.task_group_id == gid,
        Task.task_code.like(f"{prefix}%")
    ).all()
    
    # Lọc chỉ lấy task con trực tiếp (task_code = parent_code.X, không có dấu chấm thứ 2)
    immediate_children = []
    for child in all_descendants:
        suffix = child.task_code[len(prefix):]
        if '.' not in suffix:  # Chỉ con trực tiếp, không phải cháu/chắt
            immediate_children.append(child)
    
    # Tính năng cập nhật END ACTUAL của cha từ con bị bỏ theo yêu cầu của user.
    # Khi task cha chuyển Done thì hệ thống đã tự động set end_date_actual = hôm nay.
    pass
    
    db.flush()
    
    # Đệ quy lên task ông (grandparent) để cập nhật toàn bộ chuỗi
    recalculate_parent_end_actual(parent_task, db)
