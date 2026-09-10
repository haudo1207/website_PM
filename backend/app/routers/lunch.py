from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, extract, func
from datetime import date as date_type
from typing import Optional
from pydantic import BaseModel
import calendar

from ..database import get_db
from ..models.lunch_record import LunchRecord
from ..models.member import Member
from ..models.user import User
from ..models.leave_request import LeaveRequest
from ..utils.auth import get_current_user

router = APIRouter()

LUNCH_PRICE = 40000  # VND per lunch

ADMIN_ROLES = {"admin", "super_admin"}

VALID_STATUSES = ['off', 'lunch', 'no_lunch', 'onsite', 'bonus']


class LunchUpsert(BaseModel):
    member_id: int
    date: str  # YYYY-MM-DD
    has_lunch: bool
    status: Optional[str] = None  # off, lunch, no_lunch, bonus


def _month_range(year: int, month: int):
    """Return (inclusive start, exclusive end) date range for a month."""
    start = date_type(year, month, 1)
    end = date_type(year + 1, 1, 1) if month == 12 else date_type(year, month + 1, 1)
    return start, end


@router.get("")
def list_lunch_records(
    date: Optional[str] = None,
    member_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get lunch records. Admin can see all; regular users see only their own."""
    q = db.query(LunchRecord)

    if current_user.role not in ADMIN_ROLES:
        q = q.filter(LunchRecord.member_id == current_user.member_id)

    if date:
        q = q.filter(LunchRecord.date == date)
    if year and month:
        # Use a sargable date-range predicate so a normal btree index on "date"
        # can be used, instead of extract() wrapping the column.
        start_date, end_date = _month_range(year, month)
        q = q.filter(LunchRecord.date >= start_date, LunchRecord.date < end_date)
    elif year:
        q = q.filter(extract('year', LunchRecord.date) == year)
    elif month:
        q = q.filter(extract('month', LunchRecord.date) == month)
    if member_id:
        q = q.filter(LunchRecord.member_id == member_id)

    records = q.all()
    return [
        {
            "id": r.id,
            "member_id": r.member_id,
            "date": str(r.date),
            "has_lunch": r.has_lunch,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in records
    ]


@router.get("/monthly-summary")
def monthly_summary(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get monthly lunch summary for all members. Admin only."""
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Yeu cau quyen Admin")

    start_date, end_date = _month_range(year, month)
    records = db.query(LunchRecord).filter(
        LunchRecord.date >= start_date,
        LunchRecord.date < end_date,
    ).all()

    # Approved leave requests overlapping this month only, joined to User so we
    # get member_id in one query (avoids the previous N+1 per leave request).
    leave_requests = db.query(LeaveRequest, User).join(
        User, User.id == LeaveRequest.user_id
    ).filter(
        LeaveRequest.status == 'Approved'
    ).filter(
        LeaveRequest.start_date <= end_date.isoformat(),
        LeaveRequest.end_date >= start_date.isoformat(),
    ).all()

    members = db.query(Member).order_by(Member.display_name).all()

    # Build a set of (member_id, date) that are off due to approved leave
    off_dates = set()
    from datetime import date, timedelta
    for lr, user in leave_requests:
        if not user or not user.member_id:
            continue
        start = lr.start_date if isinstance(lr.start_date, date) else date.fromisoformat(str(lr.start_date))
        end = lr.end_date if isinstance(lr.end_date, date) else date.fromisoformat(str(lr.end_date))
        current = max(start, start_date)
        last = min(end, end_date - timedelta(days=1))
        while current <= last:
            off_dates.add((user.member_id, current))
            current += timedelta(days=1)

    # Group records by member so we do not rescan the whole list for every member.
    records_by_member = {}
    for r in records:
        records_by_member.setdefault(r.member_id, []).append(r)

    member_summaries = []
    for m in members:
        member_records = records_by_member.get(m.id, [])

        lunch_count = 0
        bonus_count = 0
        no_lunch_count = 0
        off_count = 0

        for r in member_records:
            r_date = r.date if isinstance(r.date, date_type) else date_type.fromisoformat(str(r.date))
            is_off = (m.id, r_date) in off_dates

            if is_off:
                off_count += 1
            elif r.status == 'lunch':
                lunch_count += 1
            elif r.status == 'bonus':
                bonus_count += 1
            elif r.status == 'no_lunch':
                no_lunch_count += 1
            elif r.status == 'onsite':
                pass
            elif r.status == 'off':
                off_count += 1
            elif r.has_lunch and not r.status:
                lunch_count += 1
            elif not r.has_lunch and not r.status:
                no_lunch_count += 1

        total_days = len(member_records)
        payable_days = no_lunch_count + bonus_count
        total_cost = payable_days * LUNCH_PRICE

        member_summaries.append({
            "member_id": m.id,
            "display_name": m.display_name,
            "full_name": m.full_name,
            "team": m.team,
            "lunch_count": lunch_count,
            "bonus_count": bonus_count,
            "no_lunch_count": no_lunch_count,
            "off_count": off_count,
            "total_registered_days": total_days,
            "total_cost": total_cost,
        })

    total_lunch = sum(m["lunch_count"] for m in member_summaries)
    total_bonus = sum(m["bonus_count"] for m in member_summaries)
    total_no_lunch = sum(m["no_lunch_count"] for m in member_summaries)
    total_off = sum(m["off_count"] for m in member_summaries)
    total_cost = sum(m["total_cost"] for m in member_summaries)

    _, num_days = calendar.monthrange(year, month)
    working_days = sum(1 for d in range(1, num_days + 1)
                       if calendar.weekday(year, month, d) < 5)

    return {
        "year": year,
        "month": month,
        "working_days": working_days,
        "total_lunch": total_lunch,
        "total_bonus": total_bonus,
        "total_no_lunch": total_no_lunch,
        "total_off": total_off,
        "total_cost": total_cost,
        "lunch_price": LUNCH_PRICE,
        "members": member_summaries,
    }


@router.post("")
def upsert_lunch_record(
    body: LunchUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update lunch record for a member on a given date."""
    if (current_user.role not in ADMIN_ROLES and body.member_id != (current_user.member_id or 0)):
        raise HTTPException(403, "Ban khong co quyen dang ky cho nguoi khac")

    parsed_date = body.date
    if isinstance(parsed_date, str):
        from datetime import date
        parts = parsed_date.split("-")
        parsed_date = date(int(parts[0]), int(parts[1]), int(parts[2]))

    weekday = parsed_date.weekday()
    if weekday in (5, 6):
        raise HTTPException(400, "Cuối tuần không được cập nhật Check Lunch / ngày làm việc")

    status = body.status or ('lunch' if body.has_lunch else 'no_lunch')
    if status not in VALID_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(VALID_STATUSES)}")

    existing = db.query(LunchRecord).filter(
        and_(
            LunchRecord.member_id == body.member_id,
            LunchRecord.date == parsed_date,
        )
    ).first()

    if existing:
        existing.has_lunch = body.has_lunch
        existing.status = status
        db.commit()
        db.refresh(existing)
        record = existing
    else:
        record = LunchRecord(
            member_id=body.member_id,
            date=parsed_date,
            has_lunch=body.has_lunch,
            status=status,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    return {
        "id": record.id,
        "member_id": record.member_id,
        "date": str(record.date),
        "has_lunch": record.has_lunch,
        "status": record.status,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.delete("/{record_id}")
def delete_lunch_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = db.query(LunchRecord).filter(LunchRecord.id == record_id).first()
    if not record:
        raise HTTPException(404, "Khong tim thay ban ghi")

    if current_user.role not in ADMIN_ROLES and record.member_id != (current_user.member_id or 0):
        raise HTTPException(403, "Khong co quyen xoa")

    db.delete(record)
    db.commit()
    return {"message": "Da xoa thanh cong"}
