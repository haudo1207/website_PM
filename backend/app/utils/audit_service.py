"""
Central Audit Service for recording audit log entries on successful operations.
"""
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from ..models.audit_log import AuditLog
import json
import datetime

class AuditService:
    @staticmethod
    def record(
        db: Session,
        user_id: Optional[int],
        module: str,
        entity_type: str,
        entity_id: Any,
        action: str,
        project_id: Optional[int] = None,
        field_name: Optional[str] = None,
        old_value: Optional[Any] = None,
        new_value: Optional[Any] = None,
        description: Optional[str] = None
    ) -> Optional[AuditLog]:
        """
        Record a single audit log entry after successful DB operation.
        """
        try:
            old_str = AuditService._format_value(old_value)
            new_str = AuditService._format_value(new_value)

            log_entry = AuditLog(
                project_id=project_id,
                module=module,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                action=action.upper(),
                field_name=field_name,
                old_value=old_str,
                new_value=new_str,
                description=description,
                user_id=user_id
            )
            db.add(log_entry)
            db.flush()
            return log_entry
        except Exception as err:
            print(f"[AuditService] Warning: Failed to record audit log: {err}")
            return None

    @staticmethod
    def record_diff(
        db: Session,
        user_id: Optional[int],
        module: str,
        entity_type: str,
        entity_id: Any,
        old_dict: Dict[str, Any],
        new_dict: Dict[str, Any],
        project_id: Optional[int] = None,
        field_labels: Optional[Dict[str, str]] = None
    ) -> List[str]:
        """
        Compare old_dict and new_dict, creating an AuditLog entry for each changed field.
        """
        labels = field_labels or {}
        changed_fields = []
        for key, new_val in new_dict.items():
            if key in old_dict:
                old_val = old_dict[key]
                if AuditService._is_changed(old_val, new_val):
                    label = labels.get(key, key)
                    old_str = AuditService._format_value(old_val) or "None"
                    new_str = AuditService._format_value(new_val) or "None"
                    desc = f"Cập nhật {label}: '{old_str}' → '{new_str}'"
                    AuditService.record(
                        db=db,
                        user_id=user_id,
                        module=module,
                        entity_type=entity_type,
                        entity_id=entity_id,
                        action="UPDATE",
                        project_id=project_id,
                        field_name=key,
                        old_value=old_val,
                        new_value=new_val,
                        description=desc
                    )
                    changed_fields.append(key)
        return changed_fields

    @staticmethod
    def _is_changed(val1: Any, val2: Any) -> bool:
        if val1 is None and val2 is None:
            return False
        if val1 is None or val2 is None:
            return True
        return str(val1).strip() != str(val2).strip()

    @staticmethod
    def _format_value(val: Any) -> Optional[str]:
        if val is None:
            return None
        if isinstance(val, (dict, list)):
            return json.dumps(val, ensure_ascii=False)
        if isinstance(val, (datetime.date, datetime.datetime)):
            return val.isoformat()
        return str(val)
