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
    def _parse_user_agent(ua_str: Optional[str]):
        if not ua_str:
            return "Unknown Browser", "Unknown OS", "Desktop"
        ua = ua_str.lower()
        
        # Browser
        browser = "Chrome"
        if "edg/" in ua or "edge" in ua:
            browser = "Edge"
        elif "firefox" in ua:
            browser = "Firefox"
        elif "safari" in ua and "chrome" not in ua:
            browser = "Safari"
        elif "opera" in ua or "opr/" in ua:
            browser = "Opera"
        elif "chrome" in ua:
            browser = "Chrome"

        # OS
        os = "Windows"
        if "windows" in ua:
            os = "Windows 11" if "nt 10.0" in ua else "Windows"
        elif "macintosh" in ua or "mac os" in ua:
            os = "macOS"
        elif "android" in ua:
            os = "Android"
        elif "iphone" in ua or "ipad" in ua:
            os = "iOS"
        elif "linux" in ua:
            os = "Linux"

        # Device Type
        device = "Desktop"
        if "mobile" in ua or "iphone" in ua or "android" in ua:
            device = "Mobile"
        elif "ipad" in ua or "tablet" in ua:
            device = "Tablet"

        return browser, os, device

    @staticmethod
    def record(
        db: Session,
        user_id: Optional[int],
        module: str,
        entity_type: str,
        entity_id: Any,
        action: str,
        resource_name: Optional[str] = None,
        source: Optional[str] = "WEB",
        category: Optional[str] = None,
        session_id: Optional[str] = None,
        ip_risk: Optional[str] = None,
        correlation_id: Optional[str] = None,
        target_user_id: Optional[int] = None,
        target_customer_id: Optional[int] = None,
        target_department: Optional[str] = None,
        snapshot_json: Optional[Any] = None,
        outcome: Optional[str] = "SUCCESS",
        duration_ms: Optional[int] = None,
        project_id: Optional[int] = None,
        customer_id: Optional[int] = None,
        business_unit: Optional[str] = None,
        field_name: Optional[str] = None,
        old_value: Optional[Any] = None,
        new_value: Optional[Any] = None,
        description: Optional[str] = None,
        event_id: Optional[str] = None,
        severity: Optional[str] = None,
        login_method: Optional[str] = None,
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
            snap_str = AuditService._format_value(snapshot_json) if snapshot_json else None
            evt_id = event_id or str(uuid.uuid4())
            act_upper = action.upper()

            # Auto derive severity if not provided
            sev = severity
            if not sev:
                if act_upper in ["CHANGE_ROLE", "DELETE_USER", "DELETE_CUSTOMER", "LOCK_ACCOUNT", "DELETE_PROJECT"] or module in ["Permission"]:
                    sev = "CRITICAL"
                elif act_upper in ["FAILED_LOGIN", "SESSION_EXPIRED", "RESTORE"] or module in ["KPI Engine", "AI Config"]:
                    sev = "WARNING"
                else:
                    sev = "INFO"

            # Auto derive Category (Security, Administration, Configuration, Integration, System)
            cat = category
            if not cat:
                mod_l = module.lower()
                if mod_l in ["authentication", "permission"] or act_upper in ["LOGIN", "FAILED_LOGIN", "LOGOUT", "CHANGE_ROLE", "LOCK_ACCOUNT", "UNLOCK_ACCOUNT"]:
                    cat = "Security"
                elif mod_l in ["user", "member", "customer"]:
                    cat = "Administration"
                elif mod_l in ["setting", "settings", "kpi engine", "ai config", "template", "prompt", "system category"]:
                    cat = "Configuration"
                elif mod_l in ["integration", "slack", "webhook"] or source == "GOOGLE_OAUTH":
                    cat = "Integration"
                else:
                    cat = "System"

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
            sess_id = session_id
            corr_id = correlation_id

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
                if not sess_id:
                    sess_id = request.headers.get("X-Session-ID") or (request.headers.get("Authorization", "")[-16:] if request.headers.get("Authorization") else None)
                if not corr_id:
                    corr_id = request.headers.get("X-Request-ID") or evt_id[:18]

            # Auto derive IP Risk (Internal, Trusted, Unknown)
            ip_r = ip_risk
            if not ip_r:
                if not ip or ip in ["127.0.0.1", "::1", "localhost"] or ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("172."):
                    ip_r = "Internal"
                else:
                    ip_r = "Unknown"

            # Parse User-Agent into browser, os, device_type
            browser_name, os_name, dev_type = AuditService._parse_user_agent(ua)

            # Check NEW_IP and NEW_DEVICE for user security alert
            new_ip_flag = False
            new_dev_flag = False
            if user_id and ip:
                prev_ip = db.query(AuditLog).filter(AuditLog.user_id == user_id, AuditLog.ip_address == ip).first()
                if not prev_ip:
                    new_ip_flag = True
            if user_id and ua:
                prev_dev = db.query(AuditLog).filter(AuditLog.user_id == user_id, AuditLog.user_agent == ua).first()
                if not prev_dev:
                    new_dev_flag = True

            log_entry = AuditLog(
                event_id=evt_id,
                business_unit=bu,
                customer_id=customer_id,
                project_id=project_id,
                module=module,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                resource_name=resource_name or str(entity_id or ""),
                source=source or "WEB",
                category=cat,
                session_id=sess_id,
                ip_risk=ip_r,
                correlation_id=corr_id,
                target_user_id=target_user_id,
                target_customer_id=target_customer_id,
                target_department=target_department,
                snapshot_json=snap_str,
                outcome=outcome or "SUCCESS",
                duration_ms=duration_ms,
                browser=browser_name,
                os=os_name,
                device_type=dev_type,
                is_new_ip=new_ip_flag,
                is_new_device=new_dev_flag,
                action=act_upper,
                severity=sev,
                login_method=login_method,
                field_name=field_name,
                old_value=old_str,
                new_value=new_str,
                description=description,
                user_id=user_id,
                ip_address=ip[:50] if ip else None,
                user_agent=ua[:255] if ua else None,
                request_url=url[:255] if url else None
            )
            with db.begin_nested():
                db.add(log_entry)

                # Auto-update project's last_activity_at timestamp
                if project_id:
                    try:
                        from sqlalchemy import func
                        db.query(Project).filter(Project.id == project_id).update({"last_activity_at": func.now()}, synchronize_session=False)
                    except Exception:
                        pass

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
