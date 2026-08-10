"""
System Audit Router — Global System Audit Dashboard APIs for Admins.
"""
import csv
import io
import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func, or_, and_, desc

from ..database import get_db
from ..models.audit_log import AuditLog
from ..models.project import Project
from ..models.user import User
from ..models.member import Member
from ..utils.auth import get_current_user, require_admin
from ..utils.access import get_workspaces, resolve_workspace

router = APIRouter(prefix="/system-audit", tags=["system-audit"], dependencies=[Depends(require_admin)])


@router.get("/stats")
def get_system_audit_stats(
    period: str = Query("today", description="today, 7days, 30days, custom"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Returns summary stats counts (Create, Update, Delete, AI Check, Login, Failed Login)."""
    now = datetime.datetime.now()
    q = db.query(AuditLog)

    if period == "today":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        q = q.filter(AuditLog.created_at >= today_start)
    elif period == "7days":
        seven_days_ago = now - datetime.timedelta(days=7)
        q = q.filter(AuditLog.created_at >= seven_days_ago)
    elif period == "30days":
        thirty_days_ago = now - datetime.timedelta(days=30)
        q = q.filter(AuditLog.created_at >= thirty_days_ago)
    elif period == "custom" and (start_date or end_date):
        if start_date:
            q = q.filter(AuditLog.created_at >= start_date)
        if end_date:
            q = q.filter(AuditLog.created_at <= end_date + " 23:59:59")

    # Counts
    create_cnt = q.filter(AuditLog.action == "CREATE").count()
    update_cnt = q.filter(AuditLog.action == "UPDATE").count()
    delete_cnt = q.filter(AuditLog.action == "DELETE").count()
    ai_check_cnt = q.filter(AuditLog.action == "CHECK").count()
    login_cnt = q.filter(AuditLog.action == "LOGIN").count()
    failed_login_cnt = q.filter(AuditLog.action == "FAILED_LOGIN").count()

    return {
        "period": period,
        "create_count": create_cnt,
        "update_count": update_cnt,
        "delete_count": delete_cnt,
        "ai_check_count": ai_check_cnt,
        "login_count": login_cnt,
        "failed_login_count": failed_login_cnt
    }


@router.get("/logs")
def get_system_audit_logs(
    business_unit: Optional[str] = None,
    project_id: Optional[int] = None,
    module: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    login_method: Optional[str] = None,
    source: Optional[str] = None,
    category: Optional[str] = None,
    ip_risk: Optional[str] = None,
    outcome: Optional[str] = None,
    session_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    target_user_id: Optional[int] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    db: Session = Depends(get_db)
):
    """Returns paginated global system audit logs with event grouping and multi-attribute filters."""
    q = db.query(AuditLog)

    # System Audit Scope: Exclude operational project progress logs
    if not module or module.strip().lower() == "all":
        q = q.filter(AuditLog.module.not_in(["Project", "Phase", "Task Group", "Task", "Meeting"]))

    if business_unit and business_unit.strip().lower() != "all":
        bu = business_unit.strip().lower()
        ws = resolve_workspace(db, bu)
        if ws is None:
            q = q.filter(AuditLog.id == -1)
        else:
            bu_filters = [
                AuditLog.business_unit.ilike(ws.code),
                AuditLog.business_unit.ilike(ws.name),
                AuditLog.business_unit.ilike("all"),
            ]
            workspaces = get_workspaces(db)
            if workspaces and ws.id == workspaces[0].id:
                bu_filters.append(AuditLog.business_unit.is_(None))
            q = q.filter(or_(*bu_filters))
    if project_id:
        q = q.filter(AuditLog.project_id == project_id)
    if module and module.strip().lower() != "all":
        q = q.filter(AuditLog.module.ilike(module.strip()))
    if action and action.strip().lower() != "all":
        q = q.filter(AuditLog.action.ilike(action.strip()))
    if severity and severity.strip().lower() != "all":
        q = q.filter(AuditLog.severity.ilike(severity.strip()))
    if login_method and login_method.strip().lower() != "all":
        q = q.filter(AuditLog.login_method.ilike(login_method.strip()))
    if source and source.strip().lower() != "all":
        q = q.filter(AuditLog.source.ilike(source.strip()))
    if category and category.strip().lower() != "all":
        q = q.filter(AuditLog.category.ilike(category.strip()))
    if ip_risk and ip_risk.strip().lower() != "all":
        q = q.filter(AuditLog.ip_risk.ilike(ip_risk.strip()))
    if outcome and outcome.strip().lower() != "all":
        q = q.filter(AuditLog.outcome.ilike(outcome.strip()))
    if session_id and session_id.strip():
        q = q.filter(AuditLog.session_id == session_id.strip())
    if correlation_id and correlation_id.strip():
        q = q.filter(AuditLog.correlation_id == correlation_id.strip())
    if target_user_id:
        q = q.filter(AuditLog.target_user_id == target_user_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            or_(
                AuditLog.description.ilike(s),
                AuditLog.resource_name.ilike(s),
                AuditLog.field_name.ilike(s),
                AuditLog.entity_type.ilike(s),
                AuditLog.old_value.ilike(s),
                AuditLog.new_value.ilike(s),
                AuditLog.snapshot_json.ilike(s),
                AuditLog.target_department.ilike(s),
                AuditLog.browser.ilike(s),
                AuditLog.os.ilike(s),
                AuditLog.session_id.ilike(s),
                AuditLog.correlation_id.ilike(s),
                AuditLog.ip_address.ilike(s)
            )
        )
    if start_date:
        q = q.filter(AuditLog.created_at >= start_date)
    if end_date:
        q = q.filter(AuditLog.created_at <= end_date + " 23:59:59")

    # Fetch logs ordered newest first
    all_matching_logs = q.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).all()

    # Event Grouping: Group logs by event_id
    grouped_events = []
    seen_event_ids = set()

    for log in all_matching_logs:
        evt_key = log.event_id or f"single-{log.id}"
        if evt_key in seen_event_ids:
            continue
        seen_event_ids.add(evt_key)

        # Collect all diff rows belonging to this same event_id
        same_event_logs = [l for l in all_matching_logs if (l.event_id or f"single-{l.id}") == evt_key]
        
        base_dict = log.to_dict()
        changes = []
        for l in same_event_logs:
            if l.field_name or l.old_value or l.new_value:
                changes.append({
                    "field_name": l.field_name or "General",
                    "old_value": l.old_value or "",
                    "new_value": l.new_value or "",
                    "description": l.description or ""
                })

        base_dict["changes_count"] = len(changes) if len(changes) > 0 else 1
        base_dict["changes"] = changes
        
        # Build human readable summary with resource name
        if len(changes) > 1:
            base_dict["description"] = f"{log.user_name} đã cập nhật {log.module} '{log.resource_name or log.entity_id}' ({len(changes)} thay đổi)"

        grouped_events.append(base_dict)

    total = len(grouped_events)
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paged_items = grouped_events[start_idx:end_idx]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
        "items": paged_items
    }


@router.get("/export")
def export_system_audit_logs(
    business_unit: Optional[str] = None,
    project_id: Optional[int] = None,
    module: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    login_method: Optional[str] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Export global system audit logs to UTF-8 CSV file."""
    q = db.query(AuditLog)

    if business_unit and business_unit.strip().lower() != "all":
        ws = resolve_workspace(db, business_unit.strip().lower())
        if ws:
            q = q.filter(or_(
                AuditLog.business_unit.ilike(ws.code),
                AuditLog.business_unit.ilike(ws.name),
                AuditLog.business_unit.ilike("all"),
            ))
        else:
            q = q.filter(AuditLog.id == -1)
    if project_id:
        q = q.filter(AuditLog.project_id == project_id)
    if module and module.strip().lower() != "all":
        q = q.filter(AuditLog.module.ilike(module.strip()))
    if action and action.strip().lower() != "all":
        q = q.filter(AuditLog.action.ilike(action.strip()))
    if severity and severity.strip().lower() != "all":
        q = q.filter(AuditLog.severity.ilike(severity.strip()))
    if login_method and login_method.strip().lower() != "all":
        q = q.filter(AuditLog.login_method.ilike(login_method.strip()))
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(or_(AuditLog.description.ilike(s), AuditLog.field_name.ilike(s)))
    if start_date:
        q = q.filter(AuditLog.created_at >= start_date)
    if end_date:
        q = q.filter(AuditLog.created_at <= end_date + " 23:59:59")

    logs = q.order_by(AuditLog.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Thời gian", "Người thực hiện", "Business Unit", "Project", "Module",
        "Hành động", "Mức độ (Severity)", "Phương thức Login", "Trường thay đổi", "Giá trị cũ", "Giá trị mới", "Mô tả", "IP Address", "Browser"
    ])

    for log in logs:
        user_name = log.user.full_name or log.user.display_name or log.user.email if log.user else "System"
        proj_name = log.project.name if log.project else ""
        created_str = log.created_at.strftime("%d/%m/%Y %H:%M:%S") if log.created_at else ""
        writer.writerow([
            log.id,
            created_str,
            user_name,
            log.business_unit or "All",
            proj_name,
            log.module,
            log.action,
            log.severity or "INFO",
            log.login_method or "",
            log.field_name or "",
            log.old_value or "",
            log.new_value or "",
            log.description or "",
            log.ip_address or "",
            log.user_agent or ""
        ])

    csv_data = "\ufeff" + output.getvalue()  # Add UTF-8 BOM for Excel
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=system_audit_logs.csv"}
    )


