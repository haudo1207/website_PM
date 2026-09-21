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
    _member_active_in_window,
    get_workspaces,
    resolve_workspace,
    audit_log_query_for_user,
    user_allowed_scopes,
    ROLE_SUPER_ADMIN,
    ROLE_LEADER,
    ALL_SCOPE,
)

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


@router.get("/team-comparison-tasks")
def get_team_comparison_tasks(db: Session = Depends(get_db), current_user=Depends(require_audit_user)):
    """Raw task list backing Section 4's Member Detail modal — same shape as
    `/api/all-tasks-global`, but deliberately WITHOUT that endpoint's own
    per-Leader Workspace-scope restriction.

    `/api/all-tasks-global` restricts a Leader caller to projects in their
    OWN granted Workspace(s) (`project_query_for_user_broad`) — correct for
    its purpose (a Leader's personal team-wide picture), but wrong here:
    `_aggregate_team_comparison` above already decides which Teams/Leaders
    this caller may see on Team Load via its own `caller_scopes` filter
    (same `require_audit_user` permission this route requires); a Member's
    task can legitimately live on a project outside the CALLER's personal
    scope/project_members rows (e.g. a different Team's project, or a task
    assigned without a matching project_members row) while that Member's
    own card is still correctly visible on Team Load. Reusing the
    Leader-scoped endpoint for the modal's task fetch silently produced an
    empty task list in exactly that case, even though the card itself
    (fed by the unrestricted `_aggregate_team_comparison` query) showed
    real data — this endpoint fixes that by matching the same "no personal
    Workspace restriction" scope `_aggregate_team_comparison` already uses,
    gated by the same audit permission.

    Still scoped to the caller — but along the SAME dimension
    `_aggregate_team_comparison` actually uses: which MEMBERS belong to a
    Team/Leader this caller may see (their own `caller_scopes` check on
    the Leader's `data_scope`), not which Workspace the task's own project
    happens to be tagged with. An earlier version of this endpoint filtered
    by `Project.data_scope` instead, which reintroduced the very bug this
    endpoint exists to fix: `_aggregate_team_comparison`'s own task
    aggregation has NEVER filtered by the task's project scope (see its
    own docstring/comments — a visible Member's task can live on a project
    in any Workspace), so a Leader whose card is visible but whose actual
    task sits on a project outside the CALLER's Workspace was still
    silently excluded. Reusing `_aggregate_team_comparison` itself for the
    member-id set guarantees this can never drift from the card again.
    """
    from .task_groups import serialize_task
    from ..models.skill_master import Group, Skill

    caller_scopes = user_allowed_scopes(db, current_user)
    is_super_admin = (
        getattr(current_user, "role", None) == ROLE_SUPER_ADMIN
        or caller_scopes == ALL_SCOPE
    )

    query = (
        db.query(Task, TaskGroup, Phase, Project)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .join(Project, Phase.project_id == Project.id)
    )
    if not is_super_admin:
        # workspace=None → the FULL set of Teams/Leaders this caller may
        # ever see on Team Load, independent of whatever Workspace filter
        # the UI's dropdown currently has selected (the modal can be
        # opened for a Member from any visible Team, not just the one
        # matching today's dropdown selection).
        visible = _aggregate_team_comparison(db, workspace=None, current_user=current_user)
        allowed_member_ids: set[int] = set()
        for team in visible.get("teams", []):
            if team.get("leader_member_id") is not None:
                allowed_member_ids.add(team["leader_member_id"])
            for m in team.get("members", []):
                if m.get("member_id") is not None:
                    allowed_member_ids.add(m["member_id"])
        query = query.filter(
            Task.assigned_id.in_(allowed_member_ids) | Task.support_id.in_(allowed_member_ids)
        )
    results = query.all()

    members_map = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}
    groups_map = {g.id: g.name for g in db.query(Group).all()}
    skills_map = {s.id: s.name for s in db.query(Skill).all()}

    output = []
    for task, tg, phase, project in results:
        try:
            t_dict = serialize_task(task, db, members_map, groups_map, skills_map)
            t_dict["name"] = task.detail or f"Task #{task.id}"
            t_dict["project_id"] = project.id
            t_dict["projectName"] = project.name
            t_dict["projectDataScope"] = project.data_scope
            t_dict["customerName"] = project.customer_name
            t_dict["year"] = project.year
            t_dict["task_group_name"] = tg.name
            t_dict["phase_name"] = phase.name
        except Exception as e:
            print(f"Error serializing task {getattr(task, 'id', None)}: {e}")
            continue
        output.append(t_dict)
    return output


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
      that belong to the window: a DONE task belongs to the window its
      `end_date_actual` (real completion date) falls inside; a task that
      is not yet Done belongs to the window its `end_date_est` / `start_date`
      / `created_at` falls inside, or that it is overdue relative to.
      This matches the same "which period does this task belong to" rule
      already used by Dashboard Overview / the Member Detail modal
      (`checkTaskInPeriod`), so Team Load's Done/Manday counts and its KPI
      figures (`kpi` / `kpi_pct`, sourced from `per_member_period_kpi`)
      agree with each other and with Overview. Omitting the parameters
      preserves the original (unfiltered) behaviour.

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

    # ── Fiscal weeks divisor for KPI% calculation ──────────────────────
    # Reuse the same CYCLE_TEMPLATE the KPI page uses. When a start_date
    # and end_date are provided we count how many fiscal weeks the window
    # spans. For quick-filters that already map to a single fiscal week
    # the caller sends Mon→Sun which always falls inside one fiscal week
    # → weeks_divisor = 1.  For full fiscal months the caller sends the
    # CYCLE_TEMPLATE start/end → weeks_divisor = template weeks (4 or 5).
    # For a full year or no filter → 52.
    CYCLE_TEMPLATE = {
        1:  ("-12-22", "-01-18", -1, 0, 4),
        2:  ("-01-19", "-02-22",  0, 0, 5),
        3:  ("-02-23", "-03-22",  0, 0, 4),
        4:  ("-03-23", "-04-19",  0, 0, 4),
        5:  ("-04-20", "-05-24",  0, 0, 5),
        6:  ("-05-25", "-06-21",  0, 0, 4),
        7:  ("-06-22", "-07-19",  0, 0, 4),
        8:  ("-07-20", "-08-23",  0, 0, 5),
        9:  ("-08-24", "-09-20",  0, 0, 4),
        10: ("-09-21", "-10-25",  0, 0, 5),
        11: ("-10-26", "-11-22",  0, 0, 4),
        12: ("-11-23", "-12-20",  0, 0, 4),
    }

    weeks_divisor = 52  # default: full year
    if parsed_start and parsed_end:
        # Try to match the window to a known fiscal month
        matched = False
        year_ref = parsed_start.year
        for m, (s_md, e_md, s_yo, e_yo, weeks) in CYCLE_TEMPLATE.items():
            cycle_start = datetime.strptime(f"{year_ref + s_yo}{s_md}", "%Y-%m-%d")
            cycle_end = datetime.strptime(f"{year_ref + e_yo}{e_md}", "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, microsecond=999999
            )
            if abs((parsed_start - cycle_start).total_seconds()) < 86400 and \
               abs((parsed_end - cycle_end).total_seconds()) < 86400:
                weeks_divisor = weeks
                matched = True
                break
        if not matched:
            # Check if the window spans ~7 days (a single week)
            day_span = (parsed_end - parsed_start).days + 1
            if day_span <= 7:
                weeks_divisor = 1

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

    # Apply the period-aware OFF filter (Member.off_effective_at) to the
    # team member roster. Leaders whose entire managed team turns out to
    # be OFF for the requested window are dropped by the re-evaluation of
    # `len(team_by_leader.get(li["member_id"], [])) > 0` below.
    for leader_member_id in list(team_by_leader.keys()):
        team_by_leader[leader_member_id] = [
            m for m in team_by_leader[leader_member_id]
            if _member_active_in_window(m, parsed_start, parsed_end)
        ]
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
    # Lookup map for the OFF check below — keyed by leader's Member.id so we
    # can reuse the same per-window rule for the leader themself.
    leader_member_active_in_window: dict[int, bool] = {}
    for li in leader_info:
        # Include the leader's own member_id so their personal task data
        # is included in per_member / per_member_period_kpi aggregations.
        # Skip if the leader themself is OFF for the requested window
        # (mirrors the same rule used for managed members above).
        if li["member_id"] is not None:
            leader_member = db.query(Member).filter(Member.id == li["member_id"]).first()
            leader_member_active_in_window[li["member_id"]] = _member_active_in_window(
                leader_member, parsed_start, parsed_end
            )
            if leader_member_active_in_window[li["member_id"]]:
                team_member_ids.add(li["member_id"])
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

    # Time-range window clause: a task belongs to the window if ANY of
    # these conditions are true:
    #   0. Task is DONE and its end_date_actual (real completion date)
    #      falls within [parsed_start, parsed_end] — a Done task belongs to
    #      the period it was ACTUALLY finished in, matching the same rule
    #      Overview / the Member Detail modal already use
    #      (`checkTaskInPeriod`) and `per_member_period_kpi` below. This is
    #      the ONLY way a Done task can match now — conditions 1/2 are
    #      restricted to non-Done tasks (see `not_done`) — otherwise a task
    #      whose PLANNED dates touch this period but was actually finished
    #      in a different period would still count toward this period's
    #      Done/Manday totals while its KPI (per_member_period_kpi) does
    #      not, reproducing the exact "Total KPI vs KPI Trung Bình" mismatch
    #      this rule was introduced to eliminate.
    #   1. Task (not yet Done) assigned during the selected period
    #      (start_date or created_at falls within [parsed_start, parsed_end])
    #   2. Task (not yet Done) deadline falls within the selected period
    #      (end_date_est falls within [parsed_start, parsed_end])
    #   3. Task is overdue relative to the selected period (end_date_est
    #      < parsed_end AND status not Done/Cancel)
    # When no window is provided we skip the clause entirely (preserves
    # existing behaviour).
    time_filters = []
    if parsed_start is not None or parsed_end is not None:
        from sqlalchemy import or_

        or_conditions = []
        not_done = Task.status.notin_(["Done", "done"])

        # Condition 0: Done task, real completion date in window.
        done_condition = Task.status.in_(["Done", "done"]) & Task.end_date_actual.isnot(None)
        if parsed_start is not None and parsed_end is not None:
            done_condition = done_condition & Task.end_date_actual.between(parsed_start.date(), parsed_end.date())
        elif parsed_start is not None:
            done_condition = done_condition & (Task.end_date_actual >= parsed_start.date())
        elif parsed_end is not None:
            done_condition = done_condition & (Task.end_date_actual <= parsed_end.date())
        or_conditions.append(done_condition)

        # Condition 1: Task (not yet Done) assigned during the period
        if parsed_start is not None and parsed_end is not None:
            or_conditions.append(
                not_done & (
                    (Task.start_date.between(parsed_start, parsed_end)) |
                    (Task.created_at.between(parsed_start, parsed_end))
                )
            )
        elif parsed_start is not None:
            or_conditions.append(
                not_done & (
                    (Task.start_date >= parsed_start) |
                    (Task.created_at >= parsed_start)
                )
            )
        elif parsed_end is not None:
            or_conditions.append(
                not_done & (
                    (Task.start_date <= parsed_end) |
                    (Task.created_at <= parsed_end)
                )
            )

        # Condition 2: Task (not yet Done) deadline falls within the period
        if parsed_start is not None and parsed_end is not None:
            or_conditions.append(not_done & Task.end_date_est.between(parsed_start, parsed_end))
        elif parsed_start is not None:
            or_conditions.append(not_done & (Task.end_date_est >= parsed_start))
        elif parsed_end is not None:
            or_conditions.append(not_done & (Task.end_date_est <= parsed_end))

        # Condition 3: Task is overdue relative to the period. Also requires
        # the task to have EXISTED by the period's end (created_at <=
        # parsed_end) — without this, a task created THIS week with its
        # deadline set to any date before an earlier period's end matched
        # as "overdue" in that earlier period too, retroactively counting
        # brand-new work into weeks that had already passed before the
        # task was even created.
        if parsed_end is not None:
            or_conditions.append(
                (Task.end_date_est < parsed_end) &
                (Task.end_date_est.isnot(None)) &
                (Task.status.notin_(["Done", "done", "Cancel", "cancel"])) &
                (Task.created_at <= parsed_end)
            )

        # Combine with OR - task matches if ANY condition is true
        if or_conditions:
            time_filters.append(or_(*or_conditions))

    # Separate, LENIENT window for Giao (KPI assigned) — a task's planned
    # window (start/deadline) touching the period is enough, regardless of
    # status or completion date. Reuses conditions 1/2/3 from `time_filters`
    # above but WITHOUT the `not_done` restriction (and without condition 0,
    # which only exists to anchor a DONE task's HT to its exact completion
    # week) — Giao must NOT depend on if/when a task was completed, only on
    # whether it was assigned/due during the period. Using the strict
    # `time_filters` for Giao too would silently drop a task's Giao out of
    # the period it was actually due in whenever it finished in a
    # different one, which is exactly the HT-only rule Giao must avoid.
    giao_time_filters = []
    if parsed_start is not None or parsed_end is not None:
        giao_or_conditions = []
        if parsed_start is not None and parsed_end is not None:
            giao_or_conditions.append(
                (Task.start_date.between(parsed_start, parsed_end)) |
                (Task.created_at.between(parsed_start, parsed_end))
            )
        elif parsed_start is not None:
            giao_or_conditions.append(
                (Task.start_date >= parsed_start) |
                (Task.created_at >= parsed_start)
            )
        elif parsed_end is not None:
            giao_or_conditions.append(
                (Task.start_date <= parsed_end) |
                (Task.created_at <= parsed_end)
            )
        if parsed_start is not None and parsed_end is not None:
            giao_or_conditions.append(Task.end_date_est.between(parsed_start, parsed_end))
        elif parsed_start is not None:
            giao_or_conditions.append(Task.end_date_est >= parsed_start)
        elif parsed_end is not None:
            giao_or_conditions.append(Task.end_date_est <= parsed_end)
        if parsed_end is not None:
            # Same created_at guard as time_filters' Condition 3 above — a
            # task can't be "overdue relative to" a period that ended
            # before the task existed, or its Giao would retroactively
            # leak into weeks it was never actually assigned/open during.
            giao_or_conditions.append(
                (Task.end_date_est < parsed_end) &
                (Task.end_date_est.isnot(None)) &
                (Task.status.notin_(["Done", "done", "Cancel", "cancel"])) &
                (Task.created_at <= parsed_end)
            )
        if giao_or_conditions:
            giao_time_filters.append(or_(*giao_or_conditions))

    # DB-driven priority -> kpi_base lookup (mirrors `get_priority_kpi_base`
    # in kpi_engine.py, aliases included) built as a SQL CASE so Giao stays
    # correct if priorities are ever edited via Settings, instead of a
    # hardcoded map that could silently drift from the real table.
    from ..models.system_category import TaskPriority
    _priority_map = {
        (name or "").strip().lower(): kpi_base
        for name, kpi_base in db.query(TaskPriority.name, TaskPriority.kpi_base).all()
    }
    _priority_aliases = {
        "normal": ["normal", "medium"],
        "high": ["high"],
        "critical": ["critical", "urgent"],
        "interrupt": ["interrupt"],
    }
    _priority_whens = [
        (sql_func.lower(Task.priority) == alias, _priority_map[canonical])
        for canonical, aliases in _priority_aliases.items()
        if canonical in _priority_map
        for alias in aliases
    ]
    _default_priority_kpi = _priority_map.get("normal", 6)
    priority_kpi_case = case(*_priority_whens, else_=_default_priority_kpi) if _priority_whens else _default_priority_kpi
    giao_base_expr = priority_kpi_case * sql_func.coalesce(Task.manday_est, 0)
    assigned_giao_ratio = sql_func.coalesce(Task.kpi_ratio_assign, case((Task.support_id.isnot(None), 90), else_=100))
    support_giao_ratio = sql_func.coalesce(Task.kpi_ratio_support, 10)

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

    # Giao (assigned KPI, status-agnostic) — separate query using the
    # LENIENT `giao_time_filters` window (see above), NOT `time_filters`,
    # so a task's Giao stays attributed to the period it was actually
    # assigned/due in even if it's completed in a different one.
    assigned_giao_rows = (
        db.query(
            Task.assigned_id.label("member_id"),
            sql_func.sum(giao_base_expr * assigned_giao_ratio / 100.0).label("giao"),
        )
        .filter(Task.assigned_id.in_(team_member_ids))
        .group_by(Task.assigned_id)
    )
    if giao_time_filters:
        assigned_giao_rows = assigned_giao_rows.filter(*giao_time_filters)
    assigned_giao_rows = assigned_giao_rows.all()

    support_giao_rows = (
        db.query(
            Task.support_id.label("member_id"),
            sql_func.sum(giao_base_expr * support_giao_ratio / 100.0).label("giao"),
        )
        .filter(Task.support_id.in_(team_member_ids), Task.support_id != Task.assigned_id)
        .group_by(Task.support_id)
    )
    if giao_time_filters:
        support_giao_rows = support_giao_rows.filter(*giao_time_filters)
    support_giao_rows = support_giao_rows.all()

    per_member_giao: dict[int, float] = {}
    for mid, giao in assigned_giao_rows:
        per_member_giao[mid] = per_member_giao.get(mid, 0.0) + float(giao or 0)
    for mid, giao in support_giao_rows:
        per_member_giao[mid] = per_member_giao.get(mid, 0.0) + float(giao or 0)

    # 8b. Period KPI aggregation — Done tasks whose end_date_actual falls
    #     inside the selected period (or, when no period is selected, every
    #     Done task). This is the single source of truth for every
    #     "Total KPI" / "KPI%" figure Section 4 displays (member breakdown,
    #     team aggregate, Leader's own row). Previously those "kpi" fields
    #     used a DIFFERENT, broader window instead (a task's PLANNED dates,
    #     via `time_filters` above) while this end_date_actual-based
    #     aggregate fed only the separate `kpi_pct`/`period_kpi` fields —
    #     so "Total KPI" and "KPI Trung Bình" disagreed for the same
    #     Member/period, and neither matched the frontend Member Detail
    #     modal (which has always used end_date_actual). Unifying on this
    #     definition everywhere fixes that mismatch.
    per_member_period_kpi: dict[int, float] = {}
    kpi_period_filter = [Task.status.in_(["Done", "done"])]
    if parsed_start is not None or parsed_end is not None:
        kpi_period_filter.append(Task.end_date_actual.isnot(None))
        if parsed_start is not None:
            kpi_period_filter.append(Task.end_date_actual >= parsed_start.date())
        if parsed_end is not None:
            kpi_period_filter.append(Task.end_date_actual <= parsed_end.date())
    assigned_period_kpi = (
        db.query(
            Task.assigned_id.label("member_id"),
            sql_func.sum(Task.kpi_assigned).label("period_kpi"),
        )
        .filter(Task.assigned_id.in_(team_member_ids), *kpi_period_filter)
        .group_by(Task.assigned_id)
        .all()
    )
    support_period_kpi = (
        db.query(
            Task.support_id.label("member_id"),
            sql_func.sum(Task.kpi_support).label("period_kpi"),
        )
        .filter(
            Task.support_id.in_(team_member_ids),
            Task.support_id != Task.assigned_id,
            *kpi_period_filter,
        )
        .group_by(Task.support_id)
        .all()
    )
    for mid, kpi in assigned_period_kpi:
        per_member_period_kpi[mid] = per_member_period_kpi.get(mid, 0.0) + float(kpi or 0)
    for mid, kpi in support_period_kpi:
        per_member_period_kpi[mid] = per_member_period_kpi.get(mid, 0.0) + float(kpi or 0)

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
            # New requirement: Project Progress = Completed MD / Total Task MD × 100
            # This replaces the previous Master Phase percentage calculation.
            # Progress is based on manday_actual (completed work) vs manday_est
            # (planned work) for tasks within the filtered period.
            md_est_val = float(md_est or 0)
            md_actual_val = float(md_actual or 0)
            ps["progress_pct"] = round((md_actual_val / md_est_val) * 100, 2) if md_est_val > 0 else 0
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
        agg_giao = 0.0
        for m in team_members:
            mm = per_member.get(m.id, {})
            a_total = mm.get("assigned_total", 0)
            a_done = mm.get("assigned_done", 0)
            a_over = mm.get("assigned_overdue", 0)
            a_md_est = mm.get("assigned_manday_est", 0.0)
            a_md_actual = mm.get("assigned_manday_actual", 0.0)
            s_total = mm.get("support_total", 0)
            s_done = mm.get("support_done", 0)
            s_over = mm.get("support_overdue", 0)
            s_md_est = mm.get("support_manday_est", 0.0)
            s_md_actual = mm.get("support_manday_actual", 0.0)

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
                "kpi": round(per_member_period_kpi.get(m.id, 0.0), 2),
                # Giao — KPI assigned regardless of completion status
                # (priority_kpi_base × manday_est, same formula as the
                # frontend's kpiPotential.ts), scoped to the SAME period via
                # the lenient `giao_time_filters` window. Powers "how much
                # work is this person carrying this period" independently
                # of "kpi" (HT, completed-only) above.
                "giao": round(per_member_giao.get(m.id, 0.0), 2),
                "progress_pct": round((dn / tot) * 100, 1) if tot > 0 else 0,
                # Period KPI: KPI from Done tasks whose end_date_actual falls
                # inside the selected period. Used for workload KPI% classification.
                "period_kpi": round(per_member_period_kpi.get(m.id, 0.0), 2),
                "kpi_pct": round(per_member_period_kpi.get(m.id, 0.0) / weeks_divisor, 2) if weeks_divisor > 0 else 0.0,
                # Giao% — workload classification figure (see leader_giao_pct
                # comment above): based on assigned KPI, not completed-only,
                # so it can flag overload before anything is marked Done.
                "giao_pct": round(per_member_giao.get(m.id, 0.0) / weeks_divisor, 2) if weeks_divisor > 0 else 0.0,
            })

            agg_total += tot
            agg_done += dn
            agg_inprog += inprog
            agg_overdue += ov
            agg_md_est += a_md_est + s_md_est
            agg_md_actual += a_md_actual + s_md_actual
            agg_kpi += per_member_period_kpi.get(m.id, 0.0)
            agg_giao += per_member_giao.get(m.id, 0.0)

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

        # Leader's individual KPI (from their own tasks, NOT team aggregate)
        leader_period_kpi = per_member_period_kpi.get(leader_member_id, 0.0)
        leader_kpi_pct = round(leader_period_kpi / weeks_divisor, 2) if weeks_divisor > 0 else 0.0
        # Leader's individual Giao (assigned KPI, status-agnostic — see
        # `per_member_giao` above). `giao_pct` is the workload-classification
        # figure: unlike `kpi_pct` (completed-only, blind to work that's
        # been assigned but not finished yet), this reflects how much is
        # actually ON the Leader's plate for the period, so it can flag
        # overload even when nothing has been marked Done yet.
        leader_giao = per_member_giao.get(leader_member_id, 0.0)
        leader_giao_pct = round(leader_giao / weeks_divisor, 2) if weeks_divisor > 0 else 0.0

        # Leader's personal task aggregates (NOT team aggregate).
        # These fields allow the frontend Leader card to display the
        # Leader's own Done/Doing/Overdue/KPI/Manday independently.
        lm = per_member.get(leader_member_id, {})
        lm_a_total = lm.get("assigned_total", 0)
        lm_a_done  = lm.get("assigned_done", 0)
        lm_a_over  = lm.get("assigned_overdue", 0)
        lm_a_md_est  = lm.get("assigned_manday_est", 0.0)
        lm_a_md_act  = lm.get("assigned_manday_actual", 0.0)
        lm_s_total = lm.get("support_total", 0)
        lm_s_done  = lm.get("support_done", 0)
        lm_s_over  = lm.get("support_overdue", 0)
        lm_s_md_est  = lm.get("support_manday_est", 0.0)
        lm_s_md_act  = lm.get("support_manday_actual", 0.0)
        lm_tot = lm_a_total + lm_s_total
        lm_dn  = lm_a_done + lm_s_done
        lm_ov  = lm_a_over + lm_s_over
        lm_inprog = max(lm_tot - lm_dn - lm_ov, 0)

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
            # Team's total Giao (assigned KPI, status-agnostic) — see
            # `per_member_giao` / `giao_pct` comments above.
            "giao": round(agg_giao, 2),
            "giao_pct": round(agg_giao / weeks_divisor, 2) if weeks_divisor > 0 else 0.0,
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
            # Leader's individual workload KPI (own tasks only)
            "leader_period_kpi": round(leader_period_kpi, 2),
            "leader_kpi_pct": leader_kpi_pct,
            "leader_giao": round(leader_giao, 2),
            "leader_giao_pct": leader_giao_pct,
            # Leader's personal task aggregates (own tasks only, NOT team)
            "leader_done": lm_dn,
            "leader_doing": lm_inprog,
            "leader_overdue": lm_ov,
            "leader_kpi": round(leader_period_kpi, 2),
            "leader_manday_est": round(lm_a_md_est + lm_s_md_est, 2),
            "leader_manday_actual": round(lm_a_md_act + lm_s_md_act, 2),
        })

    # Stable ordering: highest KPI first, then most members.
    teams_out.sort(key=lambda t: (-t["kpi"], -t["member_count"], t["leader_name"]))

    # Load workload settings for the frontend to use in classification
    from ..models.workload_setting import WorkloadSetting
    ws_rows = (
        db.query(WorkloadSetting)
        .filter(WorkloadSetting.is_active == True)
        .order_by(WorkloadSetting.sort_order.asc())
        .all()
    )
    workload_settings = [
        {
            "status_key": r.status_key,
            "status_label": r.status_label,
            "min_kpi": float(r.min_kpi) if r.min_kpi is not None else None,
            "max_kpi": float(r.max_kpi) if r.max_kpi is not None else None,
        }
        for r in ws_rows
    ]

    return {
        "workspace": workspace_label,
        "workspace_filter": ws_filter or "all",
        "teams": teams_out,
        "weeks_divisor": weeks_divisor,
        "workload_settings": workload_settings,
    }
