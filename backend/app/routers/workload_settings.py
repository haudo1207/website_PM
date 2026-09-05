"""
Workload Settings CRUD — Super Admin only.

Manages the four workload classification thresholds used by
Dashboard → Team Load → Section 4.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal

from ..database import get_db
from ..models.workload_setting import WorkloadSetting
from ..utils.auth import get_current_user, require_super_admin
from ..utils.audit_service import AuditService

router = APIRouter(dependencies=[Depends(require_super_admin)])


def _serialize(s: WorkloadSetting) -> dict:
    return {
        "id": s.id,
        "status_key": s.status_key,
        "status_label": s.status_label,
        "min_kpi": float(s.min_kpi) if s.min_kpi is not None else None,
        "max_kpi": float(s.max_kpi) if s.max_kpi is not None else None,
        "sort_order": s.sort_order,
        "is_active": s.is_active,
    }


def _validate_thresholds(rows: list[WorkloadSetting]):
    """Validate that thresholds form a contiguous, non-overlapping, complete range."""
    active = [r for r in rows if r.is_active]
    if len(active) != 4:
        raise HTTPException(400, "Phải có đúng 4 trạng thái workload đang hoạt động")

    # Sort by min_kpi (NULLs last for overload which has no upper bound)
    active.sort(key=lambda r: (
        float(r.min_kpi) if r.min_kpi is not None else float("inf"),
        float(r.max_kpi) if r.max_kpi is not None else float("inf"),
    ))

    # Check: min of first should be NULL (represents -infinity)
    if active[0].min_kpi is not None:
        raise HTTPException(400, "Ngưỡng thấp nhất phải mở (min_kpi = NULL) để bao phủ từ 0%")

    # Check: max of last should be NULL (represents +infinity)
    if active[-1].max_kpi is not None:
        raise HTTPException(400, "Ngưỡng cao nhất phải mở (max_kpi = NULL) để bao phủ đến vô cực")

    # Check contiguous and no overlap
    for i in range(len(active) - 1):
        curr_max = active[i].max_kpi
        next_min = active[i + 1].min_kpi
        if curr_max is None or next_min is None:
            continue
        if Decimal(str(curr_max)) != Decimal(str(next_min)):
            raise HTTPException(
                400,
                f"Khoảng '{active[i].status_label}' kết thúc tại {curr_max} "
                f"nhưng '{active[i+1].status_label}' bắt đầu tại {next_min}. "
                f"Phải liên tục, không trùng lặp."
            )


@router.get("")
def get_workload_settings(db: Session = Depends(get_db)):
    """Retrieve all workload threshold settings (any authenticated user can read)."""
    settings = (
        db.query(WorkloadSetting)
        .order_by(WorkloadSetting.sort_order.asc(), WorkloadSetting.id.asc())
        .all()
    )
    return [_serialize(s) for s in settings]


@router.put("")
def update_workload_settings(body: list[dict], db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Bulk-update workload thresholds. Super Admin only."""
    if not isinstance(body, list) or len(body) != 4:
        raise HTTPException(400, "Phải gửi đúng 4 cấu hình ngưỡng")

    existing = db.query(WorkloadSetting).all()
    existing_by_key = {s.status_key: s for s in existing}

    updated_items = []
    for item in body:
        key = item.get("status_key", "").strip()
        if not key:
            raise HTTPException(400, "Thiếu status_key")

        s = existing_by_key.get(key)
        if not s:
            raise HTTPException(400, f"Không tìm thấy trạng thái '{key}'")

        old_dict = _serialize(s)

        if "min_kpi" in item:
            val = item["min_kpi"]
            s.min_kpi = Decimal(str(val)) if val is not None else None
        if "max_kpi" in item:
            val = item["max_kpi"]
            s.max_kpi = Decimal(str(val)) if val is not None else None
        if "status_label" in item:
            s.status_label = str(item["status_label"]).strip()
        if "sort_order" in item:
            s.sort_order = int(item["sort_order"])

        new_dict = _serialize(s)
        updated_items.append((s, old_dict, new_dict))

    # Validate after all updates
    all_rows = db.query(WorkloadSetting).all()
    _validate_thresholds(all_rows)

    for s, old_dict, new_dict in updated_items:
        AuditService.record_diff(
            db=db,
            user_id=getattr(current_user, "id", None),
            module="Workload Setting",
            entity_type="WorkloadSetting",
            entity_id=s.id,
            old_dict=old_dict,
            new_dict=new_dict,
            field_labels={
                "min_kpi": "KPI tối thiểu",
                "max_kpi": "KPI tối đa",
                "status_label": "Tên trạng thái",
            },
        )

    db.commit()
    return {"success": True, "data": [_serialize(s) for s in all_rows]}
