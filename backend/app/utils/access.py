import re
from fastapi import Depends, HTTPException, Request
from sqlalchemy import or_, func as sql_func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.meeting import Meeting
from ..models.member import Member
from ..models.phase import Phase
from ..models.project import Project, project_members
from ..models.system_category import Customer, Workspace
from ..models.workspace_access import UserWorkspaceAccess
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..models.user import User
from .auth import get_current_user

ALL_SCOPE = "all"

# ── Role constants ──────────────────────────────────────────
ROLE_SUPER_ADMIN = "super_admin"
ROLE_LEADER = "leader"
ROLE_MEMBER = "member"
ROLE_VIEWER = "viewer"
VALID_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER, ROLE_MEMBER, ROLE_VIEWER, "admin"}
WRITE_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER, "admin"}
# Roles whose effective data scope is their assigned Workspace
# (same Workspace-based data-scope mechanism shared by Leader, Member and Viewer).
WORKSPACE_SCOPED_ROLES = {ROLE_LEADER, ROLE_MEMBER, ROLE_VIEWER}


# ── Workspace Master (Single Source of Truth) ───────────────
def get_workspaces(db: Session):
    """Every Workspace must come from the Workspace Master table."""
    return db.query(Workspace).order_by(Workspace.id.asc()).all()


def preload_workspace_maps(db: Session):
    """Workspace table is tiny and near-static (2-3 rows) — load it once for
    an entire project list instead of resolve_workspace() re-querying it per
    project inside business_label_for_project/business_unit_for_project."""
    all_ws = db.query(Workspace).all()
    by_code = {w.code.lower(): w for w in all_ws if w.code}
    by_name = {w.name.lower(): w for w in all_ws if w.name}
    return by_code, by_name


def resolve_workspace(db: Session, value, by_code=None, by_name=None):
    """Resolve a Workspace by its code or case-insensitive display name.
    Pass by_code/by_name (from preload_workspace_maps) to avoid a query."""
    v = str(value or "").strip().lower()
    if not v:
        return None
    if by_code is not None:
        return by_code.get(v) or by_name.get(v)
    ws = db.query(Workspace).filter(sql_func.lower(Workspace.code) == v).first()
    if not ws:
        ws = db.query(Workspace).filter(sql_func.lower(Workspace.name) == v).first()
    return ws


def is_valid_scope(db: Session, scope) -> bool:
    s = str(scope or "").strip().lower()
    if s == ALL_SCOPE:
        return True
    return resolve_workspace(db, s) is not None


def valid_data_scopes(db: Session):
    return {ALL_SCOPE} | {w.code for w in get_workspaces(db)}


def leader_allowed_scopes(db: Session):
    return {w.code for w in get_workspaces(db)}


def default_workspace(db: Session):
    workspaces = get_workspaces(db)
    return workspaces[0] if workspaces else None


def default_scope(db: Session) -> str:
    ws = default_workspace(db)
    return ws.code if ws else "infrastructure"


def scope_display_name(db: Session, scope) -> str:
    """Map a scope code to its Workspace display name ('all' → 'All')."""
    s = str(scope or "").strip().lower()
    if s == ALL_SCOPE:
        return "All"
    ws = resolve_workspace(db, s)
    return ws.name if ws else s


def business_label_for_project(db: Session, project, by_code=None, by_name=None) -> str:
    """Display name for a project: explicit business value or resolved from customer BU."""
    if project.business:
        return project.business
    bu_code = project.customer.business_unit if project.customer else None
    ws = resolve_workspace(db, bu_code or getattr(project, "data_scope", None), by_code, by_name)
    return ws.name if ws else "All"


def business_unit_for_project(db: Session, project, by_code=None, by_name=None) -> str:
    """Workspace code for a project, resolved from the customer BU / data scope."""
    if project.customer and project.customer.business_unit:
        return project.customer.business_unit
    ws = resolve_workspace(db, getattr(project, "data_scope", None), by_code, by_name)
    return ws.code if ws else default_scope(db)


def user_scope(user) -> str:
    return (getattr(user, "data_scope", None) or default_scope_guard()).strip().lower()


def default_scope_guard() -> str:
    """Legacy fallback only used before the Workspace Master is seeded."""
    return "infrastructure"


def user_allowed_scopes(db: Session, user):
    """Return the set of Workspace scope-codes (lowercase) *user* may access,
    or ALL_SCOPE if they bypass Workspace restriction entirely.

    Backed by `user_workspace_access` — a user may hold more than one
    Workspace (e.g. a Leader overseeing several). Falls back to the single
    `data_scope` column when no rows exist yet (defensive: should not happen
    once the startup backfill has run, but keeps brand-new/test rows safe).
    """
    role = getattr(user, "role", ROLE_MEMBER)
    base_scope = user_scope(user)
    if role == ROLE_SUPER_ADMIN or base_scope == ALL_SCOPE:
        return ALL_SCOPE

    user_id = getattr(user, "id", None)
    rows = (
        db.query(Workspace.code)
        .join(UserWorkspaceAccess, UserWorkspaceAccess.workspace_id == Workspace.id)
        .filter(UserWorkspaceAccess.user_id == user_id)
        .all()
    )
    codes = {c.strip().lower() for (c,) in rows if c}
    return codes or {base_scope}


