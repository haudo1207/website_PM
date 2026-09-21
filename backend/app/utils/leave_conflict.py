from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..models.leave_request import LeaveRequest
from ..models.member import Member
from ..models.user import User


def get_member_leave_conflicts(
    db: Session,
    member_ids: list[int],
    start_date: date,
    end_date: Optional[date] = None,
) -> list[dict]:
    """Return approved leave requests that overlap [start_date, end_date]
    (inclusive) for any of the given member ids.

    Leave requests are full-day/date-based, so overlap is determined purely by
    comparing ISO date strings. The result is advisory — callers decide whether
    to block the operation or only warn.
    """
    if not member_ids:
        return []

    end = end_date or start_date
    if end < start_date:
        start_date, end = end, start_date

    start_str = start_date.isoformat()
    end_str = end.isoformat()

    leaves = (
        db.query(LeaveRequest)
        .join(User, LeaveRequest.user_id == User.id)
        .filter(User.member_id.in_(member_ids))
        .filter(LeaveRequest.status == "Approved")
        .filter(LeaveRequest.start_date <= end_str, LeaveRequest.end_date >= start_str)
        .all()
    )

    conflicts = []
    for lr in leaves:
        member_name = ""
        member_id_val = None
        if lr.user and lr.user.member:
            member_name = lr.user.member.full_name or lr.user.member.display_name or ""
            member_id_val = lr.user.member.id
        conflicts.append({
            "leave_request_id": lr.id,
            "member_id": member_id_val,
            "member_name": member_name,
            "leave_type": lr.leave_type,
            "start_date": lr.start_date,
            "end_date": lr.end_date,
        })
    return conflicts


def _to_date(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def task_leave_conflicts(
    db: Session,
    assigned_id: Optional[int],
    support_id: Optional[int],
    scheduled_at: Optional[datetime],
    start_date: Optional[date],
) -> list[dict]:
    """Advisory conflict check for Task create/update.

    Uses the scheduled date when available; otherwise falls back to the task's
    start_date. A task without either cannot conflict with leave.
    """
    task_date = _to_date(scheduled_at) if scheduled_at else None
    if task_date is None:
        task_date = _to_date(start_date)
    if task_date is None:
        return []

    member_ids = [m for m in (assigned_id, support_id) if m]
    return get_member_leave_conflicts(db, member_ids, task_date)


def meeting_leave_conflicts(
    db: Session,
    member_ids: list[int],
    start_time: datetime,
    end_time: Optional[datetime] = None,
) -> list[dict]:
    """Advisory conflict check for Meeting create/update.

    Compares the meeting's date range against approved leave for all
    participants (organizer + members).
    """
    start_date = _to_date(start_time)
    if start_date is None:
        return []
    end_date = _to_date(end_time) if end_time else start_date
    return get_member_leave_conflicts(db, member_ids, start_date, end_date)