@router.get("/analytics")
def get_system_audit_analytics(db: Session = Depends(get_db)):
    """Returns top analytics metrics (Top Active Users, Top Updated Projects, Top AI Users, Top Login Failures)."""
    # Top Active Users
    top_users_query = db.query(
        AuditLog.user_id,
        sql_func.count(AuditLog.id).label("total_actions")
    ).filter(AuditLog.user_id.isnot(None)).group_by(AuditLog.user_id).order_by(desc("total_actions")).limit(5).all()

    top_users = []
    for uid, count in top_users_query:
        u = db.query(User).filter(User.id == uid).first()
        top_users.append({
            "user_id": uid,
            "name": (u.full_name or u.email) if u else f"User #{uid}",
            "total_actions": count
        })

    # Top Updated Projects
    top_projects_query = db.query(
        AuditLog.project_id,
        sql_func.count(AuditLog.id).label("total_updates")
    ).filter(AuditLog.project_id.isnot(None)).group_by(AuditLog.project_id).order_by(desc("total_updates")).limit(5).all()

    top_projects = []
    for pid, count in top_projects_query:
        p = db.query(Project).filter(Project.id == pid).first()
        top_projects.append({
            "project_id": pid,
            "name": p.name if p else f"Project #{pid}",
            "total_updates": count
        })

    # Top AI Users
    top_ai_query = db.query(
        AuditLog.user_id,
        sql_func.count(AuditLog.id).label("total_checks")
    ).filter(AuditLog.action == "CHECK", AuditLog.user_id.isnot(None)).group_by(AuditLog.user_id).order_by(desc("total_checks")).limit(5).all()

    top_ai_users = []
    for uid, count in top_ai_query:
        u = db.query(User).filter(User.id == uid).first()
        top_ai_users.append({
            "user_id": uid,
            "name": (u.full_name or u.email) if u else f"User #{uid}",
            "total_checks": count
        })

    # Top Login Failures
    top_failures_query = db.query(
        AuditLog.ip_address,
        sql_func.count(AuditLog.id).label("total_failures")
    ).filter(AuditLog.action == "FAILED_LOGIN").group_by(AuditLog.ip_address).order_by(desc("total_failures")).limit(5).all()

    top_failures = [
        {"ip_address": ip or "Unknown", "total_failures": count}
        for ip, count in top_failures_query
    ]

    return {
        "top_active_users": top_users,
        "top_updated_projects": top_projects,
        "top_ai_users": top_ai_users,
        "top_login_failures": top_failures
    }


