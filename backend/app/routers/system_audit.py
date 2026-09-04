"""
System Audit Router — Global System Audit Dashboard APIs for Admins.
"""
import csv
import io
import json
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func, or_, and_, desc, case

from ..database import get_db
from ..models.audit_log import AuditLog
from ..models.project import Project, project_members
from ..models.user import User
from ..models.member import Member
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..models.phase import Phase
from ..utils.auth import get_current_user, require_admin, require_audit_user
from ..utils.access import (
    get_workspaces,
    resolve_workspace,
    audit_log_query_for_user,
    user_allowed_scopes,
    ROLE_SUPER_ADMIN,
    ROLE_LEADER,
    ALL_SCOPE,
)
from ..utils.project_progress import get_progress_pct_for_phase

router = APIRouter(prefix="/system-audit", tags=["system-audit"], dependencies=[Depends(require_audit_user)])


@router.get("/stats")
def get_system_audit_stats(
    period: str = Query("today", description="today, 7days, 30days, custom"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Returns summary stats counts (Create, Update, Delete, AI Check, Login, Failed Login).

    Scoped to the caller's Workspaces for Leader accounts (see
    `audit_log_query_for_user`) — Super Admin continues to see every event.
    """
    now = datetime.now()
    q = audit_log_query_for_user(db, current_user)

    if period == "today":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        q = q.filter(AuditLog.created_at >= today_start)
    elif period == "7days":
        seven_days_ago = now - timedelta(days=7)
        q = q.filter(AuditLog.created_at >= seven_days_ago)
    elif period == "30days":
        thirty_days_ago = now - timedelta(days=30)
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
    # LOGIN / FAILED_LOGIN events are global by nature (no Workspace
    # context). They are surfaced only to Super Admin — for Leader the
    # count is the number of login events tied to a Workspace in their
    # scope, which is normally zero. This matches the rule "Leader sees
    # only data related to their assigned Workspaces".
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
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Returns paginated global system audit logs with event grouping and multi-attribute filters.

    Always scoped to the caller's Workspaces (see
    `audit_log_query_for_user`). A Leader who manually picks a
    `business_unit` filter is constrained to filters inside their assigned
    set — selecting a Workspace outside their scope yields an empty result
    rather than leaking data.
    """
    q = audit_log_query_for_user(db, current_user)

    # System Audit Scope: exclude high-volume, low-signal operational noise
    # (per-task status edits, task-group/phase shuffling) from the default
    # "all module" view — but NOT "Project" itself. Project CREATE/UPDATE/
    # DELETE are comparatively rare and always worth surfacing by default;
    # excluding the whole module used to hide them too, so admins had no way
    # to see "who created/deleted/renamed which project" without manually
    # picking module=Project every time.
    if not module or module.strip().lower() == "all":
        q = q.filter(AuditLog.module.not_in(["Phase", "Task Group", "Task", "Meeting"]))

    if business_unit and business_unit.strip().lower() != "all":
        bu = business_unit.strip().lower()
        # Leader: refuse workspaces outside their assigned scope (return empty).
        scopes = user_allowed_scopes(db, current_user)
        role = getattr(current_user, "role", None)
        if role == ROLE_LEADER and scopes != ALL_SCOPE and bu not in scopes:
            q = q.filter(AuditLog.id == -1)
        else:
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

    # Event Grouping: Group logs by event_id in one O(n) pass — this used to
    # re-scan the entire result set per log (O(n^2)) to find same-event rows,
    # which is fine for a handful of rows but gets slow as audit_logs grows
    # unbounded, since this endpoint has no SQL-level pagination (grouping
    # needs to see every matching row before it can page).
    logs_by_event: dict[str, list] = {}
    for log in all_matching_logs:
        evt_key = log.event_id or f"single-{log.id}"
        logs_by_event.setdefault(evt_key, []).append(log)

    grouped_events = []
    seen_event_ids = set()

    for log in all_matching_logs:
        evt_key = log.event_id or f"single-{log.id}"
        if evt_key in seen_event_ids:
            continue
        seen_event_ids.add(evt_key)

        # All diff rows belonging to this same event_id
        same_event_logs = logs_by_event[evt_key]

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
            base_dict["description"] = f"{base_dict['user_name']} đã cập nhật {log.module} '{log.resource_name or log.entity_id}' ({len(changes)} thay đổi)"

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
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Export global system audit logs to UTF-8 CSV file.

    Scoped to the caller's Workspaces (mirrors `/logs`). Leader cannot
    export events for a Workspace outside their assigned scope.
    """
    q = audit_log_query_for_user(db, current_user)

    if business_unit and business_unit.strip().lower() != "all":
        bu = business_unit.strip().lower()
        scopes = user_allowed_scopes(db, current_user)
        role = getattr(current_user, "role", None)
        if role == ROLE_LEADER and scopes != ALL_SCOPE and bu not in scopes:
            q = q.filter(AuditLog.id == -1)
        else:
            ws = resolve_workspace(db, bu)
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
def get_system_audit_analytics(db: Session = Depends(get_db), current_user=Depends(require_audit_user)):
    """Returns top analytics metrics (Top Active Users, Top Updated Projects, Top AI Users, Top Login Failures).

    All four sub-aggregations are seeded from the same Workspace-scoped
    AuditLog query (`audit_log_query_for_user`) — Super Admin keeps the
    unchanged global roll-up, Leader sees only the roll-up of activity
    inside their assigned Workspaces.
    """
    scoped_q = audit_log_query_for_user(db, current_user)

    # Top Active Users
    top_users_query = (
        scoped_q.filter(AuditLog.user_id.isnot(None))
        .with_entities(
            AuditLog.user_id,
            sql_func.count(AuditLog.id).label("total_actions"),
        )
        .group_by(AuditLog.user_id)
        .order_by(desc("total_actions"))
        .limit(5)
        .all()
    )

    top_users = []
    for uid, count in top_users_query:
        u = db.query(User).filter(User.id == uid).first()
        top_users.append({
            "user_id": uid,
            "name": (u.full_name or u.email) if u else f"User #{uid}",
            "total_actions": count
        })

    # Top Updated Projects
    top_projects_query = (
        scoped_q.filter(AuditLog.project_id.isnot(None))
        .with_entities(
            AuditLog.project_id,
            sql_func.count(AuditLog.id).label("total_updates"),
        )
        .group_by(AuditLog.project_id)
        .order_by(desc("total_updates"))
        .limit(5)
        .all()
    )

    top_projects = []
    for pid, count in top_projects_query:
        p = db.query(Project).filter(Project.id == pid).first()
        top_projects.append({
            "project_id": pid,
            "name": p.name if p else f"Project #{pid}",
            "total_updates": count
        })

    # Top AI Users
    top_ai_query = (
        scoped_q.filter(AuditLog.action == "CHECK", AuditLog.user_id.isnot(None))
        .with_entities(
            AuditLog.user_id,
            sql_func.count(AuditLog.id).label("total_checks"),
        )
        .group_by(AuditLog.user_id)
        .order_by(desc("total_checks"))
        .limit(5)
        .all()
    )

    top_ai_users = []
    for uid, count in top_ai_query:
        u = db.query(User).filter(User.id == uid).first()
        top_ai_users.append({
            "user_id": uid,
            "name": (u.full_name or u.email) if u else f"User #{uid}",
            "total_checks": count
        })

    # Top Login Failures — failed_logins are global security events with
    # no Workspace context, so they remain Super Admin only. For Leader
    # this list is always empty (no rows match the Workspace scope).
    top_failures_query = (
        scoped_q.filter(AuditLog.action == "FAILED_LOGIN")
        .with_entities(
            AuditLog.ip_address,
            sql_func.count(AuditLog.id).label("total_failures"),
        )
        .group_by(AuditLog.ip_address)
        .order_by(desc("total_failures"))
        .limit(5)
        .all()
    )

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
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Export global system audit logs as structured JSON array for external SIEM/SOC forensic tools.

    Scoped to the caller's Workspaces — Leader only exports events
    related to their assigned Workspaces.
    """
    q = audit_log_query_for_user(db, current_user).filter(AuditLog.module.not_in(["Phase", "Task Group", "Task", "Meeting"]))
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
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Returns chronological event timeline for a specific User Login Session ID.

    Scoped to the caller's Workspaces — Leader only sees events for sessions
    that touched projects or Workspaces they have access to.
    """
    q = audit_log_query_for_user(db, current_user).filter(
        AuditLog.session_id == session_id
    )
    logs = q.order_by(AuditLog.created_at.asc()).all()

    return {
        "session_id": session_id,
        "total_events": len(logs),
        "events": [l.to_dict() for l in logs]
    }


# ─── TEAM COMPARISON (Dashboard → System Audit — Sections 2 & 3) ──
# Both endpoints are super_admin-only (router-wide `require_admin` dependency)
# and re-use existing models, KPI fields, status logic and the existing
# canonical Leader identity (`User.role=leader` + `is_active`). The team is
# defined strictly as: every Member whose `leader_member_id` points at the
# Leader's canonical Member.id, plus the Leader's own Member row.
# Leaders with zero managed members are excluded, matching the existing
# Leader Card semantics used elsewhere in the dashboard.

def _leader_display(u: User) -> str:
    """Mirror the canonical display-name rule used in
    `routers/members.list_leaders` / `utils.access.workspace_leader_names`
    so System Audit speaks the same Leader identity as the rest of the app.
    """
    m = getattr(u, "member", None)
    if m and getattr(m, "display_name", None):
        n = m.display_name
    elif m and getattr(m, "full_name", None):
        n = m.full_name
    else:
        n = u.full_name or (u.email.split("@")[0] if u.email else "")
    n = (n or "").strip()
    return n


def _team_health(done: int, total: int, overdue: int) -> str:
    """Lightweight team-health bucket, identical to the per-project rule
    used by the existing `/all-tasks-global` row-counting logic (overdue
    density). Kept simple on purpose — the system audit page already shows
    project-level risk; this is the team rollup of the same signal."""
    if total <= 0:
        return "N/A"
    overdue_ratio = overdue / max(total, 1)
    if overdue_ratio >= 0.3 or overdue >= 3:
        return "Critical"
    if overdue_ratio >= 0.1 or overdue >= 1:
        return "Risk"
    return "On Track"


@router.get("/team-comparison")
def get_team_comparison(
    workspace: Optional[str] = Query(
        None,
        description=(
            "Workspace code (e.g. 'infrastructure', 'markee') or 'all'. "
            "Omit / 'all' = no workspace filter. Leaders with data_scope='all' "
            "are always included; specific-scope leaders are included only when "
            "their data_scope matches the requested workspace."
        ),
    ),
    start_date: Optional[str] = Query(
        None,
        description=(
            "Optional inclusive start date (YYYY-MM-DD). When provided, "
            "task-level aggregations (kpi / manday / overdue / progress / "
            "timeline) are restricted to tasks whose deadline (or created_at) "
            "falls within [start_date, end_date]. Omit = no time filter "
            "(preserves the existing behaviour)."
        ),
    ),
    end_date: Optional[str] = Query(
        None,
        description=(
            "Optional inclusive end date (YYYY-MM-DD). Pairs with start_date; "
            "omit = no time filter (preserves the existing behaviour)."
        ),
    ),
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Per-Leader team aggregates for the System Audit "So sánh Team" section.

    Thin wrapper around the shared aggregator. The endpoint deliberately
    mirrors the existing `/all-tasks-global/summary` approach (server-side
    aggregation, no per-task row shipping) so the dashboard behaviour stays
    consistent with Overview / KPI pages. Only the data source has been
    re-grouped by `leader_member_id`.

    Workspace scoping for Leader accounts:
    - A Leader passing a `workspace` argument that isn't in their assigned
      scope gets an empty result (no 4xx — the workspace filter is treated
      as a UI hint, the actual permission comes from the Leader's grants).
    - For a Leader, the aggregator further restricts which Leader-Teams
      are eligible based on `user_allowed_scopes`, so even with
      `workspace=all` a Leader only sees Teams that touch their assigned
      Workspaces.

    Time-range filter: when `start_date` / `end_date` are provided, the
    task-level aggregations are scoped to that window so the System Audit
    page can synchronise Section 2 / 3 / 4 with the selected time range.
    Existing callers that omit these parameters get the original
    (unfiltered) behaviour unchanged.
    """
    return _aggregate_team_comparison(
        db=db, workspace=workspace,
        start_date=start_date, end_date=end_date,
        current_user=current_user,
    )


@router.get("/team-detail")
def get_team_detail(
    leader_user_id: int = Query(..., description="Canonical User.id of the Leader"),
    start_date: Optional[str] = Query(
        None,
        description="Optional inclusive start date (YYYY-MM-DD) — see /team-comparison.",
    ),
    end_date: Optional[str] = Query(
        None,
        description="Optional inclusive end date (YYYY-MM-DD) — see /team-comparison.",
    ),
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Drill-down view for a single team — the same data shape used by the
    'Chi tiết' button in Section 2 of the System Audit. Authorised for
    super_admin and leader; the shared `_aggregate_team_comparison()`
    enforces the Leader's Workspace scope so a Leader can only drill into
    a team that touches one of their granted Workspaces.

    Returns team identity + members + projects so the frontend can render
    the existing detail-drawer pattern without issuing any extra requests.
    """
    payload = _aggregate_team_comparison(
        db=db, workspace=None,
        start_date=start_date, end_date=end_date,
        current_user=current_user,
    )
    for team in payload.get("teams", []):
        if team.get("leader_user_id") == leader_user_id:
            return {"team": team}
    raise HTTPException(404, "Không tìm thấy team cho Leader này (hoặc Leader không có thành viên được quản lý).")


def _aggregate_team_comparison(
    db: Session,
    workspace: Optional[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user=None,
):
    """Shared team-comparison aggregator used by both `team-comparison` and
    `team-detail`. Eligibility (matches the rules specified for the System
    Audit extension):
      - The Leader is a canonical portal Leader (`User.role='leader'`,
        `is_active=True`).
      - The Leader has at least one managed member (a Member whose
        `leader_member_id` resolves to the Leader's `Member.id`).
      - The Leader's `data_scope` is either 'all' or matches the requested
        workspace filter.

    Leader Workspace scoping:
      When `current_user` is a Leader (not super_admin), this aggregator
      restricts both the eligible Leader set and the project rollup to the
      Workspaces the caller is granted. The optional `workspace` argument
      is treated as a hint, not a permission — a Leader passing a workspace
      outside their assigned set gets an empty response.

    Optional time-range filter (Requirement 2 — System Audit global sync):
      When `start_date` / `end_date` are provided, every per-task aggregate
      below (assigned, support, project rollup) is restricted to tasks
      whose `end_date_est` falls inside the window (falling back to
      `start_date` / `created_at` when no deadline is set). Omitting the
      parameters preserves the original behaviour.

    Returns a flat team list with team identity, KPI / Manday / Efficiency
    / On-time / Health, plus a per-member breakdown and the projects that
    touch the team.
    """
    today = datetime.now().date()

    # Resolve the caller's Workspace scope (ALL_SCOPE for super_admin).
    caller_scopes = None
    caller_is_super_admin = True
    if current_user is not None:
        caller_scopes = user_allowed_scopes(db, current_user)
        caller_is_super_admin = (
            getattr(current_user, "role", None) == ROLE_SUPER_ADMIN
            or caller_scopes == ALL_SCOPE
        )

    # Parse optional time window. Both inclusive.
    parsed_start: Optional[datetime] = None
    parsed_end: Optional[datetime] = None
    if start_date:
        try:
            parsed_start = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            parsed_start = None
    if end_date:
        try:
            # inclusive end-of-day so callers can pass the same calendar day
            parsed_end = datetime.strptime(end_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, microsecond=999999
            )
        except ValueError:
            parsed_end = None

    # 1. Canonical Leaders (active portal users with role=leader).
    leaders = (
        db.query(User)
        .filter(User.role == "leader", User.is_active == True)  # noqa: E712
        .all()
    )

    # 2. Resolve the workspace filter.
    ws_filter = (workspace or "").strip().lower()
    if ws_filter in ("", "all", "null", "none"):
        ws_filter = None
        workspace_label = "All Workspaces"
    else:
        ws_obj = resolve_workspace(db, ws_filter)
        if not ws_obj:
            raise HTTPException(
                400,
                f"Invalid workspace '{workspace}'. Use a known workspace code or 'all'.",
            )
        workspace_label = ws_obj.name

    # Leader: refuse workspaces outside their assigned scope (empty result).
    if (
        ws_filter is not None
        and current_user is not None
        and not caller_is_super_admin
        and ws_filter not in (caller_scopes or set())
    ):
        return {
            "workspace": workspace_label,
            "workspace_filter": ws_filter,
            "teams": [],
        }

    # 3. Build Leader → {leader_member_id, display, scope} map.
    leader_info = []
    seen_names = set()
    for u in leaders:
        member = getattr(u, "member", None)
        leader_member_id = getattr(u, "member_id", None) or (member.id if member else None)
        name = _leader_display(u)
        if not name:
            continue
        key = name.lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        scope = (getattr(u, "data_scope", None) or "").strip().lower() or "all"
        if scope == "":
            scope = ALL_SCOPE
        leader_info.append({
            "user_id": u.id,
            "member_id": leader_member_id,
            "name": name,
            "email": u.email or "",
            "data_scope": scope,
        })

    # 3b. For Leader callers, restrict the eligible Leader set to those
    #     whose data_scope is either 'all' (rare — only super-admin-style
    #     accounts) or matches one of the caller's allowed Workspaces.
    #     This ensures a Leader cannot see KPIs of a Team they have no
    #     visibility into, even if their Leader account happens to share
    #     the same display name.
    if current_user is not None and not caller_is_super_admin and caller_scopes:
        leader_info = [
            li for li in leader_info
            if li["data_scope"] == ALL_SCOPE or li["data_scope"] in caller_scopes
        ]

    # 4. Apply workspace filter — keep 'all'-scope leaders always, plus
    #    leaders whose scope matches the requested workspace.
    if ws_filter is not None:
        leader_info = [
            li for li in leader_info
            if li["data_scope"] == ALL_SCOPE or li["data_scope"] == ws_filter
        ]
    if not leader_info:
        return {
            "workspace": workspace_label,
            "workspace_filter": ws_filter or "all",
            "teams": [],
        }

    # 5. Members map for resolving team composition. We do this in a single
    #    bulk query, scoped to either the chosen workspace or 'all' so the
    #    result is consistent with the rest of the dashboard.
    all_members = db.query(Member).all()
    member_by_id = {m.id: m for m in all_members}

    # 6. Team composition: build a leader_member_id → [member] mapping for
    #    the leaders we kept. The existing Leader Card on the Dashboard
    #    groups members into a team by EITHER `leader_member_id` (canonical)
    #    OR a `leader_name` text match against the active Leader's display
    #    name (legacy fallback, see Reports/leader-card-architecture-
    #    reference-templ.md §17). We replicate the same rule here so the
    #    System Audit "Chi tiết" panel shows the same team the user already
    #    sees on the Overview Leader Card.
    leader_ids = {li["member_id"] for li in leader_info if li["member_id"] is not None}
    leader_name_keys = {(li["name"] or "").strip().lower(): li["member_id"] for li in leader_info if li["member_id"] is not None and li["name"]}
    # Some legacy records carry the Leader's full_name instead of the
    # abbreviated display_name; include both for the same Leader.
    leader_full_name_keys = {
        (getattr(u, "member", None).full_name if getattr(u, "member", None) else (u.full_name or "")).strip().lower(): li["member_id"]
        for li, u in [(li, next((x for x in leaders if x.id == li["user_id"]), None)) for li in leader_info]
        if li["member_id"] is not None and u is not None
        and (getattr(u, "member", None).full_name if getattr(u, "member", None) else (u.full_name or "")).strip()
    }
    leader_name_keys.update(leader_full_name_keys)
    team_by_leader: dict[int, list[Member]] = {lid: [] for lid in leader_ids}
    for m in all_members:
        lm_id = getattr(m, "leader_member_id", None)
        if lm_id is not None and lm_id in team_by_leader:
            team_by_leader[lm_id].append(m)
            continue
        # Legacy fallback: leader_name string match.
        leader_name = (getattr(m, "leader_name", None) or "").strip().lower()
        if leader_name and leader_name in leader_name_keys:
            target = leader_name_keys[leader_name]
            # Avoid double-counting if the member already had leader_member_id
            # pointing at a different Leader — the canonical link wins.
            if lm_id is None or lm_id != target:
                team_by_leader.setdefault(target, []).append(m)

    # Drop leaders with zero managed members (rule: only show Leaders that
    # actually have managed members). This is the System Audit eligibility
    # rule, applied here so the frontend does not need to filter further.
    leader_info = [
        li for li in leader_info
        if li["member_id"] is not None and len(team_by_leader.get(li["member_id"], [])) > 0
    ]
    if not leader_info:
        return {
            "workspace": workspace_label,
            "workspace_filter": ws_filter or "all",
            "teams": [],
        }

    # 7. Build member-id list across all kept leaders, fetch tasks in one go.
    team_member_ids: set[int] = set()
    for li in leader_info:
        for m in team_by_leader.get(li["member_id"], []):
            if m.id is not None:
                team_member_ids.add(m.id)
    if not team_member_ids:
        return {
            "workspace": workspace_label,
            "workspace_filter": ws_filter or "all",
            "teams": [],
        }

    # 8. Single grouped SQL aggregation. Mirrors `/all-tasks-global/summary`:
    #    * assigned  -> contributes kpi_assigned, manday_actual for assigned_id
    #    * support   -> contributes kpi_support  for support_id
    #    The 'overdue' count is derived the same way as the global summary
    #    (status not Done/Cancel AND end_date_est < today).
    overdue_expr = case(
        (
            (Task.status.notin_(["Done", "done", "Cancel", "cancel"]))
            & (Task.end_date_est.isnot(None))
            & (Task.end_date_est < today),
            1,
        ),
        else_=0,
    )
    done_expr = case((Task.status.in_(["Done", "done"]), 1), else_=0)

    # Time-range window clause: a task belongs to the window if its
    # `end_date_est` (preferred), else its `start_date`, else its
    # `created_at`, falls inside [parsed_start, parsed_end]. When no window
    # is provided we skip the clause entirely (preserves existing
    # behaviour).
    time_filters = []
    if parsed_start is not None or parsed_end is not None:
        # Coalesce to the most informative date the task has.
        task_date_expr = sql_func.coalesce(
            Task.end_date_est, Task.start_date, Task.created_at
        )
        if parsed_start is not None:
            time_filters.append(task_date_expr >= parsed_start)
        if parsed_end is not None:
            time_filters.append(task_date_expr <= parsed_end)

    member_rows = (
        db.query(
            Task.assigned_id.label("member_id"),
            sql_func.count(Task.id).label("assigned_total"),
            sql_func.sum(done_expr).label("assigned_done"),
            sql_func.sum(overdue_expr).label("assigned_overdue"),
            sql_func.sum(Task.manday_est).label("assigned_manday_est"),
            sql_func.sum(Task.manday_actual).label("assigned_manday_actual"),
            sql_func.sum(Task.kpi_assigned).label("assigned_kpi"),
        )
        .filter(Task.assigned_id.in_(team_member_ids))
        .group_by(Task.assigned_id)
    )
    if time_filters:
        member_rows = member_rows.filter(*time_filters)
    member_rows = member_rows.all()

    support_rows = (
        db.query(
            Task.support_id.label("member_id"),
            sql_func.count(Task.id).label("support_total"),
            sql_func.sum(done_expr).label("support_done"),
            sql_func.sum(overdue_expr).label("support_overdue"),
            sql_func.sum(Task.manday_est).label("support_manday_est"),
            sql_func.sum(Task.manday_actual).label("support_manday_actual"),
            sql_func.sum(Task.kpi_support).label("support_kpi"),
        )
        # Exclude self-supported tasks from the "support" rollup so the same
        # Task isn't counted twice for the same Member (one as assigned, one as
        # support) — Fix for Issue 1 (System Audit Section 4 double-counting).
        # Such tasks are still aggregated under their assigned_* fields above,
        # which is the canonical "owner" view.
        .filter(
            Task.support_id.in_(team_member_ids),
            Task.support_id != Task.assigned_id,
        )
        .group_by(Task.support_id)
    )
    if time_filters:
        support_rows = support_rows.filter(*time_filters)
    support_rows = support_rows.all()

    # 9. Project rollup: which projects touch this team? We need this both
    #    for the team-level KPI/manday context AND for Section 3's
    #    "Project comparison by team" view, so we build a per-project row
    #    tied to its assigned members.
    #
    # IMPORTANT: The project list is NOT filtered by the caller's Workspace
    # scope. The task aggregation (step 8) already includes ALL tasks for
    # team members across ALL Workspaces — filtering the project list by
    # Workspace would hide projects that the team actually works on,
    # creating a mismatch between the metrics (which are cross-Workspace)
    # and the visible project list. Workspace filtering controls which
    # Leaders/Teams are displayed, NOT which projects they are responsible
    # for once a Team is included.
    proj_rows_q = db.query(
        Project.id.label("project_id"),
        Project.name.label("name"),
        Project.status.label("status"),
        Project.current_phase.label("current_phase"),
        Project.data_scope.label("data_scope"),
        Project.business.label("business"),
    )
    proj_rows = proj_rows_q.order_by(Project.id.asc()).all()
    project_member_rows = (
        db.query(
            project_members.c.project_id,
            project_members.c.member_id,
            project_members.c.role,
        )
        .filter(project_members.c.member_id.in_(team_member_ids))
        .all()
    )
    pm_index: dict[int, list[dict]] = {}
    for pid, mid, role in project_member_rows:
        pm_index.setdefault(pid, []).append({"member_id": mid, "role": role})
    proj_row_by_id = {r.project_id: r for r in proj_rows}

    # 10. Assemble per-member, per-team metrics.
    per_member: dict[int, dict] = {mid: {
        "assigned_total": 0, "assigned_done": 0, "assigned_overdue": 0,
        "assigned_manday_est": 0.0, "assigned_manday_actual": 0.0,
        "assigned_kpi": 0.0,
        "support_total": 0, "support_done": 0, "support_overdue": 0,
        "support_manday_est": 0.0, "support_manday_actual": 0.0,
        "support_kpi": 0.0,
    } for mid in team_member_ids}

    for mid, total, done, overdue, md_est, md_act, kpi in member_rows:
        row = per_member.get(mid)
        if not row:
            continue
        row["assigned_total"] = int(total or 0)
        row["assigned_done"] = int(done or 0)
        row["assigned_overdue"] = int(overdue or 0)
        row["assigned_manday_est"] = float(md_est or 0)
        row["assigned_manday_actual"] = float(md_act or 0)
        row["assigned_kpi"] = float(kpi or 0)

    for mid, total, done, overdue, md_est, md_act, kpi in support_rows:
        row = per_member.get(mid)
        if not row:
            continue
        row["support_total"] = int(total or 0)
        row["support_done"] = int(done or 0)
        row["support_overdue"] = int(overdue or 0)
        row["support_manday_est"] = float(md_est or 0)
        row["support_manday_actual"] = float(md_act or 0)
        row["support_kpi"] = float(kpi or 0)

    # 11. Project rollup per project — only projects that have at least one
    #     member from any kept team. This is used by Section 3.
    project_summary: dict[int, dict] = {}
    proj_member_to_proj: dict[int, list[int]] = {mid: [] for mid in team_member_ids}
    for pid, members in pm_index.items():
        # member_id list for this project, deduped
        mids = {m["member_id"] for m in members if m["member_id"] is not None}
        for mid in mids:
            proj_member_to_proj.setdefault(mid, []).append(pid)
        # Seed every numeric/text field with a safe default up front — a
        # project with team members but zero tasks never gets touched by
        # step 12's per-project aggregate below (that query only produces a
        # row per project that HAS tasks), and used to leave this dict
        # missing manday_est/manday_actual/progress_pct/timeline_pct/etc.,
        # which crashed the frontend's `.toFixed()` calls on `undefined`.
        pr = proj_row_by_id.get(pid)
        project_summary[pid] = {
            "project_id": pid,
            "name": pr.name if pr else f"Project #{pid}",
            "status": pr.status if pr else None,
            "current_phase": pr.current_phase if pr else None,
            "data_scope": pr.data_scope if pr else None,
            "business": pr.business if pr else None,
            "total": 0,
            "done": 0,
            "overdue": 0,
            "in_progress": 0,
            "manday_est": 0.0,
            "manday_actual": 0.0,
            "kpi": 0.0,
            "progress_pct": 0,
            "timeline_pct": 0,
            "health": "N/A",
            "workspace": (pr.business or pr.data_scope or "") if pr else "",
            "members": [{"member_id": mid, "role": m["role"]} for mid in mids for m in members if m["member_id"] == mid],
        }

    # 12. Per-project task aggregation, restricted to projects touched by
    #     the kept teams (single grouped query, same fields as the global
    #     summary endpoint — so Section 3's "progress / timeline / health"
    #     numbers are exactly the same numbers used elsewhere).
    if project_summary:
        project_ids = list(project_summary.keys())
        proj_task_rows_q = (
            db.query(
                Phase.project_id.label("project_id"),
                sql_func.count(Task.id).label("total"),
                sql_func.sum(done_expr).label("done"),
                sql_func.sum(overdue_expr).label("overdue"),
                sql_func.sum(Task.manday_est).label("md_est"),
                sql_func.sum(Task.manday_actual).label("md_actual"),
                sql_func.sum(Task.kpi_assigned + Task.kpi_support).label("kpi"),
            )
            .select_from(Task)
            .join(TaskGroup, Task.task_group_id == TaskGroup.id)
            .join(Phase, TaskGroup.phase_id == Phase.id)
            .filter(Phase.project_id.in_(project_ids))
            .group_by(Phase.project_id)
        )
        # Apply the same time-window filter so Section 3's per-project
        # progress / timeline / KPI numbers reflect the selected time range
        # — not the lifetime totals.
        if time_filters:
            proj_task_rows_q = proj_task_rows_q.filter(*time_filters)
        proj_task_rows = proj_task_rows_q.all()
        proj_by_id = {p.id: p for p in db.query(Project).filter(Project.id.in_(project_ids)).all()}
        for pid, total, done, overdue, md_est, md_actual, kpi in proj_task_rows:
            p = proj_by_id.get(pid)
            if not p:
                continue
            total_n = int(total or 0)
            done_n = int(done or 0)
            overdue_n = int(overdue or 0)
            ps = project_summary[pid]
            ps["name"] = p.name
            ps["status"] = p.status
            ps["current_phase"] = p.current_phase
            ps["data_scope"] = p.data_scope
            ps["business"] = p.business
            ps["total"] = total_n
            ps["done"] = done_n
            ps["overdue"] = overdue_n
            ps["in_progress"] = max(total_n - done_n - overdue_n, 0)
            ps["manday_est"] = float(md_est or 0)
            ps["manday_actual"] = float(md_actual or 0)
            ps["kpi"] = float(kpi or 0)
            # Issue 3 — Project Progress is now the configured Master Phase
            # percentage (single source of truth). The task-based percentage
            # is still computed separately as `task_completion_pct` so existing
            # dashboards that intentionally surface task-completion aren't
            # broken.
            ps["progress_pct"] = round(get_progress_pct_for_phase(db, p.current_phase), 2)
            ps["task_completion_pct"] = round((done_n / total_n) * 100, 1) if total_n > 0 else 0
            ps["timeline_pct"] = round(((total_n - overdue_n) / total_n) * 100, 1) if total_n > 0 else 0
            ps["health"] = _team_health(done_n, total_n, overdue_n)
            # The frontend will likely show a workspace label; provide the
            # business name (matches what the existing dashboard shows).
            ps["workspace"] = p.business or (p.data_scope or "")
        # Filter out projects that ended up with zero tasks after the
        # SQL join (defensive — keeps the response small).
        project_summary = {pid: ps for pid, ps in project_summary.items() if ps.get("total", 0) > 0 or ps.get("members")}

    # 13. Build per-team response.
    teams_out = []
    for li in leader_info:
        leader_member_id = li["member_id"]
        team_members = team_by_leader.get(leader_member_id, [])
        # Per-member breakdown.
        member_breakdown = []
        agg_total = 0
        agg_done = 0
        agg_inprog = 0
        agg_overdue = 0
        agg_md_est = 0.0
        agg_md_actual = 0.0
        agg_kpi = 0.0
        for m in team_members:
            mm = per_member.get(m.id, {})
            a_total = mm.get("assigned_total", 0)
            a_done = mm.get("assigned_done", 0)
            a_over = mm.get("assigned_overdue", 0)
            a_md_est = mm.get("assigned_manday_est", 0.0)
            a_md_actual = mm.get("assigned_manday_actual", 0.0)
            a_kpi = mm.get("assigned_kpi", 0.0)
            s_total = mm.get("support_total", 0)
            s_done = mm.get("support_done", 0)
            s_over = mm.get("support_overdue", 0)
            s_md_est = mm.get("support_manday_est", 0.0)
            s_md_actual = mm.get("support_manday_actual", 0.0)
            s_kpi = mm.get("support_kpi", 0.0)

            tot = a_total + s_total
            dn = a_done + s_done
            ov = a_over + s_over
            inprog = max(tot - dn - ov, 0)

            member_breakdown.append({
                "member_id": m.id,
                "name": m.display_name or m.full_name or f"Member #{m.id}",
                "position": m.position,
                "department": m.department,
                "team": m.team,
                "assigned": a_total,
                "support": s_total,
                "total": tot,
                "done": dn,
                "in_progress": inprog,
                "overdue": ov,
                "manday_est": round(a_md_est + s_md_est, 2),
                "manday_actual": round(a_md_actual + s_md_actual, 2),
                "kpi": round(a_kpi + s_kpi, 2),
                "progress_pct": round((dn / tot) * 100, 1) if tot > 0 else 0,
            })

            agg_total += tot
            agg_done += dn
            agg_inprog += inprog
            agg_overdue += ov
            agg_md_est += a_md_est + s_md_est
            agg_md_actual += a_md_actual + s_md_actual
            agg_kpi += a_kpi + s_kpi

        agg_plan_md = round(agg_md_est, 2)
        agg_actual_md = round(agg_md_actual, 2)
        util = round((agg_actual_md / agg_plan_md) * 100, 1) if agg_plan_md > 0 else 0
        efficiency = round((agg_done / agg_total) * 100, 1) if agg_total > 0 else 0
        on_time = max(agg_total - agg_overdue, 0)
        # Pick team display name (team attribute first; fall back to leader
        # name so the table is never empty). Same convention as the existing
        # leader-card rendering.
        team_name = None
        for m in team_members:
            if m.team:
                team_name = m.team
                break
        if not team_name and team_members:
            team_name = team_members[0].department or li["name"]
        if not team_name:
            team_name = li["name"]

        # Projects touched by this team's members.
        team_project_ids: set[int] = set()
        for m in team_members:
            for pid in proj_member_to_proj.get(m.id, []):
                team_project_ids.add(pid)
        team_projects = [
            {k: v for k, v in ps.items() if k != "members"}
            for pid, ps in project_summary.items()
            if pid in team_project_ids
        ]
        team_projects.sort(key=lambda p: (-p.get("overdue", 0), -p.get("total", 0), p.get("name", "")))

        # Resolve the workspace name (read from any member's team context
        # is unreliable; we use the data_scope on the Leader account).
        workspace_name = li["data_scope"] if li["data_scope"] != ALL_SCOPE else "All"

        teams_out.append({
            "leader_user_id": li["user_id"],
            "leader_member_id": leader_member_id,
            "leader_name": li["name"],
            "leader_email": li["email"],
            "team_name": team_name,
            "workspace": workspace_name,
            "data_scope": li["data_scope"],
            "member_count": len(team_members),
            "members": sorted(member_breakdown, key=lambda x: -x["kpi"]),
            "kpi": round(agg_kpi, 2),
            "plan_md": agg_plan_md,
            "actual_md": agg_actual_md,
            "util": util,
            "efficiency": efficiency,
            "on_time": on_time,
            "overdue": agg_overdue,
            "total": agg_total,
            "done": agg_done,
            "in_progress": agg_inprog,
            "health": _team_health(agg_done, agg_total, agg_overdue),
            "projects": team_projects,
        })

    # Stable ordering: highest KPI first, then most members.
    teams_out.sort(key=lambda t: (-t["kpi"], -t["member_count"], t["leader_name"]))

    return {
        "workspace": workspace_label,
        "workspace_filter": ws_filter or "all",
        "teams": teams_out,
    }
