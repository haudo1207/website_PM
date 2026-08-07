"""
System Audit Router — Global System Audit Dashboard APIs for Admins.
"""
import csv
import io
import datetime
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
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    db: Session = Depends(get_db)
):
    """Returns paginated global system audit logs with rich multi-attribute filters."""
    q = db.query(AuditLog)

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
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            or_(
                AuditLog.description.ilike(s),
                AuditLog.field_name.ilike(s),
                AuditLog.entity_type.ilike(s),
                AuditLog.old_value.ilike(s),
                AuditLog.new_value.ilike(s),
                AuditLog.ip_address.ilike(s)
            )
        )
    if start_date:
        q = q.filter(AuditLog.created_at >= start_date)
    if end_date:
        q = q.filter(AuditLog.created_at <= end_date + " 23:59:59")

    total = q.count()
    logs = q.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
        "items": [log.to_dict() for log in logs]
    }


@router.get("/export")
def export_system_audit_logs(
    business_unit: Optional[str] = None,
    project_id: Optional[int] = None,
    module: Optional[str] = None,
    action: Optional[str] = None,
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
        "Hành động", "Trường thay đổi", "Giá trị cũ", "Giá trị mới", "Mô tả", "IP Address", "Browser"
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