def project_belongs_to_workspace(db: Session, scopes):
    """Return OR-conditions for projects belonging to any of the given
    Workspace scope(s). Accepts a single scope string or an iterable of scope
    codes — a caller (e.g. a Leader) may be granted more than one Workspace.

    Shared data-scope rule used by Leader, Member and Viewer: a project belongs
    to one of the caller's Workspaces when its scope/business matches it, or
    when it is global ('all' / 'All').
    """
    scope_set = {scopes} if isinstance(scopes, str) else set(scopes)
    filters = [
        Project.data_scope.in_(scope_set),
        Project.data_scope == ALL_SCOPE,
        Project.business == "All",
    ]
    for scope in scope_set:
        ws = resolve_workspace(db, scope)
        if ws:
            filters.append(Project.business == ws.name)
    return filters


def project_query_for_user(db: Session, user):
    """Return a Project query filtered by the caller's role and Workspace(s).

    - super_admin (scope=all): every project.
    - leader: projects matching any allowed Workspace, business==All, or explicitly assigned.
    - member / viewer: projects where the user's linked member_id is in project_members
      AND the project belongs to one of the user's assigned Workspace(s).
    """
    query = db.query(Project)
    scopes = user_allowed_scopes(db, user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return query

    if role == ROLE_LEADER:
        member_id = getattr(user, "member_id", None)
        filters = list(project_belongs_to_workspace(db, scopes))
        if member_id:
            assigned_project_ids = (
                db.query(project_members.c.project_id)
                .filter(project_members.c.member_id == member_id)
                .subquery()
            )
            filters.append(Project.id.in_(assigned_project_ids))
        return query.filter(or_(*filters))

    # member / viewer — assigned projects, restricted to the user's Workspace(s).
    member_id = getattr(user, "member_id", None)
    if not member_id:
        # User has no linked member → they can see nothing.
        return query.filter(Project.id == -1)

    assigned_project_ids = (
        db.query(project_members.c.project_id)
        .filter(project_members.c.member_id == member_id)
        .subquery()
    )
    base = query.filter(Project.id.in_(assigned_project_ids))
    return base.filter(or_(*project_belongs_to_workspace(db, scopes)))


def member_query_for_user(db: Session, user):
    """Return a Member query filtered by the caller's role and Workspace(s).

    - super_admin / scope=all: every member (unchanged).
    - leader / member / viewer: members belonging to one of the caller's
      Workspace(s) — i.e. members whose linked account data_scope matches one
      of them, or members assigned to a project within the caller's scope(s).
    """
    query = db.query(Member)
    scopes = user_allowed_scopes(db, user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return query
    if role not in WORKSPACE_SCOPED_ROLES:
        return query

    scoped_user_member_ids = (
        db.query(User.member_id)
        .filter(
            User.member_id.isnot(None),
            or_(User.data_scope.in_(scopes), User.data_scope == ALL_SCOPE),
        )
        .subquery()
    )
    scoped_project_ids = (
        project_query_for_user(db, user).with_entities(Project.id).subquery()
    )
    scoped_project_member_ids = (
        db.query(project_members.c.member_id)
        .filter(project_members.c.project_id.in_(scoped_project_ids))
        .subquery()
    )
    conditions = [
        Member.id.in_(scoped_user_member_ids),
        Member.id.in_(scoped_project_member_ids),
    ]

    # Map workspace scope to department names
    scope_to_dept = {
        "infra": "Infrastructure",
        "dev": "Dev/DevOps",
        "soc": "Security",
        "marketing": "Marketing",
        "sales": "Sales"
    }
    target_depts = []
    for s in scopes:
        s_lower = str(s).strip().lower()
        dept = scope_to_dept.get(s_lower)
        if dept:
            target_depts.append(dept)
        else:
            ws = resolve_workspace(db, s_lower)
            if ws:
                target_depts.append(ws.name)
                target_depts.append(ws.code)

    if target_depts:
        conditions.append(sql_func.lower(Member.department).in_([d.lower() for d in target_depts]))

    return query.filter(or_(*conditions))


def can_access_project(db: Session, user, project: Project) -> bool:
    """Check whether *user* is allowed to view *project*."""
    role = getattr(user, "role", ROLE_MEMBER)
    scopes = user_allowed_scopes(db, user)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return True

    if role == ROLE_LEADER:
        return (
            (project.data_scope in scopes)
            or (project.data_scope == ALL_SCOPE)
            or (project.business == "All")
            or _is_member_of_project(db, user, project.id)
        )

    # member / viewer — must be an explicit project member whose project
    # belongs to one of the user's assigned Workspace(s).
    member_id = getattr(user, "member_id", None)
    if not member_id:
        return False
    if not _is_member_of_project(db, user, project.id):
        return False
    if (
        (project.data_scope in scopes)
        or (project.data_scope == ALL_SCOPE)
        or (project.business == "All")
    ):
        return True
    return any(
        (ws := resolve_workspace(db, scope)) is not None and project.business == ws.name
        for scope in scopes
    )


def customer_query_for_user(db: Session, user):
    """Return a Customer query filtered by the caller's role and Workspace access.

    `Customer.business_unit` is legacy/unmaintained (confirmed by a production
    data audit — it does not reliably reflect a Customer's real Workspace), so
    a Customer's effective Workspace(s) are derived from its linked Projects:

    - super_admin / scope=all: every customer.
    - leader with Workspace access: customers with at least one Project whose
      business matches one of the allowed Workspaces (or the 'All' escape hatch).
    - member / viewer: no Customer access — Project access does not imply
      Customer access.
    """
    role = getattr(user, "role", ROLE_MEMBER)
    scopes = user_allowed_scopes(db, user)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return db.query(Customer)

    if role != ROLE_LEADER:
        return db.query(Customer).filter(Customer.id == -1)

    ws_names = {w.name for w in db.query(Workspace).filter(Workspace.code.in_(scopes)).all()}
    filters = [Project.business == "All"]
    if ws_names:
        filters.append(Project.business.in_(ws_names))
    customer_ids = (
        db.query(Project.customer_id)
        .filter(Project.customer_id.isnot(None), or_(*filters))
        .subquery()
    )
    return db.query(Customer).filter(Customer.id.in_(customer_ids))


def require_project(db: Session, user, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    # Return 404 for both missing and out-of-scope records to avoid leaking IDs.
    if not project or not can_access_project(db, user, project):
        raise HTTPException(404, "Project not found.")
    return project


def _is_task_write(request: Request) -> bool:
    """Check if the request is a Task write operation (Create/Update/Delete)."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return False
    path = request.url.path
    # Allow task CRUD (create, update, delete, copy tasks)
    if re.search(r"/task-groups/\d+/tasks(/.*)?", path) is not None:
        return True
    return False


def _is_member_of_project(db: Session, user, project_id: int) -> bool:
    """Check if the user's linked member is assigned to the project."""
    if not user.member_id:
        return False
    return db.execute(
        project_members.select().where(
            project_members.c.project_id == project_id,
            project_members.c.member_id == user.member_id,
        )
    ).first() is not None


def require_route_project_access(
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Authorize project, phase, group, task, or meeting path parameters."""
    print(f"--- ACCESS CHECK ---")
    print(f"Path: {request.url.path}")
    if request.url.path.endswith("/google/callback") or "/health/google" in request.url.path or "/webhook/n8n-summary" in request.url.path:
        return None

    params = request.path_params
    project_id = params.get("pid")

    # Resolve project_id from path parameters if not directly provided.
    if project_id is None and params.get("phid") is not None:
        project_id = db.query(Phase.project_id).filter(Phase.id == int(params["phid"])).scalar()
    if project_id is None and params.get("gid") is not None:
        project_id = (
            db.query(Phase.project_id)
            .join(TaskGroup, TaskGroup.phase_id == Phase.id)
            .filter(TaskGroup.id == int(params["gid"]))
            .scalar()
        )
    if project_id is None and params.get("tid") is not None:
        project_id = (
            db.query(Phase.project_id)
            .join(TaskGroup, TaskGroup.phase_id == Phase.id)
            .join(Task, Task.task_group_id == TaskGroup.id)
            .filter(Task.id == int(params["tid"]))
            .scalar()
        )
    if project_id is None and request.url.path.startswith("/api/meetings/") and params.get("id") is not None:
        meeting = db.query(Meeting).filter(Meeting.id == int(params["id"])).first()
        if meeting and meeting.project_id is None and user_scope(user) != ALL_SCOPE:
            raise HTTPException(404, "Meeting not found.")
        project_id = meeting.project_id if meeting else None
    
    print(f"Project ID: {project_id}")

    # Check data scope access if project_id is resolved.
    if project_id is not None:
        require_project(db, user, int(project_id))

    role = getattr(user, "role", ROLE_MEMBER)
    print(f"Role: {role}")

    # ── Viewer: read-only — block every non-GET request unconditionally. ──
    if role == ROLE_VIEWER and request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(403, "Viewer không có quyền thực hiện thao tác này!")

    # ── Role-based write authorization. ──
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        is_task_write_result = _is_task_write(request)
        print(f"Is Task Write: {is_task_write_result}")
        if role in WRITE_ROLES:
            # super_admin and leader may write freely within their scope.
            return user

        # member: may perform Task CRUD if assigned to the current project.
        if role == ROLE_MEMBER:
            if is_task_write_result and project_id is not None:
                print("--- ACCESS GRANTED FOR MEMBER ---")
                return user
            print("--- ACCESS DENIED FOR MEMBER ---")
            raise HTTPException(403, "Yêu cầu quyền quản lý, bạn không có quyền thực hiện thao tác này!")

        # Catch-all for any unexpected role.
        raise HTTPException(403, "Yêu cầu quyền quản lý, bạn không có quyền thực hiện thao tác này!")

    return user
