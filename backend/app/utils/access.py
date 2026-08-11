import re
from fastapi import Depends, HTTPException, Request
from sqlalchemy import or_, func as sql_func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.meeting import Meeting
from ..models.member import Member
from ..models.phase import Phase
from ..models.project import Project, project_members
from ..models.system_category import Workspace
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


def resolve_workspace(db: Session, value):
    """Resolve a Workspace by its code or case-insensitive display name."""
    v = str(value or "").strip().lower()
    if not v:
        return None
    ws = db.query(Workspace).filter(Workspace.code == v).first()
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


def business_label_for_project(db: Session, project) -> str:
    """Display name for a project: explicit business value or resolved from customer BU."""
    if project.business:
        return project.business
    bu_code = project.customer.business_unit if project.customer else None
    ws = resolve_workspace(db, bu_code or getattr(project, "data_scope", None))
    return ws.name if ws else "All"


def business_unit_for_project(db: Session, project) -> str:
    """Workspace code for a project, resolved from the customer BU / data scope."""
    if project.customer and project.customer.business_unit:
        return project.customer.business_unit
    ws = resolve_workspace(db, getattr(project, "data_scope", None))
    return ws.code if ws else default_scope(db)


def user_scope(user) -> str:
    return (getattr(user, "data_scope", None) or default_scope_guard()).strip().lower()


def default_scope_guard() -> str:
    """Legacy fallback only used before the Workspace Master is seeded."""
    return "infrastructure"


def project_belongs_to_workspace(db: Session, scope: str):
    """Return OR-conditions for projects belonging to the given Workspace scope.

    Shared data-scope rule used by Leader, Member and Viewer: a project belongs
    to the caller's Workspace when its scope/business matches the Workspace or
    when it is global ('all' / 'All').
    """
    ws = resolve_workspace(db, scope)
    filters = [
        Project.data_scope == scope,
        Project.data_scope == ALL_SCOPE,
        Project.business == "All",
    ]
    if ws:
        filters.append(Project.business == ws.name)
    return filters


def project_query_for_user(db: Session, user):
    """Return a Project query filtered by the caller's role and scope.

    - super_admin (scope=all): every project.
    - leader: projects matching data_scope, business==All/scope, or explicitly assigned.
    - member / viewer: projects where the user's linked member_id is in project_members
      AND the project belongs to the user's assigned Workspace.
    """
    query = db.query(Project)
    scope = user_scope(user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scope == ALL_SCOPE:
        return query

    if role == ROLE_LEADER:
        member_id = getattr(user, "member_id", None)
        filters = list(project_belongs_to_workspace(db, scope))
        if member_id:
            assigned_project_ids = (
                db.query(project_members.c.project_id)
                .filter(project_members.c.member_id == member_id)
                .subquery()
            )
            filters.append(Project.id.in_(assigned_project_ids))
        return query.filter(or_(*filters))

    # member / viewer — assigned projects, restricted to the user's Workspace.
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
    return base.filter(or_(*project_belongs_to_workspace(db, scope)))


def member_query_for_user(db: Session, user):
    """Return a Member query filtered by the caller's role and Workspace scope.

    - super_admin / scope=all: every member (unchanged).
    - leader: members belonging to the leader's Workspace — i.e. members whose
      linked account data_scope matches the Workspace, or members assigned to a
      project within the leader's scope.
    - member / viewer: unchanged (keeps existing behavior).
    """
    query = db.query(Member)
    scope = user_scope(user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scope == ALL_SCOPE:
        return query
    if role != ROLE_LEADER:
        return query

    scoped_user_member_ids = (
        db.query(User.member_id)
        .filter(
            User.member_id.isnot(None),
            or_(User.data_scope == scope, User.data_scope == ALL_SCOPE),
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
    return query.filter(
        or_(
            Member.id.in_(scoped_user_member_ids),
            Member.id.in_(scoped_project_member_ids),
        )
    )


def can_access_project(db: Session, user, project: Project) -> bool:
    """Check whether *user* is allowed to view *project*."""
    scope = user_scope(user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scope == ALL_SCOPE:
        return True

    if role == ROLE_LEADER:
        return (
            (project.data_scope == scope)
            or (project.data_scope == ALL_SCOPE)
            or (project.business == "All")
            or _is_member_of_project(db, user, project.id)
        )

    # member / viewer — must be an explicit project member whose project
    # belongs to the user's assigned Workspace.
    member_id = getattr(user, "member_id", None)
    if not member_id:
        return False
    if not _is_member_of_project(db, user, project.id):
        return False
    ws = resolve_workspace(db, scope)
    return (
        (project.data_scope == scope)
        or (project.data_scope == ALL_SCOPE)
        or (project.business == "All")
        or (ws is not None and project.business == ws.name)
    )


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
    if request.url.path.endswith("/google/callback") or "/health/google" in request.url.path:
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
