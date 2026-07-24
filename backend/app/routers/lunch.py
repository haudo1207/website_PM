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
from ..utils.auth import get_current_user, require_admin

router = APIRouter()

LUNCH_PRICE = 40000  # VND per lunch

VALID_STATUSES = ['off', 'lunch', 'no_lunch', 'bonus']


class LunchUpsert(BaseModel):
    member_id: int
    date: str  # YYYY-MM-DD
    has_lunch: bool
    status: Optional[str] = None  # off, lunch, no_lunch, bonus


@router.get("")
def list_lunch_records(
    date: Optional[str] = None,
    member_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get lunch records. Admin can see all; regular users see only their own."""
    q = db.query(LunchRecord)

    if current_user.role != "admin":
        q = q.filter(LunchRecord.member_id == current_user.member_id)

    if date:
        q = q.filter(LunchRecord.date == date)
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
    current_user: User = Depends(require_admin),
):
    """Get monthly lunch summary for all members. Admin only."""
    records = db.query(LunchRecord).filter(
        and_(
            extract('year', LunchRecord.date) == year,
            extract('month', LunchRecord.date) == month,
        )
    ).all()

    # Get all approved leave requests to know which days members are off
    leave_requests = db.query(LeaveRequest).filter(
        LeaveRequest.status == 'Approved'
    ).all()

    members = db.query(Member).order_by(Member.display_name).all()

    # Build a set of (member_id, date) that are off due to approved leave
    off_dates = set()
    from datetime import date, timedelta
    for lr in leave_requests:
        user = db.query(User).filter(User.id == lr.user_id).first()
        if not user or not user.member_id:
            continue
        start = lr.start_date if isinstance(lr.start_date, date) else date.fromisoformat(str(lr.start_date))
        end = lr.end_date if isinstance(lr.end_date, date) else date.fromisoformat(str(lr.end_date))
        current = start
        while current <= end:
            if current.year == year and current.month == month:
                off_dates.add((user.member_id, current))
            current += timedelta(days=1)

    member_summaries = []
    for m in members:
        member_records = [r for r in records if r.member_id == m.id]

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
            elif r.status == 'off':
                off_count += 1
            elif r.has_lunch and not r.status:
                lunch_count += 1
            elif not r.has_lunch and not r.status:
                no_lunch_count += 1

        total_days = len(member_records)
        payable_days = lunch_count + bonus_count
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
    if current_user.role != "admin" and body.member_id != (current_user.member_id or 0):
        raise HTTPException(403, "Ban khong co quyen dang ky cho nguoi khac")

    parsed_date = body.date
    if isinstance(parsed_date, str):
        from datetime import date
        parts = parsed_date.split("-")
        parsed_date = date(int(parts[0]), int(parts[1]), int(parts[2]))

    status = body.status or ('lunch' if body.has_lunch else 'no_lunch')
    if status not in VALID_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(VALID_STATUSES)}")

    existing = db.query(LunchRecord).filter(
        and_(
            LunchRecord.member_id == body.member_id,
            LunchRecord.date == body.date,
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

    if current_user.role != "admin" and record.member_id != (current_user.member_id or 0):
        raise HTTPException(403, "Khong co quyen xoa")

    db.delete(record)
    db.commit()
    return {"message": "Da xoa thanh cong"}