@router.get("/export-json")
def export_system_audit_logs_json(
    search: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Export global system audit logs as structured JSON array for external SIEM/SOC forensic tools."""
    q = db.query(AuditLog).filter(AuditLog.module.not_in(["Project", "Phase", "Task Group", "Task", "Meeting"]))
    if category and category.strip().lower() != "all":
        q = q.filter(AuditLog.category.ilike(category.strip()))
    if source and source.strip().lower() != "all":
        q = q.filter(AuditLog.source.ilike(source.strip()))
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(or_(AuditLog.description.ilike(s), AuditLog.resource_name.ilike(s)))

    logs = q.order_by(AuditLog.created_at.desc()).limit(1000).all()
    data = [l.to_dict() for l in logs]
    
    return Response(
        content=json.dumps(data, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=System_Audit_Logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"}
    )


@router.get("/session-timeline/{session_id}")
def get_session_timeline(
    session_id: str,
    db: Session = Depends(get_db)
):
    """Returns chronological event timeline for a specific User Login Session ID."""
    logs = db.query(AuditLog).filter(
        AuditLog.session_id == session_id
    ).order_by(AuditLog.created_at.asc()).all()

    return {
        "session_id": session_id,
        "total_events": len(logs),
        "events": [l.to_dict() for l in logs]
    }
