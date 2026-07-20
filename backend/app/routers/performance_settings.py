from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from decimal import Decimal

from ..database import get_db
from ..models.performance_setting import PerformanceSetting
from ..utils.auth import get_current_user, require_admin_write

router = APIRouter(dependencies=[Depends(require_admin_write)])


@router.get("")
def get_performance_settings(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Retrieve all active performance settings ordered by sort_order and id."""
    settings = db.query(PerformanceSetting).order_by(PerformanceSetting.sort_order.asc(), PerformanceSetting.id.asc()).all()
    return [{
        "id": s.id,
        "performance": s.performance,
        "kpi": float(s.kpi),
        "sort_order": s.sort_order,
        "is_active": s.is_active
    } for s in settings]


@router.post("")
def create_performance_setting(body: dict, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Create a new KPI performance rule."""
    performance = str(body.get("performance", "")).strip()
    if not performance:
        raise HTTPException(400, "Nội dung performance không được để trống")

    try:
        kpi_val = Decimal(str(body.get("kpi", 0)))
    except Exception:
        raise HTTPException(400, "Giá trị KPI không hợp lệ")

    # Find max sort_order to append at the end
    max_sort = db.query(PerformanceSetting).order_by(PerformanceSetting.sort_order.desc()).first()
    next_sort = (max_sort.sort_order + 1) if max_sort else 0

    rule = PerformanceSetting(
        performance=performance,
        kpi=kpi_val,
        sort_order=body.get("sort_order", next_sort),
        is_active=body.get("is_active", True)
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    return {
        "success": True,
        "data": {
            "id": rule.id,
            "performance": rule.performance,
            "kpi": float(rule.kpi),
            "sort_order": rule.sort_order,
            "is_active": rule.is_active
        }
    }


@router.put("/{id}")
def update_performance_setting(id: int, body: dict, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Update an existing KPI performance rule."""
    rule = db.query(PerformanceSetting).filter(PerformanceSetting.id == id).first()
    if not rule:
        raise HTTPException(404, "Không tìm thấy cấu hình KPI")

    if "performance" in body:
        perf = str(body["performance"]).strip()
        if not perf:
            raise HTTPException(400, "Nội dung performance không được để trống")
        rule.performance = perf

    if "kpi" in body:
        try:
            rule.kpi = Decimal(str(body["kpi"]))
        except Exception:
            raise HTTPException(400, "Giá trị KPI không hợp lệ")

    if "sort_order" in body:
        rule.sort_order = int(body["sort_order"])

    if "is_active" in body:
        rule.is_active = bool(body["is_active"])

    db.commit()
    db.refresh(rule)

    return {
        "success": True,
        "data": {
            "id": rule.id,
            "performance": rule.performance,
            "kpi": float(rule.kpi),
            "sort_order": rule.sort_order,
            "is_active": rule.is_active
        }
    }


@router.delete("/{id}")
def delete_performance_setting(id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Delete a KPI performance rule."""
    rule = db.query(PerformanceSetting).filter(PerformanceSetting.id == id).first()
    if not rule:
        raise HTTPException(404, "Không tìm thấy cấu hình KPI")

    db.delete(rule)
    db.commit()
    return {"success": True, "message": "Đã xóa cấu hình KPI thành công"}
