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
from ..utils.auth import get_current_user, require_admin

router = APIRouter()

LUNCH_PRICE = 40000  # VND per lunch


class LunchUpsert(BaseModel):
    member_id: int
    date: str  # YYYY-MM-DD
    has_lunch: bool


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
    # Get all lunch records for the given month
    records = db.query(LunchRecord).filter(
        and_(
            extract('year', LunchRecord.date) == year,
            extract('month', LunchRecord.date) == month,
        )
    ).all()

    # Get all members
    members = db.query(Member).order_by(Member.display_name).all()

    # Build summary per member
    member_summaries = []
    for m in members:
        member_records = [r for r in records if r.member_id == m.id]
        lunch_count = sum(1 for r in member_records if r.has_lunch)
        no_lunch_count = sum(1 for r in member_records if not r.has_lunch)
        total_days = len(member_records)

        total_cost = lunch_count * LUNCH_PRICE
        member_summaries.append({
            "member_id": m.id,
            "display_name": m.display_name,
            "full_name": m.full_name,
            "team": m.team,
            "lunch_count": lunch_count,
            "no_lunch_count": no_lunch_count,
            "total_registered_days": total_days,
            "total_cost": total_cost,
        })

    # Overall summary
    total_lunch = sum(m["lunch_count"] for m in member_summaries)
    total_no_lunch = sum(m["no_lunch_count"] for m in member_summaries)

    # Working days in month (approximate: weekdays only)
    _, num_days = calendar.monthrange(year, month)
    working_days = sum(1 for d in range(1, num_days + 1)
                       if calendar.weekday(year, month, d) < 5)

    total_cost = sum(m["total_cost"] for m in member_summaries)

    return {
        "year": year,
        "month": month,
        "working_days": working_days,
        "total_lunch": total_lunch,
        "total_no_lunch": total_no_lunch,
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
    # Permission: admin can set for anyone; regular user can only set for themselves
    if current_user.role != "admin" and body.member_id != (current_user.member_id or 0):
        raise HTTPException(403, "Bạn không có quyền đăng ký cho người khác")

    parsed_date = body.date
    if isinstance(parsed_date, str):
        from datetime import date
        parts = parsed_date.split("-")
        parsed_date = date(int(parts[0]), int(parts[1]), int(parts[2]))

    existing = db.query(LunchRecord).filter(
        and_(
            LunchRecord.member_id == body.member_id,
            LunchRecord.date == body.date,
        )
    ).first()

    if existing:
        existing.has_lunch = body.has_lunch
        db.commit()
        db.refresh(existing)
        record = existing
    else:
        record = LunchRecord(
            member_id=body.member_id,
            date=parsed_date,
            has_lunch=body.has_lunch,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    return {
        "id": record.id,
        "member_id": record.member_id,
        "date": str(record.date),
        "has_lunch": record.has_lunch,
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
        raise HTTPException(404, "Không tìm thấy bản ghi")

    if current_user.role != "admin" and record.member_id != (current_user.member_id or 0):
        raise HTTPException(403, "Không có quyền xóa")

    db.delete(record)
    db.commit()
    return {"message": "Đã xóa thành công"}