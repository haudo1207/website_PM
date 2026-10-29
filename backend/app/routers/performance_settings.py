from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from decimal import Decimal

from ..database import get_db
from ..models.performance_setting import PerformanceSetting
from ..utils.auth import get_current_user, get_current_user_or_support_key, require_admin_write
from ..utils.audit_service import AuditService

router = APIRouter(dependencies=[Depends(require_admin_write)])


def _serialize(s: PerformanceSetting) -> dict:
    return {
        "id": s.id,
        "performance": s.performance,
        "kpi": float(s.kpi),
        "remark_type": getattr(s, 'remark_type', 'Bonus') or 'Bonus',
        "description": getattr(s, 'description', None),
        "sort_order": s.sort_order,
        "is_active": s.is_active,
        "is_parent": bool(getattr(s, 'is_parent', False)),
        "parent_id": getattr(s, 'parent_id', None),
    }


@router.get("")
# get_current_user_or_support_key (không phải get_current_user thuần) — route này
# dùng require_admin_write ở router-level (đã nhận SUPPORT_INTEGRATION_API_KEY), nhưng
# tham số current_user RIÊNG của hàm vẫn chỉ nhận JWT nếu không đổi — gây 401 khi
# Tech_Support gọi bằng key tĩnh để đồng bộ Remark (Việc 1). Chỉ đổi đúng route GET này
# (Support chỉ đọc, không tạo/sửa/xoá performance-settings) — các route POST/PUT/DELETE
# bên dưới giữ nguyên get_current_user, không mở rộng quyền ghi cho service-account.
def get_performance_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user_or_support_key)):
    """Retrieve all active performance settings ordered by sort_order and id."""
    settings = (
        db.query(PerformanceSetting)
        .order_by(PerformanceSetting.sort_order.asc(), PerformanceSetting.id.asc())
        .all()
    )
    return [_serialize(s) for s in settings]


@router.get("/parents")
def get_parent_remarks(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Retrieve only Remark Cha (is_parent=True) entries."""
    settings = (
        db.query(PerformanceSetting)
        .filter(PerformanceSetting.is_parent == True)
        .order_by(PerformanceSetting.sort_order.asc(), PerformanceSetting.id.asc())
        .all()
    )
    return [_serialize(s) for s in settings]


@router.post("")
def create_performance_setting(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Create a new KPI performance rule (or Remark Cha if is_parent=True)."""
    performance = str(body.get("performance", "")).strip()
    if not performance:
        raise HTTPException(400, "Nội dung performance không được để trống")

    try:
        kpi_val = Decimal(str(body.get("kpi", 0)))
    except Exception:
        raise HTTPException(400, "Giá trị KPI không hợp lệ")

    is_parent = bool(body.get("is_parent", False))
    parent_id = body.get("parent_id", None)

    # Validate parent_id if provided
    if parent_id is not None:
        parent = db.query(PerformanceSetting).filter(
            PerformanceSetting.id == int(parent_id),
            PerformanceSetting.is_parent == True
        ).first()
        if not parent:
            raise HTTPException(400, "Remark cha không tồn tại hoặc không phải Remark Cha")

    # Find max sort_order to append at the end
    max_sort = db.query(PerformanceSetting).order_by(PerformanceSetting.sort_order.desc()).first()
    next_sort = (max_sort.sort_order + 1) if max_sort else 0

    rule = PerformanceSetting(
        performance=performance,
        kpi=kpi_val,
        remark_type=body.get("remark_type", "Bonus"),
        description=body.get("description"),
        sort_order=body.get("sort_order", next_sort),
        is_active=body.get("is_active", True),
        is_parent=is_parent,
        parent_id=parent_id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Performance Setting",
        entity_type="PerformanceSetting",
        entity_id=rule.id,
        action="CREATE",
        resource_name=rule.performance,
        description=f"Tạo cấu hình KPI '{rule.performance}' (KPI={rule.kpi}, loại={rule.remark_type})"
    )
    db.commit()

    return {"success": True, "data": _serialize(rule)}


@router.put("/{id}")
def update_performance_setting(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Update an existing KPI performance rule."""
    rule = db.query(PerformanceSetting).filter(PerformanceSetting.id == id).first()
    if not rule:
        raise HTTPException(404, "Không tìm thấy cấu hình KPI")

    old_dict = {
        "performance": rule.performance,
        "kpi": float(rule.kpi),
        "remark_type": rule.remark_type,
        "description": rule.description,
        "is_active": rule.is_active,
    }

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

    if "remark_type" in body:
        rule.remark_type = str(body["remark_type"]).strip()

    if "description" in body:
        rule.description = body["description"]

    if "sort_order" in body:
        rule.sort_order = int(body["sort_order"])

    if "is_active" in body:
        rule.is_active = bool(body["is_active"])

    if "is_parent" in body:
        rule.is_parent = bool(body["is_parent"])

    if "parent_id" in body:
        pid = body["parent_id"]
        if pid is not None:
            parent = db.query(PerformanceSetting).filter(
                PerformanceSetting.id == int(pid),
                PerformanceSetting.is_parent == True
            ).first()
            if not parent:
                raise HTTPException(400, "Remark cha không tồn tại hoặc không phải Remark Cha")
        rule.parent_id = pid

    db.commit()
    db.refresh(rule)

    new_dict = {
        "performance": rule.performance,
        "kpi": float(rule.kpi),
        "remark_type": rule.remark_type,
        "description": rule.description,
        "is_active": rule.is_active,
    }
    field_labels = {
        "performance": "Nội dung",
        "kpi": "KPI",
        "remark_type": "Loại",
        "description": "Mô tả",
        "is_active": "Đang áp dụng",
    }
    AuditService.record_diff(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Performance Setting",
        entity_type="PerformanceSetting",
        entity_id=rule.id,
        old_dict=old_dict,
        new_dict=new_dict,
        field_labels=field_labels,
    )
    db.commit()

    return {"success": True, "data": _serialize(rule)}


@router.delete("/{id}")
def delete_performance_setting(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Delete a KPI performance rule."""
    rule = db.query(PerformanceSetting).filter(PerformanceSetting.id == id).first()
    if not rule:
        raise HTTPException(404, "Không tìm thấy cấu hình KPI")

    perf_name = rule.performance
    db.delete(rule)
    db.commit()

    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Performance Setting",
        entity_type="PerformanceSetting",
        entity_id=id,
        action="DELETE",
        resource_name=perf_name,
        description=f"Xóa cấu hình KPI '{perf_name}'"
    )
    db.commit()

    return {"success": True, "message": "Đã xóa cấu hình KPI thành công"}
