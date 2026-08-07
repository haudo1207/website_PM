"""
Central Audit Service for recording audit log entries on successful operations.
"""
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from fastapi import Request
from ..models.audit_log import AuditLog
from ..models.project import Project
import json
import datetime
import uuid

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
        customer_id: Optional[int] = None,
        business_unit: Optional[str] = None,
        field_name: Optional[str] = None,
        old_value: Optional[Any] = None,
        new_value: Optional[Any] = None,
        description: Optional[str] = None,
        event_id: Optional[str] = None,
        request: Optional[Request] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_url: Optional[str] = None
    ) -> Optional[AuditLog]:
        """
        Record a single audit log entry after successful DB operation.
        """
        try:
            old_str = AuditService._format_value(old_value)
            new_str = AuditService._format_value(new_value)
            evt_id = event_id or str(uuid.uuid4())

            # Auto derive business_unit if project_id is given
            bu = business_unit
            if not bu and project_id:
                p = db.query(Project).filter(Project.id == project_id).first()
                if p:
                    bu = p.business
                    if not customer_id and p.customer_id:
                        customer_id = p.customer_id

            # Extract request metadata if request object passed
            ip = ip_address
            ua = user_agent
            url = request_url
            if request:
                if not ip:
                    ip = request.client.host if request.client else None
                    forwarded = request.headers.get("X-Forwarded-For")
                    if forwarded:
                        ip = forwarded.split(",")[0].strip()
                if not ua:
                    ua = request.headers.get("User-Agent")
                if not url:
                    url = str(request.url)

            log_entry = AuditLog(
                event_id=evt_id,
                business_unit=bu,
                customer_id=customer_id,
                project_id=project_id,
                module=module,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                action=action.upper(),
                field_name=field_name,
                old_value=old_str,
                new_value=new_str,
                description=description,
                user_id=user_id,
                ip_address=ip[:50] if ip else None,
                user_agent=ua[:255] if ua else None,
                request_url=url[:255] if url else None
            )
            # Audit logging must not poison the caller's transaction. A schema
            # mismatch or an unavailable audit table should roll back only the
            # audit insert, not leave the shared Session in PendingRollbackError
            # and turn an otherwise successful API operation into a false 500.
            with db.begin_nested():
                db.add(log_entry)
                db.flush([log_entry])
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
        customer_id: Optional[int] = None,
        business_unit: Optional[str] = None,
        field_labels: Optional[Dict[str, str]] = None,
        event_id: Optional[str] = None,
        request: Optional[Request] = None
    ) -> List[str]:
        """
        Compare old_dict and new_dict, creating an AuditLog entry for each changed field with a shared event_id.
        """
        labels = field_labels or {}
        changed_fields = []
        batch_event_id = event_id or str(uuid.uuid4())

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
                        customer_id=customer_id,
                        business_unit=business_unit,
                        field_name=key,
                        old_value=old_val,
                        new_value=new_val,
                        description=desc,
                        event_id=batch_event_id,
                        request=request
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
